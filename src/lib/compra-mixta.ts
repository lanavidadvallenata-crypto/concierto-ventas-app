// Compra mixta (Anita, 28 oct): varias zonas en una sola compra de Ventas,
// con un código, un pago y un plan de cuotas. "2 Preferenciales y 1 General"
// antes eran dos compras con dos pagos y dos referencias.
//
// El plan se arma sobre el TOTAL de la compra con las mismas funciones que
// la web (cotizarCompra por zona + planOfrecible), así el cotizador, la
// pantalla de Ventas y lo que se guarda dicen lo mismo al céntimo. Una compra
// de una sola zona sale idéntica a como salía antes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { conAsiento, cotizarCompra, MAX_POR_COMPRA, tipoParaPlan, TIPOS, type ParteCompra, type Tipo } from "@/lib/precios";
import { planOfrecible, type Ofrecible } from "@/lib/abona618";
import type { ParteVenta } from "@/lib/registrar-venta";

export type PlanDeCompra = Ofrecible & {
  /** Total de lista de toda la compra, sumando sus zonas. */
  total: number;
  /** Con qué tipo y cantidad se guarda el plan (ver tipoParaPlan). */
  tipoPlan: ParteCompra;
};

export async function planDeCompra(
  service: SupabaseClient,
  partes: readonly ParteCompra[],
  opciones: { canal?: string; hoy?: string } = {}
): Promise<PlanDeCompra> {
  let total = 0;
  for (const p of partes) {
    const { cotizacion } = await cotizarCompra(service, p.tipo, p.cantidad);
    total += cotizacion.total;
  }
  total = Math.round(total * 100) / 100;
  const tipoPlan = tipoParaPlan(partes);
  const ofrecible = await planOfrecible(service, {
    tipo: tipoPlan.tipo,
    cantidad: tipoPlan.cantidad,
    total,
    canal: opciones.canal ?? "manual",
    hoy: opciones.hoy,
  });
  return { ...ofrecible, total, tipoPlan };
}

/** Los tipos de cada ticket de la compra, en orden: sirve para describirla
 *  (resumenCompra, detalleMixto) antes de que existan los tickets. */
export function tiposDe(partes: readonly ParteCompra[]): Tipo[] {
  return partes.flatMap((p) => Array.from({ length: p.cantidad }, () => p.tipo));
}

/**
 * Lee lo que manda la pantalla de Ventas: [{tipo, sillaIds, cantidad}] en
 * JSON. Valida igual que una venta de una zona: sillas para VIP y
 * Preferencial, cantidad para General, máximos por zona, una zona por parte.
 */
export function leerMezcla(texto: string): { ok: true; partes: ParteVenta[] } | { ok: false; error: string } {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return { ok: false, error: "No se pudo leer la compra: vuelve a elegir las entradas." };
  }
  if (!Array.isArray(crudo) || crudo.length === 0 || crudo.length > TIPOS.length) {
    return { ok: false, error: "No se pudo leer la compra: vuelve a elegir las entradas." };
  }
  const partes: ParteVenta[] = [];
  for (const x of crudo) {
    const tipo = (x as { tipo?: unknown })?.tipo;
    if (typeof tipo !== "string" || !TIPOS.includes(tipo as Tipo)) return { ok: false, error: "Zona inválida en la compra." };
    const t = tipo as Tipo;
    if (partes.some((p) => p.tipo === t)) return { ok: false, error: "Cada zona va una sola vez en la compra." };
    if (conAsiento(t)) {
      const ids = (x as { sillaIds?: unknown }).sillaIds;
      const sillaIds = Array.isArray(ids) ? [...new Set(ids.filter((s): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s)))] : [];
      if (sillaIds.length === 0) return { ok: false, error: `Elige al menos una silla ${t === "vip" ? "VIP" : "Preferencial"} en el mapa.` };
      if (sillaIds.length > MAX_POR_COMPRA[t]) return { ok: false, error: `Máximo ${MAX_POR_COMPRA[t]} sillas por zona en una compra.` };
      partes.push({ tipo: t, sillaIds, cantidad: sillaIds.length });
    } else {
      const n = Number((x as { cantidad?: unknown }).cantidad);
      if (!Number.isInteger(n) || n < 1 || n > MAX_POR_COMPRA.general) {
        return { ok: false, error: `Entradas generales: entre 1 y ${MAX_POR_COMPRA.general} por compra.` };
      }
      partes.push({ tipo: t, sillaIds: [], cantidad: n });
    }
  }
  return { ok: true, partes };
}
