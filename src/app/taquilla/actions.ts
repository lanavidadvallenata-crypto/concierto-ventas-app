"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { MAX_POR_COMPRA } from "@/lib/precios";
import { metodosParaCanal } from "@/lib/pagos";
import { registrarVentaInterna } from "@/lib/registrar-venta";

const taquillaSchema = z.object({
  tipo: z.enum(["vip", "general"]),
  sillaIds: z.array(z.string().uuid()).max(MAX_POR_COMPRA.vip).optional(),
  cantidad: z.coerce.number().int().min(1).max(MAX_POR_COMPRA.general).optional(),
  metodoPago: z.enum(["pago_movil", "transferencia", "zelle", "binance", "efectivo_usd", "efectivo_bs"]),
  precioTotal: z.coerce.number().positive(),
  referenciaPago: z.string().optional(),
  // Opcional: número(s) del talonario físico entregado, para cuadrar caja.
  boletoFisico: z.string().optional(),
});

export type VentaTaquillaResult = { ok: true; cantidad: number; total: number; totalBs: number | null } | { ok: false; error: string };

async function requiereTaquilla() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, error: "Tu sesión expiró — vuelve a entrar." };

  const service = createServiceClient();
  const { data: perfil } = await service.from("perfiles").select("rol, activo, nombre").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.activo || (perfil.rol !== "ventas" && perfil.rol !== "finanzas" && perfil.rol !== "admin")) {
    return { user: null, error: "No tienes permiso para vender en taquilla." };
  }
  return { user, error: null };
}

// Venta de boleto físico el día del evento: queda VERIFICADA al instante
// (el vendedor tiene el dinero en la mano), sin correo ni QR (el control en
// la puerta es el talonario). Se registra quién vendió, cuánto, en qué
// método y a qué hora, para el arqueo de caja.
export async function registrarVentaTaquilla(input: unknown): Promise<VentaTaquillaResult> {
  const { user, error: authError } = await requiereTaquilla();
  if (!user) return { ok: false, error: authError! };

  const parsed = taquillaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  const v = parsed.data;

  if (!metodosParaCanal("taquilla").some((m) => m.valor === v.metodoPago && m.activo)) {
    return { ok: false, error: "Ese método de pago no está disponible." };
  }

  const service = createServiceClient();
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
    precioTotalManual: v.precioTotal,
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
