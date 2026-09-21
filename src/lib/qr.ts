import { randomBytes } from "crypto";

// Token secreto de cada entrada (va dentro del QR y en el enlace /entrada/...).
//
// Seguridad: 160 bits de una fuente criptográfica (crypto.randomBytes), nunca
// Math.random() ni derivado del ID de la silla/ticket o del nombre. No se
// puede adivinar ni "fabricar": un QR inventado da INVÁLIDO en la puerta.
//
// Formato (21 sep): base32 de Crockford — solo 0-9 y A-Z sin I, L, O, U. Así
// los primeros 10 caracteres sirven como CÓDIGO DE ENTRADA legible (se imprime
// debajo del QR) para cuando el QR no escanea: sin letras que se confundan
// con números y sin guiones/guiones bajos. 10 caracteres = 50 bits: con 5 000
// entradas vendidas, la probabilidad de acertar uno al azar es ~4 en un billón
// por intento (y el buscador de la puerta solo lo usa personal con sesión).
// Los tokens viejos (base64url, antes del 21 sep) siguen siendo válidos.
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generarTokenQR(): string {
  const bytes = randomBytes(20); // 160 bits → 32 caracteres de 5 bits
  let bits = 0;
  let valor = 0;
  let out = "";
  for (const b of bytes) {
    valor = ((valor << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALFABETO[(valor >>> bits) & 31];
    }
  }
  return out;
}

const TOKEN_NUEVO = /^[0-9A-HJKMNP-TV-Z]{32}$/;

// "7KQ2M-9XH4R" — lo que ve el comprador debajo del QR. null para tokens
// del formato viejo (no tienen un prefijo legible sin ambigüedad).
export function codigoEntrada(token: string | null | undefined): string | null {
  if (!token || !TOKEN_NUEVO.test(token)) return null;
  return `${token.slice(0, 5)}-${token.slice(5, 10)}`;
}

// Lo que escribe el personal de la puerta: mayúsculas, sin espacios ni
// guiones, y las letras que se confunden llevadas a su número (O→0, I/L→1).
export function normalizarCodigo(texto: string): string {
  return texto.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export const CODIGO_10 = /^[0-9A-HJKMNP-TV-Z]{10}$/;
export const TOKEN_32 = TOKEN_NUEVO;
