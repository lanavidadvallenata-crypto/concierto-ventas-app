import { SupabaseClient } from "@supabase/supabase-js";

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

// Trae el mapa completo (todas las mesas/sillas con su estado real) agrupado
// por fila y mesa, listo para pintar en el componente visual.
export async function obtenerMapaVip(service: SupabaseClient): Promise<MesaMapa[]> {
  await liberarSillasVencidas(service);

  const { data: mesas, error: mesasError } = await service
    .from("mesas_vip")
    .select("id, fila, numero")
    .order("fila")
    .order("numero");

  if (mesasError || !mesas) {
    console.error("Error cargando mesas VIP:", mesasError);
    return [];
  }

  const { data: sillas, error: sillasError } = await service
    .from("sillas_vip")
    .select("id, numero, mesa_id, estado")
    .order("numero");

  if (sillasError) {
    console.error("Error cargando sillas VIP:", sillasError);
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
    sillas: sillasPorMesa.get(m.id) ?? [],
  }));
}
