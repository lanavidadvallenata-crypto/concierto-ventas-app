import { CODIGO_10, TOKEN_32, normalizarCodigo } from "@/lib/qr";

// Qué escribió el personal de la puerta en "si el QR no escanea".
export type Consulta =
  | { tipo: "vacia" }
  | { tipo: "token"; token: string }            // enlace o código secreto completo
  | { tipo: "codigo"; codigo: string; texto: string } // 10 caracteres debajo del QR
  | { tipo: "compra"; prefijo: string }         // 8 caracteres del asunto del correo
  | { tipo: "texto"; texto: string };           // nombre o teléfono del comprador

export function interpretarConsulta(raw: string | undefined): Consulta {
  const s = (raw ?? "").trim();
  if (!s) return { tipo: "vacia" };

  // Enlace pegado: .../acceso/<token> o .../entrada/<token>
  const enlace = s.match(/\/(?:acceso|entrada)\/([A-Za-z0-9_-]{16,128})/);
  if (enlace) return { tipo: "token", token: enlace[1] };

  // "compra 904FFF16" o solo "904FFF16"
  const compra = s.match(/^(?:compra\s*)?([0-9a-f]{8})$/i);
  if (compra) return { tipo: "compra", prefijo: compra[1].toLowerCase() };

  const norm = normalizarCodigo(s);
  if (TOKEN_32.test(norm)) return { tipo: "token", token: norm };
  if (CODIGO_10.test(norm)) return { tipo: "codigo", codigo: norm, texto: s };

  // Token del formato viejo pegado tal cual (sin espacios).
  if (/^[A-Za-z0-9_-]{24,128}$/.test(s) && /[a-z]/.test(s) && /[A-Z0-9]/.test(s) && !/\s/.test(s)) {
    return { tipo: "token", token: s };
  }

  return { tipo: "texto", texto: s };
}

// Rango de UUID que empiezan por esos 8 caracteres (el código de compra son
// los 8 primeros del grupo_id). Comparar UUID en Postgres es byte a byte, que
// coincide con el orden del texto hexadecimal: sirve el índice.
export function rangoCompra(prefijo: string): { desde: string; hasta: string | null } {
  const desde = `${prefijo}-0000-0000-0000-000000000000`;
  const n = parseInt(prefijo, 16) + 1;
  if (n > 0xffffffff) return { desde, hasta: null };
  const sig = n.toString(16).padStart(8, "0");
  return { desde, hasta: `${sig}-0000-0000-0000-000000000000` };
}

// Valor seguro para un filtro .or() de PostgREST con ilike.
export function patronIlike(texto: string): string {
  const patron = `%${texto.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return `"${patron.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function telefonoEnmascarado(tel: string | null | undefined): string {
  const d = (tel ?? "").replace(/\D/g, "");
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : "—";
}
