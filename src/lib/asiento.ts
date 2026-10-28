import type { SupabaseClient } from "@supabase/supabase-js";
import { conAsiento, ETIQUETA_TIPO, type Tipo } from "@/lib/precios";

export type Asiento = { fila: string; mesaNumero: number; sillaNumero: number };

// Trae mesa y silla de un ticket VIP con DOS consultas simples, sin "embeds"
// de Supabase (tickets → sillas_vip → mesas_vip en una sola consulta).
//
// Por qué: supabase/seed_vip.sql hizo `drop table sillas_vip cascade` y la
// volvió a crear. Ese CASCADE borró la clave foránea tickets.silla_id →
// sillas_vip(id) y nadie la volvió a crear. Sin esa relación en la base,
// PostgREST no puede resolver `sillas_vip(...)` dentro de un select de
// tickets y devuelve error — y el código, que descartaba el error, lo
// mostraba como "No se encontró ese ticket" (Finanzas) o "YA USADO"
// (puerta). Con consultas separadas no dependemos de que exista la FK.
//
// supabase/reparar_fk_tickets_sillas.sql restaura la FK cuando haya acceso a
// Supabase, pero la app ya no la necesita para funcionar.
export async function obtenerAsiento(service: SupabaseClient, sillaId: string | null): Promise<Asiento | null> {
  if (!sillaId) return null;

  const { data: silla, error: sillaError } = await service
    .from("sillas_vip")
    .select("numero, mesa_id")
    .eq("id", sillaId)
    .maybeSingle();

  if (sillaError) {
    console.error("Error leyendo silla del ticket:", sillaError.message);
    return null;
  }
  if (!silla) return null;

  const { data: mesa, error: mesaError } = await service
    .from("mesas_vip")
    .select("numero, fila")
    .eq("id", silla.mesa_id)
    .maybeSingle();

  if (mesaError) {
    console.error("Error leyendo mesa del ticket:", mesaError.message);
    return null;
  }
  if (!mesa) return null;

  return { fila: mesa.fila as string, mesaNumero: mesa.numero as number, sillaNumero: silla.numero as number };
}

// VIP se lee como siempre ("Fila A · Mesa 4 · Silla 3"). Preferencial lleva
// su nombre adelante porque sus filas son "1" y "2", y en la puerta "Fila 1"
// a secas se confunde con la primera fila del VIP.
export function describirAsiento(tipo: Tipo | string, asiento: Asiento | null): string {
  if (!conAsiento(tipo as Tipo)) return "General";
  if (!asiento) return `${ETIQUETA_TIPO[tipo as Tipo]} (silla no encontrada — revisar en Finanzas)`;
  const base = `Fila ${asiento.fila} · Mesa ${asiento.mesaNumero} · Silla ${asiento.sillaNumero}`;
  return tipo === "preferencial" ? `Preferencial · ${base}` : base;
}

