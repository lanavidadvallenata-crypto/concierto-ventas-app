export type MetodoPago = "pago_movil" | "transferencia" | "zelle" | "binance";

export const METODOS_PAGO: {
  valor: MetodoPago;
  etiqueta: string;
  moneda: "USD" | "VES";
  activo: boolean;
}[] = [
  // Pago móvil: pendiente — Anita confirmó (14 sept) que está en configuración.
  // Es el método más usado, así que se deja visible pero deshabilitado en vez de
  // ocultarlo, para que la gente sepa que viene pronto. Activar apenas lleguen
  // los datos reales (banco, cédula/RIF, teléfono) reemplazando INSTRUCCIONES_PAGO.pago_movil.
  { valor: "pago_movil", etiqueta: "Pago móvil", moneda: "VES", activo: false },
  { valor: "transferencia", etiqueta: "Transferencia bancaria", moneda: "VES", activo: true },
  { valor: "zelle", etiqueta: "Zelle", moneda: "USD", activo: true },
  { valor: "binance", etiqueta: "Binance", moneda: "USD", activo: true },
];

export const METODOS_PAGO_ACTIVOS = METODOS_PAGO.filter((m) => m.activo);

// Datos reales confirmados por Anita (14 sept) — cuentas a nombre de Baspartu 2025.
export const INSTRUCCIONES_PAGO: Record<MetodoPago, string> = {
  pago_movil:
    "Pago móvil próximamente — está en configuración. Por ahora paga por Transferencia, Zelle o Binance.",
  transferencia:
    "Transferencia BNC a nombre de:\nBASPARTU 2025, C.A. — RIF J-507237133\nCuenta: 0191-0316-14-2100172759\n\nTransfiere el monto exacto en bolívares (arriba) y anota el número de referencia.",
  zelle:
    "Zelle a nombre de:\nBaspartu 2025 LLC\nCorreo: Pagosbpt@gmail.com\nBanco: Chase Bank\n\nEnvía el Zelle y anota el número de confirmación que te da tu banco.",
  binance:
    "Binance Pay\nID: 818097513 · Usuario: Pagosbpt\n\nEscanea el código QR con tu app de Binance o busca el ID/usuario, y anota el número de orden que te da Binance al confirmar.",
};

// Mostrado como apoyo visual junto a las instrucciones cuando se elige Binance.
export const BINANCE_QR_URL = "/pago-binance-qr.jpg";
