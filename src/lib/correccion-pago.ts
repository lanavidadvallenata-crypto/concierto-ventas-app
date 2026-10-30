// Corregir un pago mal anotado sin rechazarlo ni volver a anotarlo (Anita,
// 30 oct: "varias personas hoy registraron mal los montos de sus pagos... que
// dentro del mismo sistema, sin estar eliminando ni cancelando, podamos
// ajustar esos montos").
//
// Qué se puede corregir: método, referencia y monto en Bs de un pago que ya
// está anotado. Nunca el monto en dólares de la cuota (eso es el plan, no el
// pago) ni su estado: un pago por confirmar sigue por confirmar.
//
// Quién: cualquiera del equipo de Cobranza mientras el pago está por
// confirmar; un pago YA confirmado solo lo corrige un admin. Cada corrección
// deja en la nota de la cuota quién la hizo, cuándo y qué decía antes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ETIQUETA_METODO, formatoBs } from "@/lib/formato";
import { METODOS_PAGO, metodoEsEnBs, normalizarReferencia, validarReferencia, type Canal, type MetodoPago } from "@/lib/pagos";

/** Lo que se tolera entre lo transferido y lo que vale la cuota antes de
 *  avisar: la tasa cambia de un día a otro y hay quien redondea, pero un
 *  monto con la coma corrida (x10, x100) cae muy lejos. */
export const TOLERANCIA_MONTO = 0.15;

/** Bs que corresponden a un monto en dólares a una tasa. */
export function bsEsperado(montoUsd: number, tasa: number): number {
  return Math.round(montoUsd * tasa * 100) / 100;
}

/**
 * ¿El monto en Bs reportado no cuadra con lo que vale la cuota? Devuelve
 * cuántos dólares serían esos bolívares y cuántos Bs se esperaban, o null si
 * cuadra o no hay con qué comparar.
 */
export function montoNoCuadra(
  montoBs: number | null | undefined,
  montoUsd: number,
  tasa: number | null | undefined
): { usdEquivalente: number; esperadoBs: number } | null {
  if (montoBs == null || !tasa || tasa <= 0 || montoUsd <= 0) return null;
  const esperadoBs = bsEsperado(montoUsd, tasa);
  const razon = montoBs / esperadoBs;
  if (razon >= 1 - TOLERANCIA_MONTO && razon <= 1 + TOLERANCIA_MONTO) return null;
  return { usdEquivalente: Math.round((montoBs / tasa) * 100) / 100, esperadoBs };
}

