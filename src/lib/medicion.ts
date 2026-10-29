// Medición del embudo (Anita, 29 oct). Lo puro: qué pasos existen, de dónde
// llegó cada visita y qué tipo de aparato usa. Sin base de datos ni Next, para
// que se pueda probar suelto (pruebas/medicion.test.ts).
//
// Sin datos personales: nunca nombre, teléfono, correo ni IP. El "visitante"
// es un código al azar que guarda el navegador (cookie nv_v, 30 días).

import { esHostPropio } from "@/lib/dominios";

export const COOKIE_VISITANTE = "nv_v";

/** Pasos que puede anotar el navegador. Los que cuentan plata (pago,
 *  reporto) los anota SOLO el servidor: no se pueden falsear desde afuera. */
export const EVENTOS_CLIENTE = ["visita", "zona", "continuar", "expiro", "whatsapp"] as const;
export type EventoCliente = (typeof EVENTOS_CLIENTE)[number];
export type EventoServidor = "pago" | "reporto";

/** Nombre corto y limpio para un valor de UTM: minúsculas, sin espacios
 *  raros, máximo 60. null si no queda nada. */
export function limpiarEtiqueta(x: unknown, max = 60): string | null {
  if (typeof x !== "string") return null;
  const s = x
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._+-]/g, "")
    .slice(0, max);
  return s || null;
}

// Cómo se suele escribir cada fuente en un enlace, a un solo nombre.
const ALIAS: Record<string, string> = {
  ig: "instagram",
  insta: "instagram",
  "instagram.com": "instagram",
  fb: "facebook",
  "facebook.com": "facebook",
  wa: "whatsapp",
  wsp: "whatsapp",
  whats: "whatsapp",
  mc: "manychat",
  tt: "tiktok",
  tw: "x",
  twitter: "x",
};

/** El sitio que mandó a la persona, a un nombre de canal. null si es nuestro
 *  propio sitio (navegar de la portada a /comprar no es una fuente). */
export function fuenteDeReferidor(referidor: string | null | undefined): string | null {
  if (!referidor) return null;
  let host: string;
  try {
    host = new URL(referidor).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || esHostPropio(host) || host.endsWith(".vercel.app") || host === "localhost" || host === "127.0.0.1") return null;
  const h = host.replace(/^www\./, "").replace(/^(l|lm|m|mobile)\./, "");
  if (h === "instagram.com" || h.endsWith(".instagram.com")) return "instagram";
  if (h === "facebook.com" || h.endsWith(".facebook.com") || h === "fb.com" || h === "fb.me") return "facebook";
  if (h === "wa.me" || h === "whatsapp.com" || h.endsWith(".whatsapp.com")) return "whatsapp";
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) return "tiktok";
  if (h === "t.co" || h === "x.com" || h === "twitter.com") return "x";
  if (h === "youtube.com" || h === "youtu.be") return "youtube";
  if (/(^|\.)google\.[a-z.]+$/.test(h)) return "google";
  if (/(^|\.)bing\.com$/.test(h)) return "bing";
  return limpiarEtiqueta(h, 60);
}

export type LlegadaCruda = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  referidor?: string | null;
  /** El enlace traía fbclid (clic desde Facebook o Instagram). */
  fbclid?: boolean;
  /** El enlace traía gclid (anuncio de Google). */
  gclid?: boolean;
};

export type Llegada = {
  fuente: string | null;
  medio: string | null;
  campana: string | null;
  contenido: string | null;
  /** Solo el dominio del sitio que lo mandó, nunca la dirección completa. */
  referidor: string | null;
};

/**
 * De dónde llegó una visita. Manda el utm_source si el enlace lo trae (es lo
 * que ponemos a propósito en la bio, ManyChat, anuncios y catálogo); si no,
 * el sitio que lo mandó; si no hay nada, null = directo.
 */
export function normalizarLlegada(c: LlegadaCruda): Llegada {
  let referidor: string | null = null;
  if (c.referidor) {
    try {
      const host = new URL(c.referidor).hostname.toLowerCase();
      referidor = esHostPropio(host) ? null : limpiarEtiqueta(host.replace(/^www\./, ""), 80);
    } catch {
      referidor = null;
    }
  }
  const utm = limpiarEtiqueta(c.utmSource, 40);
  const fuente = utm
    ? (ALIAS[utm] ?? utm)
    : (fuenteDeReferidor(c.referidor) ?? (c.fbclid ? "meta" : c.gclid ? "google" : null));
  return {
    fuente,
    medio: limpiarEtiqueta(c.utmMedium, 40),
    campana: limpiarEtiqueta(c.utmCampaign, 80),
    contenido: limpiarEtiqueta(c.utmContent, 80),
    referidor,
  };
}

/** "movil" | "tablet" | "escritorio" por el user-agent. */
export function clasificarDispositivo(ua: string | null | undefined): string | null {
  if (!ua) return null;
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|android|ipod/i.test(ua)) return "movil";
  return "escritorio";
}

/** Bots, vistas previas de enlaces y navegadores automáticos: no son personas. */
export function esBot(ua: string | null | undefined): boolean {
  if (!ua) return true;
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|meta-externalagent|whatsapp|telegram|headless|lighthouse|pingdom|uptime|curl|wget|python|axios|node-fetch|go-http/i.test(
    ua
  );
}

/** El código del visitante, si tiene la forma que genera el navegador. */
export function visitanteValido(x: unknown): string | null {
  return typeof x === "string" && /^[A-Za-z0-9-]{8,64}$/.test(x) ? x : null;
}

/** La ruta sin parámetros (los parámetros nunca se guardan). */
export function rutaLimpia(x: unknown): string | null {
  if (typeof x !== "string" || !x.startsWith("/")) return null;
  return x.split(/[?#]/)[0].slice(0, 120);
}
