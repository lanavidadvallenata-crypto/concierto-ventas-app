// Lado navegador de la medición (Anita, 29 oct). medir() manda un paso a
// /api/ev con sendBeacon: no espera respuesta, no muestra errores y no frena
// nada. Si el navegador lo bloquea, la compra sigue exactamente igual.

import { COOKIE_VISITANTE, type EventoCliente } from "@/lib/medicion";
import type { Tipo } from "@/lib/precios";

const TREINTA_DIAS = 60 * 60 * 24 * 30;

function leerCookie(nombre: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${nombre}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function nuevoCodigo(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** El código anónimo de este navegador. Se crea en la primera visita y se
 *  renueva 30 días cada vez que vuelve. Lo lee también el servidor al apartar
 *  y al reportar el pago, para unir esos pasos con la visita. */
export function asegurarVisitante(): string | null {
  try {
    const actual = leerCookie(COOKIE_VISITANTE);
    const codigo = actual && /^[A-Za-z0-9-]{8,64}$/.test(actual) ? actual : nuevoCodigo();
    const seguro = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE_VISITANTE}=${codigo}; Max-Age=${TREINTA_DIAS}; Path=/; SameSite=Lax${seguro}`;
    return codigo;
  } catch {
    return null;
  }
}

export function medir(evento: EventoCliente, datos: { zona?: Tipo; cantidad?: number } = {}): void {
  try {
    const v = asegurarVisitante();
    const cuerpo: Record<string, unknown> = { v, e: evento, r: location.pathname, z: datos.zona, c: datos.cantidad };
    if (evento === "visita") {
      // Solo la visita lleva de dónde llegó. Se manda crudo y el servidor lo
      // normaliza (un solo lugar con las reglas).
      const p = new URLSearchParams(location.search);
      cuerpo.us = p.get("utm_source");
      cuerpo.um = p.get("utm_medium");
      cuerpo.uc = p.get("utm_campaign");
      cuerpo.ut = p.get("utm_content");
      cuerpo.fb = p.has("fbclid");
      cuerpo.g = p.has("gclid");
      cuerpo.rf = document.referrer || null;
    }
    const json = JSON.stringify(cuerpo);
    const blob = new Blob([json], { type: "application/json" });
    if (!(navigator.sendBeacon && navigator.sendBeacon("/api/ev", blob))) {
      void fetch("/api/ev", { method: "POST", body: json, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
    }
  } catch {
    // Medir nunca puede romper la página.
  }
}
