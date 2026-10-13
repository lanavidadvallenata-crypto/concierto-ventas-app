import { SupabaseClient } from "@supabase/supabase-js";
import type { Zona } from "@/lib/precios";

export type EstadoSilla = "disponible" | "reservada" | "vendida";

export type SillaMapa = {
  id: string;
  numero: number;
  estado: EstadoSilla;
};

export type MesaMapa = {
  id: string;
  fila: string;
  numero: number;
  zona: Zona;
  sillas: SillaMapa[];
};

// Libera de forma perezosa cualquier bloqueo temporal vencido antes de leer o
// intentar reservar — evita depender de un cron corriendo cada minuto.
export async function liberarSillasVencidas(service: SupabaseClient) {
  const { error } = await service.rpc("liberar_sillas_vencidas");
  if (error) {
    // No bloquea la carga del mapa — solo significa que, hasta correr la migración
    // supabase/agregar_bloqueo_temporal.sql, los bloqueos vencidos no se liberan solos.
    console.error("liberar_sillas_vencidas no disponible todavía:", error.message);
  }
}

// Trae el mapa completo de UNA zona (todas sus mesas/sillas con su estado
// real) agrupado por fila y mesa, listo para pintar en el componente visual.
//
// VIP y Preferencial comparten tablas (mesas_vip / sillas_vip) y se
// distinguen por mesas_vip.zona (supabase/preferencial_1_estructura_13oct.sql).
// Se filtra en la base, no en JS: así la pestaña VIP nunca pinta una mesa
// Preferencial ni al revés, aunque alguien cargue mesas a mano.
export async function obtenerMapaVip(service: SupabaseClient, zona: Zona = "vip"): Promise<MesaMapa[]> {
  await liberarSillasVencidas(service);

  let { data: mesas, error: mesasError } = await service
    .from("mesas_vip")
    .select("id, fila, numero, zona")
    .eq("zona", zona)
    .order("fila")
    .order("numero");

  // Red de seguridad para el despliegue: si el código nuevo llega antes de
  // correr preferencial_1_estructura_13oct.sql, la columna `zona` no existe
  // todavía. En ese caso todo lo que hay es VIP y se sigue vendiendo igual;
  // Preferencial simplemente no aparece hasta que corra el SQL.
  if (mesasError && /zona/.test(mesasError.message)) {
    console.error("mesas_vip.zona no existe todavía — corre supabase/preferencial_1_estructura_13oct.sql");
    if (zona !== "vip") return [];
    const sinZona = await service.from("mesas_vip").select("id, fila, numero").order("fila").order("numero");
    mesas = (sinZona.data ?? []).map((m) => ({ ...m, zona: "vip" }));
    mesasError = sinZona.error;
  }

  if (mesasError || !mesas) {
    console.error(`Error cargando mesas ${zona}:`, mesasError);
    return [];
  }
  if (mesas.length === 0) return [];

  const { data: sillas, error: sillasError } = await service
    .from("sillas_vip")
    .select("id, numero, mesa_id, estado")
    .in(
      "mesa_id",
      mesas.map((m) => m.id)
    )
    .order("numero");

  if (sillasError) {
    console.error(`Error cargando sillas ${zona}:`, sillasError);
  }

  const sillasPorMesa = new Map<string, SillaMapa[]>();
  for (const s of sillas ?? []) {
    const lista = sillasPorMesa.get(s.mesa_id) ?? [];
    lista.push({ id: s.id, numero: s.numero, estado: s.estado as EstadoSilla });
    sillasPorMesa.set(s.mesa_id, lista);
  }

  return mesas.map((m) => ({
    id: m.id,
    fila: m.fila,
    numero: m.numero,
    zona: (m.zona as Zona) ?? "vip",
    sillas: sillasPorMesa.get(m.id) ?? [],
  }));
}

/** Los dos mapas de una vez, para las pantallas que venden ambas zonas. */
export async function obtenerMapas(service: SupabaseClient): Promise<Record<Zona, MesaMapa[]>> {
  const [vip, preferencial] = await Promise.all([obtenerMapaVip(service, "vip"), obtenerMapaVip(service, "preferencial")]);
  return { vip, preferencial };
}

export function sillasDisponibles(mesas: MesaMapa[]): number {
  return mesas.reduce((total, m) => total + m.sillas.filter((s) => s.estado === "disponible").length, 0);
}

/**
 * ¿Todas estas sillas son de la zona que dice la compra?
 *
 * El tipo viene del navegador y el precio sale del tipo: sin este chequeo, un
 * POST con tipo "preferencial" y sillas VIP compraría una silla de $140 a
 * $70. Se verifica contra la base ANTES de reservar, en las tres puertas
 * (web, Ventas y Taquilla). Devuelve false también si alguna silla no
 * existe o si la base no responde: en la duda, no se vende.
 */
export async function sillasSonDeZona(service: SupabaseClient, sillaIds: string[], zona: Zona): Promise<boolean> {
  const ids = [...new Set(sillaIds)];
  if (ids.length === 0) return false;

  const { data: sillas, error } = await service.from("sillas_vip").select("id, mesa_id").in("id", ids);
  if (error || !sillas || sillas.length !== ids.length) {
    if (error) console.error("sillasSonDeZona: no se pudieron leer las sillas —", error.message);
    return false;
  }

  const mesaIds = [...new Set(sillas.map((s) => s.mesa_id as string))];
  const { data: mesas, error: errorMesas } = await service.from("mesas_vip").select("id, zona").in("id", mesaIds);
  if (errorMesas && /zona/.test(errorMesas.message)) {
    // Misma red de seguridad que obtenerMapaVip: sin la columna, todo es VIP.
    console.error("sillasSonDeZona: mesas_vip.zona no existe todavía — corre supabase/preferencial_1_estructura_13oct.sql");
    return zona === "vip";
  }
  if (errorMesas || !mesas || mesas.length !== mesaIds.length) {
    if (errorMesas) console.error("sillasSonDeZona: no se pudieron leer las mesas —", errorMesas.message);
    return false;
  }
  return mesas.every((m) => (m.zona ?? "vip") === zona);
}
