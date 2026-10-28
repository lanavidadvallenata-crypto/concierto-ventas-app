// Doble de Supabase en memoria: lo justo de la API encadenada que usa
// abona618.ts, para poder probar la orquestación sin una base de datos.
//
// No pretende imitar a Postgres. Pretende responder a las mismas llamadas con
// los mismos datos, para que las pruebas atrapen errores de orden, de estado y
// de condición de carrera (los UPDATE condicionados a "sigue sin verificar").

type Fila = Record<string, unknown>;
type Filtro = { col: string; op: "eq" | "neq" | "is" | "in" | "notin"; valor: unknown };

export type Doble = {
  tablas: Record<string, Fila[]>;
  /** Para forzar un fallo ANTES de aplicar la operación. */
  fallar: Record<string, string>;
  /** Para forzar un fallo DESPUÉS de aplicarla, que es la forma en que falla
   *  de verdad un timeout: el UPDATE se escribió y la respuesta no llegó. Sin
   *  esto era imposible escribir la prueba del único fallo parcial que el
   *  código tiene. La clave es "<tabla>:<accion>", p. ej. "planes_pago:select". */
  fallarDespues: Record<string, string>;
  /** Claves únicas por tabla, como en Postgres: el insert duplicado devuelve
   *  el código 23505 en vez de crear una segunda fila en silencio. */
  unicos: Record<string, string[]>;
  /** Defaults de columna, que Postgres aplica y el doble antes no. */
  defaults: Record<string, Fila>;
  llamadas: string[];
  cliente: unknown;
};

let secuencia = 0;
const nuevoId = () => `id-${++secuencia}`;

function aplica(fila: Fila, filtros: Filtro[]): boolean {
  return filtros.every((f) => {
    const v = fila[f.col];
    if (f.op === "eq") return String(v) === String(f.valor);
    if (f.op === "neq") return String(v) !== String(f.valor);
    if (f.op === "notin") return !(f.valor as string[]).map(String).includes(String(v));
    if (f.op === "is") return f.valor === null ? v == null : v === f.valor;
    return Array.isArray(f.valor) && f.valor.map(String).includes(String(v));
  });
}

