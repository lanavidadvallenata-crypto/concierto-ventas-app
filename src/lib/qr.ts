import { randomBytes } from "crypto";

// Mismo aprendizaje de seguridad ya aplicado en el sistema anterior:
// el token del QR se genera con crypto (fuente criptográficamente segura),
// nunca con Math.random() ni con el ID de la silla/ticket (no debe ser adivinable).
export function generarTokenQR(): string {
  return randomBytes(24).toString("base64url");
}