// ---------------------------------------------------------------------------
// Puestos apartados de una compra, para mostrarlos ANTES del QR (Anita, 15 oct:
// quien paga en cuotas pasaba seis semanas sin ver por escrito qué mesa y qué
// sillas apartó; solo salían en el correo final de los QR).
//
// Dos consultas en total, no una por silla. Si algo no cuadra (la base falla,
// falta una silla o su mesa) devuelve null y quien llama NO muestra nada:
// un "Sillas 3 y 4" cuando compró tres sería peor que no decir nada.
// ---------------------------------------------------------------------------
export async function obtenerAsientos(
  service: SupabaseClient,
  sillaIds: readonly (string | null | undefined)[]
): Promise<Asiento[] | null> {
  const ids = [...new Set(sillaIds.filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return [];
  try {
    const { data: sillas, error } = await service.from("sillas_vip").select("id, numero, mesa_id").in("id", ids);
    if (error) {
      console.error("Error leyendo las sillas de la compra:", error.message);
      return null;
    }
    if (!sillas || sillas.length !== ids.length) return null;

    const mesaIds = [...new Set(sillas.map((s) => String(s.mesa_id)))];
    const { data: mesas, error: mesaError } = await service.from("mesas_vip").select("id, numero, fila").in("id", mesaIds);
    if (mesaError) {
      console.error("Error leyendo las mesas de la compra:", mesaError.message);
      return null;
    }
    const mesaPorId = new Map((mesas ?? []).map((m) => [String(m.id), m]));

    const asientos: Asiento[] = [];
    for (const s of sillas) {
      const m = mesaPorId.get(String(s.mesa_id));
      if (!m) return null;
      asientos.push({ fila: String(m.fila), mesaNumero: Number(m.numero), sillaNumero: Number(s.numero) });
    }
    return asientos;
  } catch (e) {
    console.error("Error leyendo los puestos de la compra:", (e as Error).message);
    return null;
  }
}

/** "3", "3 y 4", "3, 4 y 5" */
function listaNumeros(nums: number[]): string {
  if (nums.length <= 1) return nums.join("");
  return `${nums.slice(0, -1).join(", ")} y ${nums[nums.length - 1]}`;
}

/** Una línea por mesa, en orden de fila, mesa y silla:
 *  "Preferencial · Fila 1 · Mesa 4 · Sillas 3, 4 y 5" / "Fila A · Mesa 2 · Silla 7". */
export function resumirAsientos(tipo: Tipo | string, asientos: readonly Asiento[]): string[] {
  const porMesa = new Map<string, { fila: string; mesa: number; sillas: number[] }>();
  for (const a of asientos) {
    const clave = `${a.fila}|${a.mesaNumero}`;
    const grupo = porMesa.get(clave) ?? { fila: a.fila, mesa: a.mesaNumero, sillas: [] };
    grupo.sillas.push(a.sillaNumero);
    porMesa.set(clave, grupo);
  }
  return [...porMesa.values()]
    .sort((x, y) => x.fila.localeCompare(y.fila, "es", { numeric: true }) || x.mesa - y.mesa)
    .map((g) => {
      const sillas = [...new Set(g.sillas)].sort((a, b) => a - b);
      const base = `Fila ${g.fila} · Mesa ${g.mesa} · ${sillas.length === 1 ? "Silla" : "Sillas"} ${listaNumeros(sillas)}`;
      return tipo === "preferencial" ? `Preferencial · ${base}` : base;
    });
}

/** Lo que muestran el correo y la página de compra. [] = no mostrar nada
 *  (General, sin sillas, o no se pudo leer con certeza). Nunca lanza. */
export async function lineasDeAsientos(
  service: SupabaseClient,
  tipo: Tipo | string,
  sillaIds: readonly (string | null | undefined)[]
): Promise<string[]> {
  if (!conAsiento(tipo as Tipo)) return [];
  const asientos = await obtenerAsientos(service, sillaIds);
  return asientos && asientos.length > 0 ? resumirAsientos(tipo, asientos) : [];
}

/** Igual que lineasDeAsientos, pero con los tickets de la compra: sirve para
 *  las compras mixtas (28 oct), donde cada ticket trae su zona. Primero VIP,
 *  después Preferencial; General no tiene silla. Una compra de una sola zona
 *  da exactamente lo mismo que lineasDeAsientos. */
export async function lineasDeAsientosDe(
  service: SupabaseClient,
  tickets: readonly { tipo: Tipo | string; silla_id: string | null | undefined }[]
): Promise<string[]> {
  const lineas: string[] = [];
  for (const zona of ["vip", "preferencial"] as const) {
    const sillas = tickets.filter((t) => t.tipo === zona).map((t) => t.silla_id);
    if (sillas.length > 0) lineas.push(...(await lineasDeAsientos(service, zona, sillas)));
  }
  return lineas;
}

/** Lo que se imprime en la entrada, el correo y la puerta para cualquier tipo. */
export function descripcionEntrada(tipo: Tipo | string, asiento: Asiento | null): string {
  if (!conAsiento(tipo as Tipo)) return "Acceso general · sin asiento asignado";
  return describirAsiento(tipo, asiento);
}
