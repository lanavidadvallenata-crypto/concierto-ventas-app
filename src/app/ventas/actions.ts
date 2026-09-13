"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";

const ventaSchema = z.object({
  tipo: z.enum(["vip", "general"]),
  sillaId: z.string().uuid().optional(),
  cantidadGeneral: z.coerce.number().int().min(1).max(20).optional(),
  compradorNombre: z.string().min(2),
  compradorTelefono: z.string().min(7),
  compradorEmail: z.string().email("Correo inválido — es la única forma de enviar el QR de entrada."),
  precio: z.coerce.number().positive(),
  metodoPago: z.enum(["pago_movil", "transferencia", "zelle", "binance"]),
  referenciaPago: z.string().optional(),
});

export type RegistrarVentaResult = { ok: true } | { ok: false; error: string };

export async function registrarVenta(formData: FormData): Promise<RegistrarVentaResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión expiró — vuelve a entrar." };

  const parsed = ventaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Revisa los datos del formulario — falta o sobra algo." };
  }
  const v = parsed.data;

  const service = createServiceClient();

  const { data: evento } = await service.from("eventos").select("id").limit(1).single();
  if (!evento) return { ok: false, error: "No se encontró el evento en la base de datos." };

  if (v.tipo === "vip") {
    if (!v.sillaId) return { ok: false, error: "Selecciona una silla VIP." };

    // Reserva atómica: solo pasa si la silla sigue disponible en este instante.
    const { data: silla, error: sillaError } = await service
      .from("sillas_vip")
      .update({ estado: "reservada" })
      .eq("id", v.sillaId)
      .eq("estado", "disponible")
      .select("id")
      .maybeSingle();

    if (sillaError || !silla) {
      return { ok: false, error: "Esa silla ya no está disponible — alguien más la tomó. Elige otra." };
    }
  }

  const { error: insertError } = await service.from("tickets").insert({
    evento_id: evento.id,
    tipo: v.tipo,
    silla_id: v.tipo === "vip" ? v.sillaId : null,
    comprador_nombre: v.compradorNombre,
    comprador_telefono: v.compradorTelefono,
    comprador_email: v.compradorEmail,
    precio: v.precio,
    metodo_pago: v.metodoPago,
    referencia_pago: v.referenciaPago || null,
    vendido_por: user.id,
  });

  if (insertError) {
    // Si falló después de reservar la silla, la liberamos para no perderla.
    if (v.tipo === "vip" && v.sillaId) {
      await service.from("sillas_vip").update({ estado: "disponible" }).eq("id", v.sillaId);
    }
    return { ok: false, error: "No se pudo registrar la venta — intenta de nuevo." };
  }

  revalidatePath("/ventas");
  revalidatePath("/finanzas");
  return { ok: true };
}
