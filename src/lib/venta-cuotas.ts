// Venta en cuotas desde Ventas (Anita, 22 oct): las vendedoras ya no tienen
// que salir a la web para apartar en cuotas. Esto es lo puro — sin base de
// datos — para que la pantalla y el servidor digan exactamente lo mismo y se
// pueda probar: cuánto pagó el cliente hoy contra la inicial que pide el plan.

import { parsearMontoBs } from "@/lib/formato";

export type PagoInicial =
  | {
      ok: true;
      /** Lo que pagó, en dólares (en Bs se convierte con la tasa de hoy). */
      pagadoUsd: number;
      /** Los bolívares exactos que pagó; null si pagó en dólares. */
      pagadoBs: number | null;
      /** Lo pagado de más sobre la inicial; 0 si pagó la inicial justa. */
      excedenteUsd: number;
    }
  | { ok: false; error: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * `texto` vacío = pagó la inicial justa (lo normal). Si escribe un monto:
 * en bolívares cuando el método es en Bs, en dólares si no.
 */
export function leerPagoInicial(d: { inicialUsd: number; enBs: boolean; tasa: number | null; texto: string | null | undefined }): PagoInicial {
  const texto = (d.texto ?? "").trim();
  if (d.enBs && !(d.tasa && d.tasa > 0)) {
    return { ok: false, error: "Sin la tasa del día no se puede registrar un pago en bolívares. Intenta en un momento." };
  }
  if (!texto) {
    return { ok: true, pagadoUsd: r2(d.inicialUsd), pagadoBs: d.enBs ? r2(d.inicialUsd * (d.tasa as number)) : null, excedenteUsd: 0 };
  }
  const leido = parsearMontoBs(texto);
  if (leido == null || !(leido > 0)) {
    return { ok: false, error: d.enBs ? "Escribe cuántos bolívares pagó, solo con números (ej: 59.338,20)." : "Escribe cuántos dólares pagó (ej: 60)." };
  }
  const pagadoUsd = d.enBs ? r2(leido / (d.tasa as number)) : r2(leido);
  const excedenteUsd = r2(pagadoUsd - d.inicialUsd);
  if (excedenteUsd <= -0.01) {
    const falta = d.enBs ? ` (Bs ${(r2(d.inicialUsd * (d.tasa as number))).toLocaleString("es-VE", { minimumFractionDigits: 2 })})` : "";
    return {
      ok: false,
      error: `Para apartar en cuotas tiene que pagar al menos la inicial: ${usd(d.inicialUsd)}${falta}. Pagó ${usd(pagadoUsd)}.`,
    };
  }
  return { ok: true, pagadoUsd, pagadoBs: d.enBs ? r2(leido) : null, excedenteUsd: Math.max(0, excedenteUsd) };
}

export const TEXTO_SIN_PLAN: Record<string, string> = {
  apagado: "El pago en cuotas está apagado.",
  tope_vip: "Se acabaron los cupos VIP en cuotas: esta venta va de contado.",
  sin_margen: "Ya no hay fechas para cuotas: desde el 14 de noviembre todo es de contado.",
  taquilla: "En taquilla no hay cuotas.",
  error: "No se pudo leer el plan de cuotas: vuelve a intentar en un momento.",
};