/** "20.848,80": como se escribe en Venezuela, sin el "Bs". Para prellenar. */
export function bsParaEscribir(monto: number): string {
  return monto.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Reparte un total en Bs entre varias cuotas en proporción a lo que vale
 *  cada una, cuadrando al céntimo (igual que al anotar). */
export function repartirEnBs(total: number, pesos: number[]): number[] {
  const centavos = Math.round(total * 100);
  const suma = pesos.reduce((s, p) => s + p, 0);
  if (pesos.length === 0) return [];
  if (suma <= 0) return pesos.map(() => 0);
  const partes = pesos.map((p) => Math.round((centavos * p) / suma));
  partes[partes.length - 1] += centavos - partes.reduce((s, x) => s + x, 0);
  return partes.map((c) => c / 100);
}

export type CuotaDePago = {
  id: string;
  montoUsd: number;
  metodoPago: string | null;
  referenciaPago: string | null;
  montoBs: number | null;
  reportadoEn: string | null;
  verificadoEn: string | null;
  nota: string | null;
};

/**
 * Las cuotas que entraron con el MISMO pago que `cuotaId`: un comprobante
 * puede cubrir varias cuotas, y entonces se anotan juntas con la misma
 * referencia y sus Bs repartidos. Corregir una sola dejaría el pago partido en
 * dos versiones. Mismo pago = misma referencia, mismo estado (por confirmar o
 * confirmado) y anotadas con menos de 5 minutos de diferencia.
 */
export function cuotasDelMismoPago(todas: CuotaDePago[], cuotaId: string): CuotaDePago[] {
  const base = todas.find((c) => c.id === cuotaId);
  if (!base) return [];
  if (!base.referenciaPago || !base.reportadoEn) return [base];
  const t0 = Date.parse(base.reportadoEn);
  return todas.filter(
    (c) =>
      c.id === base.id ||
      (c.referenciaPago === base.referenciaPago &&
        Boolean(c.verificadoEn) === Boolean(base.verificadoEn) &&
        c.reportadoEn != null &&
        Math.abs(Date.parse(c.reportadoEn) - t0) <= 5 * 60_000)
  );
}

function fechaHoraVe(d: Date): string {
  return d.toLocaleString("es-VE", {
    timeZone: "America/Caracas",
    day: "2-digit",
    month: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** La línea que queda en la nota: quién, cuándo y qué decía antes. */
export function lineaDeCorreccion(
  quien: string,
  antes: { metodoPago: string | null; referenciaPago: string | null; montoBsTotal: number | null },
  ahora: Date = new Date()
): string {
  const metodo = antes.metodoPago ? (ETIQUETA_METODO[antes.metodoPago] ?? antes.metodoPago) : "sin método";
  const partes = [metodo, antes.referenciaPago ? `ref. ${antes.referenciaPago}` : "sin referencia"];
  if (antes.montoBsTotal != null) partes.push(formatoBs(antes.montoBsTotal));
  return `Corregido por ${quien} el ${fechaHoraVe(ahora)} · antes: ${partes.join(" · ")}.`;
}

export type DatosCorreccion = {
  cuotaId: string;
  metodoPago: MetodoPago;
  referenciaPago: string;
  /** Obligatorio si el método es en Bs; es el TOTAL del comprobante. */
  montoBs?: number | null;
  quien: { id: string; nombre: string; esAdmin: boolean };
};

export type ResultadoCorreccion =
  | { ok: true; cuotas: number; cambio: boolean; resumen: string }
  | { ok: false; error: string };

const leerCuota = (f: Record<string, unknown>): CuotaDePago & { planId: string } => ({
  id: String(f.id),
  planId: String(f.plan_id),
  montoUsd: Number(f.monto_usd),
  metodoPago: (f.metodo_pago as string | null) ?? null,
  referenciaPago: (f.referencia_pago as string | null) ?? null,
  montoBs: f.monto_bs == null ? null : Number(f.monto_bs),
  reportadoEn: (f.reportado_en as string | null) ?? null,
  verificadoEn: (f.verificado_en as string | null) ?? null,
  nota: (f.nota as string | null) ?? null,
});

const COLUMNAS = "id, plan_id, monto_usd, metodo_pago, referencia_pago, monto_bs, reportado_en, verificado_en, nota";

export async function corregirPago(service: SupabaseClient, d: DatosCorreccion): Promise<ResultadoCorreccion> {
  const errorRef = validarReferencia(d.metodoPago, d.referenciaPago);
  if (errorRef) return { ok: false, error: errorRef };
  const referencia = normalizarReferencia(d.metodoPago, d.referenciaPago);

  const enBs = metodoEsEnBs(d.metodoPago);
  if (enBs && (d.montoBs == null || !(d.montoBs > 0))) {
    return { ok: false, error: "Ese método es en bolívares: escribe el monto exacto del comprobante." };
  }
  const montoBsTotal = enBs ? Math.round(Number(d.montoBs) * 100) / 100 : null;

  const { data: fila, error } = await service.from("cuotas").select(COLUMNAS).eq("id", d.cuotaId).maybeSingle();
  if (error) return { ok: false, error: "No se pudo leer ese pago. Intenta de nuevo." };
  if (!fila) return { ok: false, error: "No encontramos ese pago. Recarga la pantalla." };
  const cuota = leerCuota(fila as Record<string, unknown>);

  if (!cuota.reportadoEn && !cuota.verificadoEn) {
    return { ok: false, error: "Esa cuota no tiene ningún pago anotado: usa \"Anotar un pago\"." };
  }
  if (cuota.verificadoEn && !d.quien.esAdmin) {
    return { ok: false, error: "Ese pago ya está confirmado: solo un admin puede corregirlo." };
  }

  const { data: filasPlan, error: errorPlan } = await service.from("cuotas").select(COLUMNAS).eq("plan_id", cuota.planId);
  if (errorPlan || !filasPlan) return { ok: false, error: "No se pudo leer el plan de ese pago. Intenta de nuevo." };
  const delPago = cuotasDelMismoPago((filasPlan as Record<string, unknown>[]).map(leerCuota), cuota.id);

  const totalAntes = delPago.every((c) => c.montoBs == null)
    ? null
    : Math.round(delPago.reduce((s, c) => s + (c.montoBs ?? 0), 0) * 100) / 100;

  const igual =
    delPago.every((c) => c.metodoPago === d.metodoPago && c.referenciaPago === referencia) &&
    (montoBsTotal == null ? totalAntes == null : totalAntes != null && Math.abs(totalAntes - montoBsTotal) < 0.005);
  if (igual) return { ok: true, cuotas: delPago.length, cambio: false, resumen: "No había nada que cambiar: ya decía eso." };

  const linea = lineaDeCorreccion(d.quien.nombre, { metodoPago: cuota.metodoPago, referenciaPago: cuota.referenciaPago, montoBsTotal: totalAntes });
  const bsPorCuota = montoBsTotal == null ? delPago.map(() => null) : repartirEnBs(montoBsTotal, delPago.map((c) => c.montoUsd));

  for (let i = 0; i < delPago.length; i++) {
    const c = delPago[i];
    const nota = [c.nota?.trim(), linea].filter(Boolean).join(" ").slice(-1000);
    let q = service
      .from("cuotas")
      .update({ metodo_pago: d.metodoPago, referencia_pago: referencia, monto_bs: bsPorCuota[i], nota })
      .eq("id", c.id);
    // Si alguien lo confirmó mientras se corregía, no se toca: lo confirmado
    // solo lo corrige un admin, a sabiendas.
    if (!c.verificadoEn) q = q.is("verificado_en", null);
    const { data: ok, error: errorUpd } = await q.select("id").maybeSingle();
    if (errorUpd) {
      console.error(`Corrección de pago: falló la cuota ${c.id} —`, errorUpd.message);
      return { ok: false, error: i === 0 ? "No se pudo guardar la corrección. Intenta de nuevo." : "Se corrigió solo una parte del pago. Vuelve a intentarlo: es seguro repetirlo." };
    }
    if (!ok) {
      return { ok: false, error: "Ese pago se confirmó mientras lo corregías. Recarga la pantalla." };
    }
  }

  const ahora = [ETIQUETA_METODO[d.metodoPago] ?? d.metodoPago, `ref. ${referencia}`];
  if (montoBsTotal != null) ahora.push(formatoBs(montoBsTotal));
  return {
    ok: true,
    cuotas: delPago.length,
    cambio: true,
    resumen: `Pago corregido${delPago.length > 1 ? ` (cubre ${delPago.length} cuotas)` : ""}: ${ahora.join(" · ")}. Quedó anotado quién lo cambió y qué decía antes.`,
  };
}

// ---------------------------------------------------------------------------
// Compras de contado pendientes (Finanzas). Ahí el monto lo fija el sistema al
// comprar; lo que la gente escribe mal es la referencia, o elige pago móvil y
// pagó por transferencia. Se puede cambiar el método solo dentro de la misma
// moneda: pasar de bolívares a dólares cambia lo que hay que buscar en el
// banco, y eso es otra compra.
// ---------------------------------------------------------------------------

/** Métodos a los que se puede pasar una compra de contado al corregirla. */
export function metodosParaCorregir(metodoActual: string, canal: string): MetodoPago[] {
  const actual = METODOS_PAGO.find((m) => m.valor === metodoActual);
  if (!actual || actual.valor === "cortesia") return [];
  const canalVenta: Canal = canal === "web" ? "web" : "manual";
  return METODOS_PAGO.filter((m) => m.moneda === actual.moneda && m.valor !== "cortesia" && m.canales.includes(canalVenta)).map((m) => m.valor);
}
