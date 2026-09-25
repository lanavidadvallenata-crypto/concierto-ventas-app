"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { MAX_POR_COMPRA } from "@/lib/precios";
import { metodoEsEnBs, metodosParaCanal } from "@/lib/pagos";
import { obtenerTasaActual } from "@/lib/tasa";
import { registrarVentaInterna } from "@/lib/registrar-venta";
import { taquillaAbierta } from "@/lib/taquilla";

const taquillaSchema = z.object({
  tipo: z.enum(["vip", "general"]),
  sillaIds: z.array(z.string().uuid()).max(MAX_POR_COMPRA.vip).optional(),
  cantidad: z.coerce.number().int().min(1).max(MAX_POR_COMPRA.general).optional(),
  metodoPago: z.enum(["pago_movil", "transferencia", "zelle", "binance", "efectivo_usd", "efectivo_bs"]),
  // Total en USD (métodos en dólares). En métodos en bolívares el vendedor
  // escribe el monto en Bs (montoBs) y el USD se calcula con la tasa del día.
  precioTotal: z.coerce.number().positive().optional(),
  montoBs: z.coerce.number().positive().optional(),
  precioEditado: z.boolean().optional(),
  referenciaPago: z.string().trim().optional(),
  // Opcional: número(s) del talonario físico entregado, para cuadrar caja.
  boletoFisico: z.string().optional(),
});

export type VentaTaquillaResult = { ok: true; cantidad: number; total: number; totalBs: number | null } | { ok: false; error: string };

async function requiereTaquilla() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, rol: null, error: "Tu sesión expiró — vuelve a entrar." };

  const service = createServiceClient();
  const { data: perfil } = await service.from("perfiles").select("rol, activo, nombre").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.activo || (perfil.rol !== "ventas" && perfil.rol !== "finanzas" && perfil.rol !== "admin")) {
    return { user: null, rol: null, error: "No tienes permiso para vender en taquilla." };
  }

  // Taquilla verifica sin segunda persona (el vendedor tiene el dinero en la
  // mano), así que solo se habilita el día del evento. Admin puede usarla
  // antes para probar.
  if (perfil.rol !== "admin") {
    const abierta = await taquillaAbierta(service);
    if (!abierta) {
      return { user: null, rol: null, error: "La taquilla se habilita el día del evento. Hasta entonces, registra la venta en Ventas para que Finanzas la verifique." };
    }
  }
  return { user, rol: perfil.rol as string, error: null };
}

// Venta de boleto físico el día del evento: queda VERIFICADA al instante
// (el vendedor tiene el dinero en la mano), sin correo ni QR (el control en
// la puerta es el talonario). Se registra quién vendió, cuánto, en qué
// método y a qué hora, para el arqueo de caja.
export async function registrarVentaTaquilla(input: unknown): Promise<VentaTaquillaResult> {
  const { user, rol, error: authError } = await requiereTaquilla();
  if (!user) return { ok: false, error: authError! };

  const parsed = taquillaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  const v = parsed.data;

  if (!metodosParaCanal("taquilla").some((m) => m.valor === v.metodoPago && m.activo)) {
    return { ok: false, error: "Ese método de pago no está disponible." };
  }

  const service = createServiceClient();

  // Monto cobrado: en Bs para métodos en bolívares (si el vendedor lo editó),
  // en USD para el resto. Sin editar = precio de lista.
  let precioTotalManual: number | null = null;
  let totalBsManual: number | null = null;
  if (v.precioEditado) {
    if (metodoEsEnBs(v.metodoPago) && v.montoBs != null) {
      const tasa = await obtenerTasaActual(service);
      if (!tasa) return { ok: false, error: "No hay tasa del día para convertir los bolívares. Cóbralo en dólares o pide a Finanzas que cargue la tasa." };
      precioTotalManual = Math.round((v.montoBs / tasa) * 100) / 100;
      totalBsManual = Math.round(v.montoBs * 100) / 100;
    } else if (v.precioTotal != null) {
      precioTotalManual = v.precioTotal;
    }
  }

  const referencia = [v.referenciaPago?.trim(), v.boletoFisico?.trim() ? `boleto ${v.boletoFisico.trim()}` : ""]
    .filter(Boolean)
    .join(" · ");

  const res = await registrarVentaInterna(service, {
    tipo: v.tipo,
    sillaIds: v.sillaIds ?? [],
    cantidad: v.cantidad ?? 1,
    compradorNombre: "Taquilla",
    compradorTelefono: "-",
    compradorEmail: null,
    metodoPago: v.metodoPago,
    referenciaPago: referencia || null,
    precioTotalManual,
    totalBsManual,
    // Taquilla = precio regular siempre (no consume cupo de preventa), al
    // mismo precio que la web (Anita, 25 sep): $140 VIP / $30 General.
    etapaForzada: "regular",
    // Descuento en puerta: hasta 30 % salvo admin.
    pisoPrecio: rol === "admin" ? undefined : 0.7,
    vendidoPor: user.id,
    canal: "taquilla",
    verificarDeInmediato: true,
  });
  if (!res.ok) return res;

  revalidatePath("/taquilla");
  revalidatePath("/dashboard");
  revalidatePath("/comprar");
  revalidatePath("/ventas");
  return { ok: true, cantidad: res.cantidad, total: res.total, totalBs: res.totalBs };
}