export function crearDoble(datos: Record<string, Fila[]> = {}): Doble {
  const d: Doble = {
    tablas: { ...datos },
    fallar: {},
    fallarDespues: {},
    // Lo que declara el SQL de Abona618.
    unicos: { planes_pago: ["grupo_id"], abona618_config: ["id"] },
    defaults: {
      planes_pago: { estado: "al_dia", acepto_condiciones_en: "2026-10-12T12:00:00Z", condiciones_version: "v1" },
      cuotas: { avisos_enviados: 0 },
      abona618_config: { activo: false, tope_vip: 100, aviso_tope_vip: 90, aviso_tope_enviado_en: null },
    },
    llamadas: [],
    cliente: null,
  };

  const consulta = (tabla: string) => {
    const filtros: Filtro[] = [];
    let accion: "select" | "insert" | "update" | "delete" = "select";
    let carga: Fila[] = [];
    let afectadas: Fila[] = [];
    let yaCorrio = false;
    // .range() de PostgREST: límites INCLUSIVOS en los dos extremos.
    let rango: { desde: number; hasta: number } | null = null;
    let orden: { col: string; asc: boolean } | null = null;
    // select("id", { count: "exact", head: true }): cuenta sin traer filas.
    let contar: { head: boolean } | null = null;

    const filas = () => (d.tablas[tabla] ??= []);

    let choque: { message: string; code: string } | null = null;

    function correr() {
      if (yaCorrio) return;
      yaCorrio = true;
      if (accion === "insert") {
        const claves = d.unicos[tabla] ?? [];
        const porDefecto = d.defaults[tabla] ?? {};
        const nuevas: Fila[] = [];
        for (const f of carga) {
          const nueva = { id: nuevoId(), ...porDefecto, ...f };
          const repetida =
            claves.length > 0 &&
            filas().some((x) => claves.every((c) => f[c] !== undefined && String(x[c]) === String(f[c])));
          if (repetida) {
            // Postgres: unique_violation. El código lo mira quien llama.
            choque = { message: `duplicate key value violates unique constraint on ${tabla}`, code: "23505" };
            afectadas = [];
            return;
          }
          nuevas.push(nueva);
        }
        filas().push(...nuevas);
        afectadas = nuevas;
      } else if (accion === "update") {
        afectadas = filas().filter((f) => aplica(f, filtros));
        for (const f of afectadas) Object.assign(f, carga[0]);
      } else if (accion === "delete") {
        afectadas = filas().filter((f) => aplica(f, filtros));
        d.tablas[tabla] = filas().filter((f) => !aplica(f, filtros));
      } else {
        afectadas = filas().filter((f) => aplica(f, filtros));
      }
    }

    const error = () => (d.fallar[tabla] ? { message: d.fallar[tabla], code: "XXXXX" } : null);
    // Falla después de aplicar: el escenario del timeout real.
    const errorDespues = () => {
      const m = d.fallarDespues[`${tabla}:${accion}`];
      return m ? { message: m, code: "57014" } : null;
    };

    const api: Record<string, unknown> = {
      select: (_cols?: string, opciones?: { count?: string; head?: boolean }) => {
        if (accion === "select") d.llamadas.push(`select ${tabla}`);
        if (opciones?.count) contar = { head: Boolean(opciones.head) };
        return api;
      },
      insert: (v: Fila | Fila[]) => {
        accion = "insert";
        carga = Array.isArray(v) ? v : [v];
        d.llamadas.push(`insert ${tabla} x${carga.length}`);
        return api;
      },
      update: (v: Fila) => {
        accion = "update";
        carga = [v];
        d.llamadas.push(`update ${tabla}`);
        return api;
      },
      delete: () => {
        accion = "delete";
        d.llamadas.push(`delete ${tabla}`);
        return api;
      },
      eq: (col: string, valor: unknown) => (filtros.push({ col, op: "eq", valor }), api),
      neq: (col: string, valor: unknown) => (filtros.push({ col, op: "neq", valor }), api),
      is: (col: string, valor: unknown) => (filtros.push({ col, op: "is", valor }), api),
      in: (col: string, valor: unknown) => (filtros.push({ col, op: "in", valor }), api),
      // .not("col", "in", "(a,b)") — la forma que usa supabase-js para un NOT IN.
      not: (col: string, op: string, valor: unknown) => {
        if (op === "in") {
          const lista = String(valor).replace(/^\(|\)$/g, "").split(",").map((x) => x.trim());
          filtros.push({ col, op: "notin", valor: lista });
        } else if (op === "is") {
          filtros.push({ col, op: "neq", valor });
        }
        return api;
      },
      // `seleccionarTodo` pagina con .range() porque PostgREST corta en 1.000
      // filas sin avisar. El doble tiene que recortar de verdad: si devolviera
      // siempre todo, la prueba pasaría con un paginador roto.
      range: (desde: number, hasta: number) => {
        rango = { desde, hasta };
        return api;
      },
      // LIMIT: las pruebas que lo usan leen una sola fila (el evento).
      limit: (n: number) => {
        rango = { desde: 0, hasta: n - 1 };
        return api;
      },
      // ORDER BY. Paginar con .range() sin orden devuelve filas arbitrarias
      // entre páginas; el doble ordena de verdad para que una prueba lo note.
      order: (col: string, opciones?: { ascending?: boolean }) => {
        const asc = opciones?.ascending !== false;
        orden = { col, asc };
        return api;
      },
      maybeSingle: () => {
        const e = error();
        if (e) return Promise.resolve({ data: null, error: e });
        correr();
        if (choque) return Promise.resolve({ data: null, error: choque });
        const ed = errorDespues();
        if (ed) return Promise.resolve({ data: null, error: ed });
        // Como supabase-js: más de una fila es PGRST116, no "la primera".
        if (afectadas.length > 1) {
          return Promise.resolve({
            data: null,
            error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
          });
        }
        return Promise.resolve({ data: afectadas[0] ?? null, error: null });
      },
      single: () => {
        const e = error();
        if (e) return Promise.resolve({ data: null, error: e });
        correr();
        if (choque) return Promise.resolve({ data: null, error: choque });
        const ed = errorDespues();
        if (ed) return Promise.resolve({ data: null, error: ed });
        if (afectadas.length > 1) {
          return Promise.resolve({
            data: null,
            error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
          });
        }
        return Promise.resolve(
          afectadas[0] ? { data: afectadas[0], error: null } : { data: null, error: { message: "no rows", code: "PGRST116" } }
        );
      },
      // Un await directo sobre la consulta (sin maybeSingle/single).
      then: (res: (v: { data: Fila[] | null; error: { message: string; code?: string } | null; count?: number }) => unknown) => {
        const e = error();
        if (e) return Promise.resolve(res({ data: null, error: e }));
        correr();
        if (choque) return Promise.resolve(res({ data: null, error: choque }));
        const ed = errorDespues();
        if (ed) return Promise.resolve(res({ data: null, error: ed }));
        let ordenadas = afectadas;
        if (orden) {
          const { col, asc } = orden;
          ordenadas = [...afectadas].sort((a, b) => {
            const x = String(a[col] ?? "");
            const y = String(b[col] ?? "");
            return asc ? x.localeCompare(y) : y.localeCompare(x);
          });
        }
        const recortadas = rango ? ordenadas.slice(rango.desde, rango.hasta + 1) : ordenadas;
        if (contar) return Promise.resolve(res({ data: contar.head ? null : recortadas, error: null, count: afectadas.length }));
        return Promise.resolve(res({ data: recortadas, error: null }));
      },
    };
    return api;
  };

  d.cliente = { from: (tabla: string) => consulta(tabla) };
  return d;
}

export const CONFIG_ENCENDIDA = [
  { id: 1, activo: true, tope_vip: 100, aviso_tope_vip: 90, aviso_tope_enviado_en: null },
];

export const CONFIG_APAGADA_FILA = [
  { id: 1, activo: false, tope_vip: 100, aviso_tope_vip: 90, aviso_tope_enviado_en: null },
];
