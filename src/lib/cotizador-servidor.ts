// La parte del cotizador que lee la base (ver cotizador.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { cotizarCompra, type Tipo } from "@/lib/precios";
import { planOfrecible } from "@/lib/abona618";
import { aPlanPublico, hoyEnVenezuela } from "@/lib/cuotas";
import { sumarPorFecha, type Cotizacion, type LineaCotizada } from "@/lib/cotizador";

/** Cotiza el pedido con las mismas funciones que el checkout. */
export async function cotizarPedido(
  service: SupabaseClient,
  pedido: { tipo: Tipo; cantidad: number }[],
  deps: { tasaEurVes: number | null; disponibles: Partial<Record<Tipo, number | null>>; hoy?: string }
): Promise<Cotizacion> {
  const hoy = deps.hoy ?? hoyEnVenezuela();
  const lineas: LineaCotizada[] = [];

  for (const { tipo, cantidad } of pedido) {
    const { cotizacion } = await cotizarCompra(service, tipo, cantidad);
    const { plan } = await planOfrecible(service, { tipo, cantidad, total: cotizacion.total, canal: "web", hoy });
    lineas.push({
      tipo,
      cantidad,
      total: cotizacion.total,
      plan: plan.hayPlan ? aPlanPublico(plan) : null,
      sinPlan: plan.hayPlan ? null : plan.motivo,
      disponibles: deps.disponibles[tipo] ?? null,
    });
  }

  const totalUsd = Math.round(lineas.reduce((s, l) => s + l.total, 0) * 100) / 100;
  return { hoy, tasaEurVes: deps.tasaEurVes, lineas, porFecha: sumarPorFecha(lineas, hoy, deps.tasaEurVes), totalUsd };
}
