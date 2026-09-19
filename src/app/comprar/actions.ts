"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { enviarCorreoPendiente } from "@/lib/enviar-qr";
import { liberarSillasVencidas } from "@/lib/mapa-vip";
import { calcularTotal } from "@/lib/precios";
import { METODOS_PAGO_ACTIVOS } from "@/lib/pagos";
import { verificarLimite, verificarLimitePorCorreo } from "@/lib/rate-limit";

// 15 minutos (antes 10): una transferencia bancaria en Venezuela desde la app
// del banco, con la clave especial, la verificación y la referencia, se toma
// fácil 10-12 minutos. Con 10 el comprador VIP pagaba y al volver encontraba
// la silla liberada.
const MINUTOS_BLOQUEO = 15;

const iniciarSchema = z.object({
  tipo: z.enum(["vip", "general"]),
  sillaId: z.string().uuid().optional(),
});

export type IniciarCheckoutResult =
  | { ok: true; tipo: "vip" | "general"; sillaId?: string; expiraEn: string; total: number }
  | { ok: false; error: string };

// Fase 1: bloquea la silla (si es VIP) por 10 minutos mientras el comprador va a pagar.
export async function iniciarCheckoutPublico(input: unknown): Promise<IniciarCheckoutResult> {
  const parsed = iniciarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const v = parsed.data;

  const service = createServiceClient();

  const limite = await verificarLimite(service, "iniciar");
  if (!limite.ok) return { ok: false, error: limite.error };

  const total = calcularTotal(v.tipo).total;

  if (v.tipo === "vip") {
    if (!v.sillaId) return { ok: false, error: "Selecciona una silla en el mapa." };

    await liberarSillasVencidas(service);

    const expiraEn = new Date(Date.now() + MINUTOS_BLOQUEO * 60_000).toISOString();

    const { data: silla, error } = await service
      .from("sillas_vip")
      .update({ estado: "reservada", reservado_hasta: expiraEn })
      .eq("id", v.sillaId)
      .eq("estado", "disponible")
      .select("id, reservado_hasta")
      .maybeSingle();

    if (error || !silla) {
      return { ok: false, error: "Esa silla se acaba de ocupar — elige otra en el mapa." };
    }

    return { ok: true, tipo: "vip", sillaId: silla.id, expiraEn: silla.reservado_hasta as string, total };
  }

  // General: sin bloqueo individual (no hay asiento que reservar), solo referencia de tiempo
  // para mostrar el mismo conteo regresivo en pantalla.
  const expiraEn = new Date(Date.now() + MINUTOS_BLOQUEO * 60_000).toISOString();
  return { ok: true, tipo: "general", expiraEn, total };
}

const confirmarSchema = z.object({
  tipo: z.enum(["vip", "general"]),
  sillaId: z.string().uuid().optional(),
  expiraEnEsperado: z.string().optional(),
  compradorNombre: z.string().min(2),
  compradorTelefono: z.string().min(7),
  compradorEmail: z.string().email("Correo inválido — es la única forma de enviarte el QR de entrada."),
  metodoPago: z.enum(["pago_movil", "transferencia", "zelle", "binance"]),
  referenciaPago: z.string().min(3, "Ingresa el número de referencia del pago."),
  honeypot: z.string().max(0).optional(), // campo invisible: si viene lleno, es un bot
});

export type ConfirmarCheckoutResult =
  | { ok: true; avisoEmail?: string; duplicado?: boolean }
  | { ok: false; error: string };

