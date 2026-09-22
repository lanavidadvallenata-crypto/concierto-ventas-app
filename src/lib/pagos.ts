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
    "Pago móvil BNC\nRIF: J-507237133\nTeléfono: 0424-2251711\n\nEnvía el monto exacto en bolívares (arriba) y anota los últimos 6 dígitos de la referencia que te da tu banco.",
  transferencia:
    "Transferencia BNC a nombre de:\nBASPARTU 2025, C.A. — RIF J-507237133\nCuenta: 0191-0316-14-2100172759\n\nTransfiere el monto exacto en bolívares (arriba) y anota el número de referencia completo.",
  zelle:
    "Zelle a nombre de:\nBaspartu 2025 LLC\nCorreo: Pagosbpt@gmail.com\nBanco: Chase Bank\n\nEnvía el Zelle y copia el código de la transacción que te da tu banco (tiene letras y números).",
  binance:
    "Binance Pay\nID: 818097513 · Usuario: Pagosbpt\n\nEscanea el código QR con tu app de Binance o busca el ID/usuario. Al terminar, escribe abajo tu nombre de usuario de Binance.",
  efectivo_usd: "Pago en efectivo en dólares, recibido en mano.",
  efectivo_bs: "Pago en efectivo en bolívares, recibido en mano.",
};

// Mostrado como apoyo visual junto a las instrucciones cuando se elige Binance.
export const BINANCE_QR_URL = "/pago-binance-qr.jpg";

// Qué dato de pago pide cada método (Anita, 22 sep). Cada banco/app entrega
// algo distinto y Finanzas concilia con eso:
//   - Pago móvil: los últimos 6 dígitos de la referencia.
//   - Transferencia: la referencia completa.
//   - Zelle: el código de la transacción (alfanumérico).
//   - Binance: el nombre de usuario de quien pagó.
// Se usa igual en el navegador (etiqueta, ayuda, validación) y en el servidor
// (validación), para que el mensaje de error sea siempre el mismo.
export type ReglaReferencia = {
  etiqueta: string;
  placeholder: string;
  ayuda: string;
  teclado: "numeric" | "text";
};

export const REFERENCIA_POR_METODO: Record<MetodoPago, ReglaReferencia> = {
  pago_movil: {
    etiqueta: "Últimos 6 dígitos de la referencia",
    placeholder: "Ej.: 482913",
    ayuda: "Los últimos 6 dígitos del número de referencia que te da tu banco al hacer el pago móvil.",
    teclado: "numeric",
  },
  transferencia: {
    etiqueta: "Número de referencia completo",
    placeholder: "Todos los dígitos",
    ayuda: "La referencia completa del comprobante de tu banco, con todos sus dígitos (no solo los últimos).",
    teclado: "numeric",
  },
  zelle: {
    etiqueta: "Código de la transacción de Zelle",
    placeholder: "Letras y números",
    ayuda: "El código de confirmación que te da tu banco al enviar el Zelle. Cópialo tal cual, con letras y números.",
    teclado: "text",
  },
  binance: {
    etiqueta: "Tu nombre de usuario de Binance",
    placeholder: "Ej.: User-7a3f9 o tu apodo",
    ayuda: "El nombre de usuario (nickname) de la cuenta de Binance con la que pagaste. Con eso ubicamos tu pago.",
    teclado: "text",
  },
  efectivo_usd: { etiqueta: "Referencia", placeholder: "", ayuda: "", teclado: "text" },
  efectivo_bs: { etiqueta: "Referencia", placeholder: "", ayuda: "", teclado: "text" },
};

// Deja el dato como lo guarda Finanzas: sin espacios ni guiones en los
// números; el código de Zelle en mayúsculas; el usuario de Binance tal cual.
export function normalizarReferencia(metodo: MetodoPago, valor: string): string {
  const v = valor.trim();
  if (metodo === "pago_movil" || metodo === "transferencia") return v.replace(/[\s.-]/g, "");
  if (metodo === "zelle") return v.replace(/[\s-]/g, "").toUpperCase();
  return v.replace(/\s+/g, " ");
}

// Devuelve el mensaje de error, o null si el dato sirve.
export function validarReferencia(metodo: MetodoPago, valor: string): string | null {
  const v = normalizarReferencia(metodo, valor);
  switch (metodo) {
    case "pago_movil":
      if (!/^\d+$/.test(v)) return "Escribe solo números: los últimos 6 dígitos de la referencia del pago móvil.";
      if (v.length < 6) return "Faltan dígitos: escribe los últimos 6 dígitos de la referencia del pago móvil.";
      return null;
    case "transferencia":
      if (!/^\d+$/.test(v)) return "Escribe solo números: la referencia completa de la transferencia.";
      if (v.length < 6) return "Escribe la referencia completa de la transferencia, con todos sus dígitos.";
      return null;
    case "zelle":
      if (!/^[A-Z0-9]+$/.test(v)) return "El código de Zelle lleva solo letras y números — cópialo tal como te lo da tu banco.";
      if (v.length < 5 || v.length > 40) return "Revisa el código de la transacción de Zelle: parece incompleto.";
      return null;
    case "binance":
      if (v.length < 2 || v.length > 50) return "Escribe tu nombre de usuario de Binance.";
      return null;
    default:
      return null;
  }
}

// Teléfono de contacto: 10 a 15 dígitos (0414 123 4567, +58 414 123 4567…).
export function validarTelefono(valor: string): string | null {
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 15) {
    return "Revisa tu teléfono (WhatsApp): debe tener al menos 10 dígitos, por ejemplo 0414 123 4567.";
  }
  return null;
}
