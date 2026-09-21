import { SupabaseClient } from "@supabase/supabase-js";

const DOLARAPI_EURO_OFICIAL = "https://ve.dolarapi.com/v1/euros/oficial";

// Si la última tasa guardada es más vieja que esto, se considera vencida y se
// intenta refrescar en el momento (sin esperar al cron de las 8am).
const HORAS_VIGENCIA = 26;

// Si dolarapi.com falla, no lo reintentamos en cada render durante 5 minutos
// (cada intento cuesta hasta 6 s de espera al comprador).
let ultimoFalloApi = 0;
const MINUTOS_SIN_REINTENTAR = 5;

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

  if (Date.now() - ultimoFalloApi < MINUTOS_SIN_REINTENTAR * 60_000) return ultima?.valor ?? null;

  const refrescada = await actualizarTasaDesdeAPI(service);
  if (refrescada.ok) return refrescada.valor;

  ultimoFalloApi = Date.now();
  console.error("No se pudo refrescar la tasa vencida:", refrescada.error);
  return ultima?.valor ?? null;
}

// Al confirmar una compra en Bs se usa la tasa que el comprador VIO al pagar
// (la que devolvió iniciar), siempre que sea una tasa real guardada en las
// últimas 48 h — así no se le cobra un monto distinto si la tasa cambió
// mientras transfería, y tampoco se puede inventar una tasa desde el cliente.
export async function tasaParaConfirmar(service: SupabaseClient, tasaMostrada: number | undefined): Promise<number | null> {
  if (tasaMostrada && Number.isFinite(tasaMostrada) && tasaMostrada > 0) {
    const desde = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const { data } = await service
      .from("tasas_cambio")
      .select("valor")
      .eq("moneda", "EUR")
      .gte("actualizado_en", desde)
      .order("actualizado_en", { ascending: false })
      .limit(10);
    if ((data ?? []).some((r) => Math.abs(Number(r.valor) - tasaMostrada) < 0.0001)) return tasaMostrada;
  }
  return obtenerTasaActual(service);
}

// Reparte un total en Bs entre N tickets proporcionalmente a su precio en USD,
// ajustando el último para que la suma dé EXACTO el total que se le indicó al
// comprador (si se redondea línea por línea, la suma puede diferir por céntimos).
export function repartirBs(preciosUsd: number[], totalBs: number | null): (number | null)[] {
  if (totalBs == null || preciosUsd.length === 0) return preciosUsd.map(() => null);
  const totalUsd = preciosUsd.reduce((s, p) => s + p, 0);
  if (totalUsd <= 0) return preciosUsd.map(() => 0);
  const partes = preciosUsd.map((p) => Math.round((totalBs * (p / totalUsd)) * 100) / 100);
  const suma = partes.reduce((s, p) => s + p, 0);
  partes[partes.length - 1] = Math.round((partes[partes.length - 1] + (totalBs - suma)) * 100) / 100;
  return partes;
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

  // Cordura: un dedo de más ("9771834" en vez de "977.18") multiplicaría por
  // 10.000 lo que se le cobra a todo el mundo. Se rechaza más de ±30 % de
  // diferencia con la última tasa guardada.
  const ultima = await leerUltimaTasa(service);
  if (ultima && (valor > ultima.valor * 1.3 || valor < ultima.valor * 0.7)) {
    return {
      ok: false,
      error: `Ese valor difiere más de 30 % de la última tasa (Bs ${ultima.valor.toLocaleString("es-VE")}). Revisa el número; si es correcto, escríbele a Anita para forzarlo.`,
    };
  }

  const { error } = await service.from("tasas_cambio").insert({ moneda: "EUR", valor });
  if (error) {
    return { ok: false, error: `Error guardando la tasa: ${error.message}` };
  }

  return { ok: true, valor, fecha: new Date().toISOString() };
}