// Fase 2: el comprador ya pagó y vuelve con la referencia — se crea el ticket pendiente
// y (si es VIP) se libera el bloqueo temporal a favor de un bloqueo permanente con ticket.
export async function confirmarCheckoutPublico(input: unknown): Promise<ConfirmarCheckoutResult> {
  const parsed = confirmarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos del formulario." };
  }
  const v = parsed.data;

  if (v.honeypot) {
    // Bot: respondemos como si todo hubiera salido bien, sin hacer nada.
    console.warn("Checkout bloqueado por honeypot:", v.compradorEmail);
    return { ok: true };
  }

  // El formulario ya deshabilita los métodos que no están activos (ej. pago
  // móvil "muy pronto"), pero el servidor no lo validaba: una petición
  // armada a mano podía crear un ticket con un método que Finanzas no puede
  // verificar todavía.
  if (!METODOS_PAGO_ACTIVOS.some((m) => m.valor === v.metodoPago)) {
    return { ok: false, error: "Ese método de pago todavía no está disponible — elige otro." };
  }

  const service = createServiceClient();

  const limite = await verificarLimite(service, "confirmar");
  if (!limite.ok) return { ok: false, error: limite.error };

  const limiteCorreo = await verificarLimitePorCorreo(service, v.compradorEmail);
  if (!limiteCorreo.ok) return { ok: false, error: limiteCorreo.error };

  const { data: evento } = await service.from("eventos").select("id, aforo_general_total").limit(1).single();
  if (!evento) return { ok: false, error: "No se encontró el evento en la base de datos." };

  const precioTotal = calcularTotal(v.tipo).total;

  if (v.tipo === "general") {
    // A diferencia de VIP (que bloquea una silla puntual), General no tenía
    // ninguna revalidación server-side del cupo — solo se mostraba en
    // pantalla. Se vuelve a contar justo antes de insertar para no vender
    // más entradas generales de las que caben.
    const { count: generalVendidos } = await service
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("tipo", "general")
      .neq("estado_pago", "rechazado");

    const cupoRestante = evento.aforo_general_total - (generalVendidos ?? 0);
    if (cupoRestante <= 0) {
      return { ok: false, error: "Se agotaron los cupos generales — ya no quedan entradas de este tipo." };
    }
  }

  // Idempotencia: si esta misma persona ya reportó esta misma referencia de pago
  // para este mismo tipo de entrada hace poco (doble clic, red lenta que hace
  // reintentar el navegador, usuario que recarga y vuelve a mandar el
  // formulario), no crear un segundo ticket — devolvemos éxito sobre el que ya
  // existe en vez de duplicar la venta.
  //
  // Se afinó después de la prueba con el equipo: la versión anterior comparaba
  // solo correo + referencia en 30 minutos y respondía "¡Recibimos tu compra!"
  // sin crear nada ni avisar. En una prueba donde varias personas usan el
  // mismo correo o la misma referencia ("123", "prueba"), las compras se
  // "perdían" en silencio. Ahora: ventana corta, se considera el tipo de
  // entrada, y se le dice al comprador que la compra ya estaba registrada.
  const { data: ticketsExistentes } = await service
    .from("tickets")
    .select("id")
    .eq("comprador_email", v.compradorEmail)
    .eq("referencia_pago", v.referenciaPago)
    .eq("tipo", v.tipo)
    .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .limit(1);

  if (ticketsExistentes && ticketsExistentes.length > 0) {
    return { ok: true, duplicado: true };
  }

  if (v.tipo === "vip") {
    if (!v.sillaId || !v.expiraEnEsperado) {
      return { ok: false, error: "Falta la silla seleccionada — vuelve a intentarlo desde el mapa." };
    }

    await liberarSillasVencidas(service);

    const { data: sillaActual } = await service
      .from("sillas_vip")
      .select("estado, reservado_hasta")
      .eq("id", v.sillaId)
      .single();

    const holdVigente =
      sillaActual?.estado === "reservada" && sillaActual.reservado_hasta === v.expiraEnEsperado;

    if (!holdVigente) {
      return {
        ok: false,
        error: "Tu tiempo para pagar expiró y la silla se liberó. Vuelve a elegir tu silla en el mapa.",
      };
    }

    // Ya no es un bloqueo temporal — a partir de aquí queda reservada porque tiene un ticket.
    await service.from("sillas_vip").update({ reservado_hasta: null }).eq("id", v.sillaId);
  }

  const { error: insertError } = await service.from("tickets").insert({
    evento_id: evento.id,
    tipo: v.tipo,
    silla_id: v.tipo === "vip" ? v.sillaId : null,
    comprador_nombre: v.compradorNombre,
    comprador_telefono: v.compradorTelefono,
    comprador_email: v.compradorEmail,
    // El precio siempre se guarda en USD (es la moneda de la lista de
    // precios). La moneda en la que el comprador pagó de verdad la indica
    // metodo_pago (transferencia/pago móvil = Bs, zelle/binance = USD) —
    // antes se guardaba "VES" con un monto en dólares y Finanzas lo mostraba
    // como "$33.00 VES", que no es ni una cosa ni la otra.
    precio: precioTotal,
    moneda: "USD",
    metodo_pago: v.metodoPago,
    referencia_pago: v.referenciaPago,
    vendido_por: null,
  });

  if (insertError) {
    if (v.tipo === "vip" && v.sillaId) {
      // Liberar la silla si falló la creación del ticket, para no perderla.
      await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).eq("id", v.sillaId);
    }
    console.error("Error creando ticket público:", insertError);
    return { ok: false, error: "No se pudo registrar tu compra — intenta de nuevo." };
  }

  revalidatePath("/comprar");
  revalidatePath("/finanzas");

  let avisoEmail: string | undefined;
  try {
    await enviarCorreoPendiente({ destinatario: v.compradorEmail, nombreComprador: v.compradorNombre });
  } catch {
    avisoEmail = "Tu compra quedó registrada, pero no pudimos enviarte el correo de confirmación — escríbenos por WhatsApp para avisarte cuando esté listo tu QR.";
  }

  return { ok: true, avisoEmail };
}
