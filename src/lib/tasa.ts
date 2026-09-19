import { SupabaseClient } from "@supabase/supabase-js";

const DOLARAPI_EURO_OFICIAL = "https://ve.dolarapi.com/v1/euros/oficial";

// Si la última tasa guardada es más vieja que esto, se considera vencida y se
// intenta refrescar en el momento (sin esperar al cron de las 8am).
const HORAS_VIGENCIA = 26;

type TasaFila = { valor: number; actualizado_en: string };

async function leerUltimaTasa(service: SupabaseClient): Promise<TasaFila | null> {
  const { data, error } = await service
    .from("tasas_cambio")
    .select("valor, actualizado_en")
    .eq("moneda", "EUR")
    .order("actualizado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error leyendo tasa de cambio:", error.message);
    return null;
  }
  return data ? { valor: Number(data.valor), actualizado_en: data.actualizado_en as string } : null;
}

// Tasa EUR/VES vigente. Se calcula sola: lee la última guardada y, si no hay
// ninguna o tiene más de 26 h (el cron de las 8am no corrió, faltó CRON_SECRET,
// Vercel lo saltó…), la trae de dolarapi.com en ese momento y la guarda.
// Solo devuelve null si no hay tasa guardada Y dolarapi.com tampoco responde —
// en ese caso quien la use debe mostrar "tasa no disponible", nunca un número
// inventado.
export async function obtenerTasaActual(service: SupabaseClient): Promise<number | null> {
  const ultima = await leerUltimaTasa(service);
  const vencida = !ultima || Date.now() - new Date(ultima.actualizado_en).getTime() > HORAS_VIGENCIA * 3_600_000;

  if (!vencida) return ultima!.valor;

  const refrescada = await actualizarTasaDesdeAPI(service);
  if (refrescada.ok) return refrescada.valor;

  console.error("No se pudo refrescar la tasa vencida:", refrescada.error);
  return ultima?.valor ?? null;
}

export function convertirABs(montoUsd: number, tasaEurVes: number): number {
  // La tasa que da dolarapi es EUR->VES. Se usa 1:1 EUR≈USD como aproximación
  // operativa (así lo pidió Anita: "tasa euro" para todo pago en bolívares).
  return Math.round(montoUsd * tasaEurVes * 100) / 100;
}

export type ActualizarTasaResultado =
  | { ok: true; valor: number; fecha: string }
  | { ok: false; error: string };

// Llamado por el cron diario (y por obtenerTasaActual si la tasa venció) —
// trae la tasa oficial (BCV) del euro desde dolarapi.com y la guarda como el
// nuevo registro vigente.
export async function actualizarTasaDesdeAPI(service: SupabaseClient): Promise<ActualizarTasaResultado> {
  let respuesta: Response;
  try {
    respuesta = await fetch(DOLARAPI_EURO_OFICIAL, { cache: "no-store", signal: AbortSignal.timeout(6000) });
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

// Actualización manual (Finanzas) — para corregir/adelantar la tasa del día a mano.
export async function guardarTasaManual(service: SupabaseClient, valor: number): Promise<ActualizarTasaResultado> {
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, error: "El valor de la tasa debe ser un número mayor a 0." };
  }

  const { error } = await service.from("tasas_cambio").insert({ moneda: "EUR", valor });
  if (error) {
    return { ok: false, error: `Error guardando la tasa: ${error.message}` };
  }

  return { ok: true, valor, fecha: new Date().toISOString() };
}
