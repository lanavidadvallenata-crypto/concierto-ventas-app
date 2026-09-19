"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { enviarCorreoPendiente } from "@/lib/enviar-qr";
import { MAX_POR_COMPRA } from "@/lib/precios";
import { metodosParaCanal } from "@/lib/pagos";
import { registrarVentaInterna } from "@/lib/registrar-venta";

const ventaSchema = z.object({
  tipo: z.enum(["vip", "general"]),
  sillaIds: z.string().optional(), // JSON array de uuids (VIP)
  cantidadGeneral: z.coerce.number().int().min(1).max(MAX_POR_COMPRA.general).optional(),
  compradorNombre: z.string().min(2),
  compradorTelefono: z.string().min(7),
  compradorEmail: z.string().email("Correo inválido — es la única forma de enviar el QR de entrada."),
  precio: z.coerce.number().positive(),
  metodoPago: z.enum(["pago_movil", "transferencia", "zelle", "binance", "efectivo_usd", "efectivo_bs"]),
  referenciaPago: z.string().optional(),
});

export type RegistrarVentaResult = { ok: true; avisoEmail?: string; cantidad: number; total: number } | { ok: false; error: string };

// Mismo patrón que requiereFinanzas/requiereAdmin.
async function requiereVentas() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, error: "Tu sesión expiró — vuelve a entrar." };

  const service = createServiceClient();
  const { data: perfil } = await service.from("perfiles").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.activo || (perfil.rol !== "ventas" && perfil.rol !== "finanzas" && perfil.rol !== "admin")) {
    return { user: null, error: "No tienes permiso para registrar ventas." };
  }
  return { user, error: null };
}

export async function registrarVenta(formData: FormData): Promise<RegistrarVentaResult> {
  const { user, error: authError } = await requiereVentas();
  if (!user) return { ok: false, error: authError! };

  const parsed = ventaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos del formulario — falta o sobra algo." };
  }
  const v = parsed.data;

  if (!metodosParaCanal("manual").some((m) => m.valor === v.metodoPago && m.activo)) {
    return { ok: false, error: "Ese método de pago no está disponible." };
  }

  let sillaIds: string[] = [];
  if (v.tipo === "vip") {
    try {
      const arr = JSON.parse(v.sillaIds ?? "[]");
      sillaIds = Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
    } catch {
      sillaIds = [];
    }
    if (sillaIds.length === 0) return { ok: false, error: "Selecciona al menos una silla VIP." };
  }

  const service = createServiceClient();
  const res = await registrarVentaInterna(service, {
    tipo: v.tipo,
    sillaIds,
    cantidad: v.cantidadGeneral ?? 1,
    compradorNombre: v.compradorNombre,
    compradorTelefono: v.compradorTelefono,
    compradorEmail: v.compradorEmail,
    metodoPago: v.metodoPago,
    referenciaPago: v.referenciaPago || null,
    precioTotalManual: v.precio,
    vendidoPor: user.id,
    canal: "manual",
    verificarDeInmediato: false,
  });
  if (!res.ok) return res;

  revalidatePath("/ventas");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
  revalidatePath("/comprar");

  let avisoEmail: string | undefined;
  try {
    await enviarCorreoPendiente({
      destinatario: v.compradorEmail,
      nombreComprador: v.compradorNombre,
      cantidad: res.cantidad,
      tipo: v.tipo,
      totalUsd: res.total,
      totalBs: res.totalBs,
      referencia: v.referenciaPago || null,
    });
  } catch {
    avisoEmail = "La venta quedó registrada, pero el correo de bienvenida no se pudo enviar — avísale al comprador por WhatsApp que su pago está en verificación.";
  }

  return { ok: true, avisoEmail, cantidad: res.cantidad, total: res.total };
}
