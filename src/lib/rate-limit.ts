import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

// Límites para frenar bots/spam en el checkout público sin estorbar a
// compradores reales.
//
// Por qué los números son altos: los límites anteriores eran 8 "iniciar" y 5
// "confirmar" cada 10 minutos POR IP. En Venezuela los operadores móviles
// (Movilnet, Digitel, Movistar) ponen a miles de clientes detrás de unas
// pocas IPs públicas (CG-NAT). En un pico de ventas, 5 compras por IP cada
// 10 minutos significaba bloquear a compradores reales en masa — y también a
// todo el equipo vendiendo desde la misma WiFi. El límite por IP ahora solo
// frena a un bot que dispare cientos de compras desde una sola conexión; el
// control fino por persona lo hace el límite por CORREO (abajo), que un bot
// no puede saltarse repartiendo IPs.
const LIMITES: Record<"iniciar" | "confirmar", { maxIntentos: number; ventanaMin: number }> = {
  iniciar: { maxIntentos: 150, ventanaMin: 10 },
  confirmar: { maxIntentos: 60, ventanaMin: 10 },
};

// Un comprador real no registra más de un puñado de compras en 10 minutos
// (una entrada por asistente: una familia de 5 = 5 compras). Más que esto es
// un bot o alguien intentando llenar el sistema de tickets falsos.
const MAX_COMPRAS_POR_CORREO_10MIN = 8;

async function obtenerIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "desconocida";
}

export type LimiteResultado = { ok: true } | { ok: false; error: string };

// Cuenta intentos recientes de esta IP para esta acción y la rechaza si se
// pasa del límite. Si el chequeo mismo falla (ej. problema de red con
// Supabase), no bloqueamos una compra real por un problema nuestro — se deja
// pasar y se loguea el error para revisarlo aparte.
export async function verificarLimite(
  service: SupabaseClient,
  accion: "iniciar" | "confirmar"
): Promise<LimiteResultado> {
  const { maxIntentos, ventanaMin } = LIMITES[accion];
  const ip = await obtenerIp();
  const desde = new Date(Date.now() - ventanaMin * 60_000).toISOString();

  const { count, error } = await service
    .from("intentos_checkout")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("accion", accion)
    .gte("creado_en", desde);

  if (error) {
    console.error("Error verificando límite de intentos:", error.message);
    return { ok: true };
  }

  if ((count ?? 0) >= maxIntentos) {
    return {
      ok: false,
      error: "Demasiados intentos seguidos desde tu conexión — espera unos minutos y vuelve a intentarlo.",
    };
  }

  await service.from("intentos_checkout").insert({ ip, accion });
  return { ok: true };
}

// Límite por correo: se apoya en la tabla de tickets (no hace falta ninguna
// tabla nueva). Cuenta cuántos tickets se crearon con este correo en los
// últimos 10 minutos.
export async function verificarLimitePorCorreo(
  service: SupabaseClient,
  correo: string
): Promise<LimiteResultado> {
  const desde = new Date(Date.now() - 10 * 60_000).toISOString();

  const { count, error } = await service
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("comprador_email", correo)
    .gte("created_at", desde);

  if (error) {
    console.error("Error verificando límite por correo:", error.message);
    return { ok: true };
  }

  if ((count ?? 0) >= MAX_COMPRAS_POR_CORREO_10MIN) {
    return {
      ok: false,
      error:
        "Ya registramos varias compras con este correo en los últimos minutos. Si estás comprando para un grupo grande, escríbenos por WhatsApp y te ayudamos directo.",
    };
  }

  return { ok: true };
}
