import { SupabaseClient } from "@supabase/supabase-js";

const DOLARAPI_EURO_OFICIAL = "https://ve.dolarapi.com/v1/euros/oficial";

// Última tasa EUR/VES guardada en la base (la actualiza el cron de las 8am).
// Si todavía no hay ninguna (antes de la primera corrida del cron), retorna null
// y quien la use debe mostrar "tasa no disponible" en vez de un número inventado.
export async function obtenerTasaActual(service: SupabaseClient): Promise<number | null> {
  const { data, error } = await service
    .from("tasas_cambio")
    .select("valor")
    .eq("moneda", "EUR")
    .order("actualizado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error leyendo tasa de cambio:", error.message);
    return null;
  }
  return data?.valor ?? null;
}

export function convertirABs(montoUsd: number, tasaEurVes: number): number {
  // La tasa que da dolarapi es EUR->VES. Se usa 1:1 EUR≈USD como aproximación
  // operativa (así lo pidió Anita: "tasa euro" para todo pago en bolívares).
  return Math.round(montoUsd * tasaEurVes * 100) / 100;
}

export type ActualizarTasaResultado =
  | { ok: true; valor: number; fecha: string }
  | { ok: false; error: string };

// Llamado por el cron diario — trae la tasa oficial (BCV) del euro desde
// dolarapi.com y la guarda como el nuevo registro vigente.
export async function actualizarTasaDesdeAPI(service: SupabaseClient): Promise<ActualizarTasaResultado> {
  let respuesta: Response;
  try {
    respuesta = await fetch(DOLARAPI_EURO_OFICIAL, { cache: "no-store" });
  } catch (e) {
    return { ok: false, error: `No se pudo contactar dolarapi.com: ${(e as Error).message}` };
  }

  if (!respuesta.ok) {
    return { ok: false, error: `dolarapi.com respondió ${respuesta.status}` };
  }

  const json = (await respuesta.json()) as { promedio?: number; fechaActualizacion?: string };
  if (typeof json.promedio !== "number" || json.promedio <= 0) {
    return { ok: false, error: "Respuesta de dolarapi.com sin un valor de tasa válido." };
  }

  const { error } = await service.from("tasas_cambio").insert({
    moneda: "EUR",
    valor: json.promedio,
  });

  if (error) {
    return { ok: false, error: `Error guardando la tasa: ${error.message}` };
  }

  return { ok: true, valor: json.promedio, fecha: json.fechaActualizacion ?? new Date().toISOString() };
}
