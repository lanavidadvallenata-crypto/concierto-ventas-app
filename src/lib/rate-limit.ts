import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

// Límites por IP para frenar bots/spam en el checkout público sin estorbar a
// un comprador real que reintenta un par de veces. "iniciar" es más permisivo
// (solo reserva/consulta); "confirmar" es más estricto porque crea un ticket
// real y manda un correo.
const LIMITES: Record<"iniciar" | "confirmar", { maxIntentos: number; ventanaMin: number }> = {
  iniciar: { maxIntentos: 8, ventanaMin: 10 },
  confirmar: { maxIntentos: 5, ventanaMin: 10 },
};

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
