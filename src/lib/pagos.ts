export type MetodoPago = "pago_movil" | "transferencia" | "zelle" | "binance";

export const METODOS_PAGO: { valor: MetodoPago; etiqueta: string; moneda: "USD" | "VES" }[] = [
  { valor: "pago_movil", etiqueta: "Pago móvil", moneda: "VES" },
  { valor: "transferencia", etiqueta: "Transferencia bancaria", moneda: "VES" },
  { valor: "zelle", etiqueta: "Zelle", moneda: "USD" },
  { valor: "binance", etiqueta: "Binance", moneda: "USD" },
];

// TODO(Anita): reemplazar con los datos reales — mientras tanto el checkout público
// muestra este texto de aviso en vez de datos falsos o inventados.
export const INSTRUCCIONES_PAGO: Record<MetodoPago, string> = {
  pago_movil: "Datos de pago móvil pendientes de cargar — no actives ventas por este medio hasta reemplazar este texto en src/lib/pagos.ts.",
  transferencia: "Datos de transferencia bancaria pendientes de cargar — no actives ventas por este medio hasta reemplazar este texto en src/lib/pagos.ts.",
  zelle: "Correo Zelle pendiente de cargar — no actives ventas por este medio hasta reemplazar este texto en src/lib/pagos.ts.",
  binance: "ID/correo Binance pendiente de cargar — no actives ventas por este medio hasta reemplazar este texto en src/lib/pagos.ts.",
};
