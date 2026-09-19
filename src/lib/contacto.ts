// Contacto de soporte del evento (Anita, 19 sep): a este número llegan los
// reclamos de pago ("mi pago fue rechazado", "no me llegó el QR").
export const WHATSAPP_SOPORTE_NUMERO = "584241250127"; // +58 424-1250127
export const WHATSAPP_SOPORTE_VISIBLE = "+58 424-1250127";

export function urlWhatsAppSoporte(mensaje?: string) {
  const base = `https://wa.me/${WHATSAPP_SOPORTE_NUMERO}`;
  return mensaje ? `${base}?text=${encodeURIComponent(mensaje)}` : base;
}
