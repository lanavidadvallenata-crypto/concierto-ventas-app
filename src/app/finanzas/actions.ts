"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generarTokenQR } from "@/lib/qr";
import { enviarCorreoQR } from "@/lib/enviar-qr";
import { guardarTasaManual } from "@/lib/tasa";

type Resultado = { ok: true } | { ok: false; error: string };

async function requiereFinanzas() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, error: "Tu sesión expiró — vuelve a entrar." };

  const service = createServiceClient();
  const { data: perfil } = await service.from("perfiles").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.activo || (perfil.rol !== "finanzas" && perfil.rol !== "admin")) {
    return { user: null, error: "No tienes permiso para verificar pagos." };
  }
  return { user, error: null };
}

export async function verificarPago(ticketId: string): Promise<Resultado> {
  const { user, error } = await requiereFinanzas();
  if (!user) return { ok: false, error: error! };

  const service = createServiceClient();

  const { data: ticket } = await service
    .from("tickets")
    .select("id, vendido_por, tipo, silla_id, comprador_nombre, comprador_email, estado_pago, sillas_vip(numero, mesa_id, mesas_vip(numero))")
    .eq("id", ticketId)
    .maybeSingle();

  if (!ticket) return { ok: false, error: "No se encontró ese ticket." };
  if (ticket.estado_pago !== "pendiente") return { ok: false, error: "Ese ticket ya fue procesado." };

  // Control cruzado anti-fraude: quien verifica no puede ser quien vendió.
  if (ticket.vendido_por === user.id) {
    return { ok: false, error: "No puedes verificar una venta que tú mismo registraste — pide a otra persona de Finanzas que la revise." };
  }

  const qrToken = generarTokenQR();

  const { error: updateError } = await service
    .from("tickets")
    .update({
      estado_pago: "verificado",
      verificado_por: user.id,
      verificado_en: new Date().toISOString(),
      qr_token: qrToken,
    })
    .eq("id", ticketId)
    .eq("estado_pago", "pendiente");

  if (updateError) return { ok: false, error: "No se pudo actualizar el ticket." };

  if (ticket.tipo === "vip" && ticket.silla_id) {
    await service.from("sillas_vip").update({ estado: "vendida" }).eq("id", ticket.silla_id);
  }

  if (ticket.comprador_email) {
    const sillaInfo = ticket.sillas_vip as unknown as { numero: number; mesas_vip: { numero: number } } | null;
    try {
      await enviarCorreoQR({
        destinatario: ticket.comprador_email,
        nombreComprador: ticket.comprador_nombre,
        tipo: ticket.tipo as "vip" | "general",
        mesaNumero: sillaInfo?.mesas_vip?.numero ?? null,
        sillaNumero: sillaInfo?.numero ?? null,
        qrToken,
      });
      await service.from("tickets").update({ qr_enviado_en: new Date().toISOString() }).eq("id", ticketId);
    } catch {
      // El ticket ya quedó verificado — el correo se puede reenviar manualmente si falla.
      return { ok: false, error: "Se verificó el pago pero el correo con el QR no se pudo enviar. Avisa para reenviarlo." };
    }
  }

  revalidatePath("/finanzas");
  revalidatePath("/ventas");
  return { ok: true };
}

export async function actualizarTasaManual(valorTexto: string): Promise<Resultado> {
  const { user, error } = await requiereFinanzas();
  if (!user) return { ok: false, error: error! };

  const valor = Number(valorTexto.replace(",", "."));
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, error: "Ingresa un número válido mayor a 0." };
  }

  const service = createServiceClient();
  const resultado = await guardarTasaManual(service, valor);
  if (!resultado.ok) return { ok: false, error: resultado.error };

  revalidatePath("/finanzas");
  revalidatePath("/comprar");
  revalidatePath("/ventas");
  return { ok: true };
}

export async function rechazarPago(ticketId: string): Promise<Resultado> {
  const { user, error } = await requiereFinanzas();
  if (!user) return { ok: false, error: error! };

  const service = createServiceClient();

  const { data: ticket } = await service
    .from("tickets")
    .select("id, tipo, silla_id, estado_pago")
    .eq("id", ticketId)
    .maybeSingle();

  if (!ticket) return { ok: false, error: "No se encontró ese ticket." };
  if (ticket.estado_pago !== "pendiente") return { ok: false, error: "Ese ticket ya fue procesado." };

  // Mismo patrón atómico que verificarPago: el UPDATE solo aplica si el ticket
  // sigue "pendiente" en este instante — evita que un rechazo y una verificación
  // concurrentes (dos personas de Finanzas procesando el mismo ticket a la vez)
  // se pisen entre sí y corrompan el estado de un pago ya verificado.
  const { data: actualizado, error: updateError } = await service
    .from("tickets")
    .update({ estado_pago: "rechazado", verificado_por: user.id, verificado_en: new Date().toISOString() })
    .eq("id", ticketId)
    .eq("estado_pago", "pendiente")
    .select("id")
    .maybeSingle();

  if (updateError || !actualizado) {
    return { ok: false, error: "Ese ticket ya fue procesado por otra persona." };
  }

  if (ticket.tipo === "vip" && ticket.silla_id) {
    await service.from("sillas_vip").update({ estado: "disponible" }).eq("id", ticket.silla_id);
  }

  revalidatePath("/finanzas");
  revalidatePath("/ventas");
  return { ok: true };
}
