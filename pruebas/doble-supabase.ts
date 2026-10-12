// Doble de Supabase en memoria: lo justo de la API encadenada que usa
// abona618.ts, para poder probar la orquestación sin una base de datos.
//
// No pretende imitar a Postgres. Pretende responder a las mismas llamadas con
// los mismos datos, para que las pruebas atrapen errores de orden, de estado y
// de condición de carrera (los UPDATE condicionados a "sigue sin verificar").

type Fila = Record<string, unknown>;
type Filtro = { col: string; op: "eq" | "is" | "in"; valor: unknown };

export type Doble = {
  tablas: Record<string, Fila[]>;
  /** Para forzar un fallo y probar el camino de error. */
  fallar: Record<string, string>;
  llamadas: string[];
  cliente: unknown;
};

let secuencia = 0;
const nuevoId = () => `id-${++secuencia}`;

function aplica(fila: Fila, filtros: Filtro[]): boolean {
  return filtros.every((f) => {
    const v = fila[f.col];
    if (f.op === "eq") return String(v) === String(f.valor);
    if (f.op === "is") return f.valor === null ? v == null : v === f.valor;
    return Array.isArray(f.valor) && f.valor.map(String).includes(String(v));
  });
}

export function crearDoble(datos: Record<string, Fila[]> = {}): Doble {
  const d: Doble = { tablas: { ...datos }, fallar: {}, llamadas: [], cliente: null };

  const consulta = (tabla: string) => {
    const filtros: Filtro[] = [];
    let accion: "select" | "insert" | "update" | "delete" = "select";
    let carga: Fila[] = [];
    let afectadas: Fila[] = [];
    let yaCorrio = false;

    const filas = () => (d.tablas[tabla] ??= []);

    function correr() {
      if (yaCorrio) return;
      yaCorrio = true;
      if (accion === "insert") {
        const nuevas = carga.map((f) => ({ id: nuevoId(), ...f }));
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

    const error = () => (d.fallar[tabla] ? { message: d.fallar[tabla] } : null);

    const api: Record<string, unknown> = {
      select: (_cols?: string) => {
        if (accion === "select") d.llamadas.push(`select ${tabla}`);
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
      is: (col: string, valor: unknown) => (filtros.push({ col, op: "is", valor }), api),
      in: (col: string, valor: unknown) => (filtros.push({ col, op: "in", valor }), api),
      maybeSingle: () => {
        const e = error();
        if (e) return Promise.resolve({ data: null, error: e });
        correr();
        return Promise.resolve({ data: afectadas[0] ?? null, error: null });
      },
      single: () => {
        const e = error();
        if (e) return Promise.resolve({ data: null, error: e });
        correr();
        return Promise.resolve(
          afectadas[0] ? { data: afectadas[0], error: null } : { data: null, error: { message: "no rows" } }
        );
      },
      // Un await directo sobre la consulta (sin maybeSingle/single).
      then: (res: (v: { data: Fila[] | null; error: { message: string } | null }) => unknown) => {
        const e = error();
        if (e) return Promise.resolve(res({ data: null, error: e }));
        correr();
        return Promise.resolve(res({ data: afectadas, error: null }));
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
