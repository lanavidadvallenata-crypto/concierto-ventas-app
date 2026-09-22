import { createHmac, timingSafeEqual } from "crypto";

// Marca firmada de "este teléfono acaba de registrar el ingreso".
//
// Por qué (Anita, 22 sep): antes, cualquier escaneo de un QR usado en los
// últimos 90 s salía VERDE — la pantalla no distinguía "yo acabo de tocar
// DEJAR ENTRAR" de "otra persona trae una copia del mismo QR". En la prueba,
// 2 QR reenviados (los mismos 2 códigos, en dos correos) se escanearon 4
// veces seguidas y las 4 salieron verdes.
//
// Ahora el verde solo lo ve el teléfono que registró el ingreso: la acción
// redirige con ?ok=<hora>.<firma>. Cualquier otro escaneo del mismo QR llega
// sin esa marca y sale ROJO. La marca va firmada con una clave del servidor
// y atada al código: no se puede fabricar un QR con un ?ok= inventado.

const VIGENCIA_MS = 120_000;

function clave(): string {
  const k = process.env.INGRESO_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("Falta la clave del servidor para firmar ingresos.");
  return k;
}

function firmar(token: string, ts: number): string {
  return createHmac("sha256", clave()).update(`ingreso:${token}:${ts}`).digest("hex").slice(0, 32);
}

export function crearMarcaIngreso(token: string): string {
  const ts = Date.now();
  return `${ts}.${firmar(token, ts)}`;
}

export function marcaIngresoValida(token: string, marca: string | undefined): boolean {
  if (!marca) return false;
  const m = /^(\d{13})\.([0-9a-f]{32})$/.exec(marca);
  if (!m) return false;
  const ts = Number(m[1]);
  const edad = Date.now() - ts;
  if (edad < -5_000 || edad > VIGENCIA_MS) return false;
  const esperado = Buffer.from(firmar(token, ts));
  const dado = Buffer.from(m[2]);
  return esperado.length === dado.length && timingSafeEqual(esperado, dado);
}
