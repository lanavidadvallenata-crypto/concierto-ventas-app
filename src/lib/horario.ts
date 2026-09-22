// Horario de verificación de pagos (Anita, 22 sep): Finanzas confirma pagos y
// envía los QR de 8:00 a. m. a 9:00 p. m., hora de Venezuela. Lo que entra
// fuera de ese horario se confirma a partir de las 8:00 a. m. siguientes.
// Se dice "a partir de" y no "a las": a las 8 se atiende la cola en orden.

export const HORA_INICIO_VERIFICACION = 8; // 8:00 a. m.
export const HORA_FIN_VERIFICACION = 21; // 9:00 p. m.

export const TEXTO_HORARIO =
  "Verificamos pagos todos los días de 8:00 a. m. a 9:00 p. m. (hora de Venezuela). Si compras después de las 9:00 p. m., tu confirmación y tus QR te llegan al día siguiente a partir de las 8:00 a. m.";

function horaEnVenezuela(fecha: Date): number {
  const texto = new Intl.DateTimeFormat("en-US", { timeZone: "America/Caracas", hour: "numeric", hourCycle: "h23" }).format(fecha);
  return Number(texto) % 24;
}

// Si la compra entró fuera de horario, el aviso puntual para esa compra.
export function avisoFueraDeHorario(fecha: Date = new Date()): string | null {
  const hora = horaEnVenezuela(fecha);
  if (hora >= HORA_FIN_VERIFICACION) {
    return "Tu compra entró después de las 9:00 p. m.: la confirmamos mañana a partir de las 8:00 a. m. y en ese momento te llegan tus QR.";
  }
  if (hora < HORA_INICIO_VERIFICACION) {
    return "Tu compra entró antes de las 8:00 a. m.: la confirmamos hoy a partir de las 8:00 a. m. y en ese momento te llegan tus QR.";
  }
  return null;
}
