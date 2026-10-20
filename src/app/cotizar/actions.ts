"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { validarPedido, type Cotizacion, type Pedido } from "@/lib/cotizador";
import { cotizarPedido } from "@/lib/cotizador-servidor";
import { obtenerTasaActual } from "@/lib/tasa";
import { obtenerMapas, sillasDisponibles } from "@/lib/mapa-vip";

// Solo lee: no aparta sillas, no crea compras, no toca cupos. Se puede tocar
// cuantas veces se quiera sin riesgo.
export async function cotizar(pedido: Pedido): Promise<{ ok: true; cotizacion: Cotizacion } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión expiró — vuelve a entrar." };

  const service = createServiceClient();
  const { data: perfil } = await service.from("perfiles").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.activo || !["ventas", "finanzas", "admin"].includes(perfil.rol as string)) {
    return { ok: false, error: "No tienes permiso para esta acción." };
  }

  const v = validarPedido(pedido);
  if (!v.ok) return v;

  try {
    const [tasaEurVes, mapas, general] = await Promise.all([
      obtenerTasaActual(service),
      obtenerMapas(service),
      (async () => {
        const [{ data: evento }, { count }] = await Promise.all([
          service.from("eventos").select("aforo_general_total").limit(1).single(),
          service.from("tickets").select("id", { count: "exact", head: true }).eq("tipo", "general").neq("estado_pago", "rechazado"),
        ]);
        return evento?.aforo_general_total != null && count != null ? evento.aforo_general_total - count : null;
      })(),
    ]);

    const cotizacion = await cotizarPedido(service, v.lineas, {
      tasaEurVes,
      disponibles: {
        vip: sillasDisponibles(mapas.vip),
        preferencial: sillasDisponibles(mapas.preferencial),
        general,
      },
    });
    return { ok: true, cotizacion };
  } catch (e) {
    console.error("Cotizador:", (e as Error).message);
    return { ok: false, error: "No se pudo cotizar en este momento. Intenta de nuevo en un minuto." };
  }
}
