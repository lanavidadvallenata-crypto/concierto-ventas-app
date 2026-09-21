export type MetodoPago = "pago_movil" | "transferencia" | "zelle" | "binance" | "efectivo_usd" | "efectivo_bs";

export type Canal = "web" | "manual" | "taquilla";

export const METODOS_PAGO: {
  valor: MetodoPago;
  etiqueta: string;
  moneda: "USD" | "VES";
  activo: boolean;
  // En qué canales se ofrece. El efectivo solo existe en taquilla (día del
  // evento) y en venta manual (alguien pagó en mano a un vendedor).
  canales: Canal[];
}[] = [
  // Pago móvil: activo desde el 21 sep (datos de Anita: BNC, RIF J-507237133,
  // 0424-2251711). Va primero porque es el método más usado en Venezuela.
  { valor: "pago_movil", etiqueta: "Pago móvil", moneda: "VES", activo: true, canales: ["web", "manual", "taquilla"] },
  { valor: "transferencia", etiqueta: "Transferencia bancaria", moneda: "VES", activo: true, canales: ["web", "manual", "taquilla"] },
  { valor: "zelle", etiqueta: "Zelle", moneda: "USD", activo: true, canales: ["web", "manual", "taquilla"] },
  { valor: "binance", etiqueta: "Binance", moneda: "USD", activo: true, canales: ["web", "manual", "taquilla"] },
  { valor: "efectivo_usd", etiqueta: "Efectivo (dólares)", moneda: "USD", activo: true, canales: ["manual", "taquilla"] },
  { valor: "efectivo_bs", etiqueta: "Efectivo (bolívares)", moneda: "VES", activo: true, canales: ["manual", "taquilla"] },
];

export const METODOS_PAGO_ACTIVOS = METODOS_PAGO.filter((m) => m.activo);

export function metodosParaCanal(canal: Canal) {
  return METODOS_PAGO.filter((m) => m.canales.includes(canal));
}

export function metodoEsEnBs(metodo: string) {
  return METODOS_PAGO.find((m) => m.valor === metodo)?.moneda === "VES";
}

// Datos reales confirmados por Anita (14 sept) — cuentas a nombre de Baspartu 2025.
export const INSTRUCCIONES_PAGO: Record<MetodoPago, string> = {
  pago_movil:
    "Pago móvil BNC\nRIF: J-507237133\nTeléfono: 0424-2251711\n\nEnvía el monto exacto en bolívares (arriba) y anota el número de referencia que te da tu banco.",
  transferencia:
    "Transferencia BNC a nombre de:\nBASPARTU 2025, C.A. — RIF J-507237133\nCuenta: 0191-0316-14-2100172759\n\nTransfiere el monto exacto en bolívares (arriba) y anota el número de referencia.",
  zelle:
    "Zelle a nombre de:\nBaspartu 2025 LLC\nCorreo: Pagosbpt@gmail.com\nBanco: Chase Bank\n\nEnvía el Zelle y anota el número de confirmación que te da tu banco.",
  binance:
    "Binance Pay\nID: 818097513 · Usuario: Pagosbpt\n\nEscanea el código QR con tu app de Binance o busca el ID/usuario, y anota el número de orden que te da Binance al confirmar.",
  efectivo_usd: "Pago en efectivo en dólares, recibido en mano.",
  efectivo_bs: "Pago en efectivo en bolívares, recibido en mano.",
};

// Mostrado como apoyo visual junto a las instrucciones cuando se elige Binance.
export const BINANCE_QR_URL = "/pago-binance-qr.jpg";
