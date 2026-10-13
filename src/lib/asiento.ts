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

/** Lo que se imprime en la entrada, el correo y la puerta para cualquier tipo. */
export function descripcionEntrada(tipo: Tipo | string, asiento: Asiento | null): string {
  if (!conAsiento(tipo as Tipo)) return "Acceso general · sin asiento asignado";
  return describirAsiento(tipo, asiento);
}
