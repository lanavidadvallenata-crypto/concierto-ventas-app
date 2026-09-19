"use server";

import { randomUUID } from "crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { enviarCorreoPendiente } from "@/lib/enviar-qr";
import { liberarSillasVencidas } from "@/lib/mapa-vip";
import { cotizarCompra, MAX_POR_COMPRA, type CotizacionCompra, type DisponibilidadEtapa } from "@/lib/precios";
import { METODOS_PAGO_ACTIVOS, metodoEsEnBs } from "@/lib/pagos";
import { verificarLimite, verificarLimitePorCorreo } from "@/lib/rate-limit";
import { obtenerTasaActual, convertirABs } from "@/lib/tasa";

// 15 minutos (antes 10): una transferencia bancaria en Venezuela desde la app
// del banco, con la clave especial, la verificación y la referencia, se toma
// fácil 10-12 minutos. Con 10 el comprador VIP pagaba y al volver encontraba
// la silla liberada.
const MINUTOS_BLOQUEO = 15;

const iniciarSchema = z
  .object({
    tipo: z.enum(["vip", "general"]),
    sillaIds: z.array(z.string().uuid()).max(MAX_POR_COMPRA.vip).optional(),
    cantidad: z.coerce.number().int().min(1).max(MAX_POR_COMPRA.general).optional(),
  })
  .refine((v) => (v.tipo === "vip" ? (v.sillaIds?.length ?? 0) >= 1 : (v.cantidad ?? 0) >= 1), {
    message: "Elige al menos una entrada.",
  });

export type IniciarCheckoutResult =
  | {
      ok: true;
      tipo: "vip" | "general";
      sillaIds: string[];
      cantidad: number;
      expiraEn: string;
      cotizacion: CotizacionCompra;
      disponibilidad: DisponibilidadEtapa[];
      tasaEurVes: number | null;
      // Lo que el comprador tiene que pagar si paga en Bs, ya calculado y
      // redondeado — es el mismo número que se guarda en el ticket.
      totalBs: number | null;
    }
  | { ok: false; error: string };

// Fase 1: bloquea las sillas (si es VIP) por 15 minutos mientras el comprador
// va a pagar, y cotiza la compra con la etapa vigente (preventa / regular).
export async function iniciarCheckoutPublico(input: unknown): Promise<IniciarCheckoutResult> {
  const parsed = iniciarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  const v = parsed.data;

  const service = createServiceClient();

  const limite = await verificarLimite(service, "iniciar");
  if (!limite.ok) return { ok: false, error: limite.error };

  const expiraEn = new Date(Date.now() + MINUTOS_BLOQUEO * 60_000).toISOString();
  let sillaIds: string[] = [];
  let cantidad = v.cantidad ?? 1;

  if (v.tipo === "vip") {
    sillaIds = [...new Set(v.sillaIds ?? [])];
    cantidad = sillaIds.length;
    if (cantidad === 0) return { ok: false, error: "Selecciona al menos una silla en el mapa." };

    await liberarSillasVencidas(service);

    // Reserva atómica silla por silla: cada UPDATE solo pasa si la silla sigue
    // disponible en ese instante. Si alguna falla, se liberan las que sí se
    // tomaron y se le pide al comprador que vuelva al mapa.
    const tomadas: string[] = [];
    for (const id of sillaIds) {
      const { data: silla, error } = await service
        .from("sillas_vip")
        .update({ estado: "reservada", reservado_hasta: expiraEn })
        .eq("id", id)
        .eq("estado", "disponible")
        .select("id")
        .maybeSingle();
      if (error || !silla) {
        if (tomadas.length) {
          await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).in("id", tomadas);
        }
        return { ok: false, error: "Una de las sillas que elegiste se acaba de ocupar — vuelve al mapa y elige otra." };
      }
      tomadas.push(silla.id);
    }
  } else {
    // General: revalidar cupo antes de cotizar.
    const { data: evento } = await service.from("eventos").select("aforo_general_total").limit(1).single();
    const { count: generalVendidos } = await service
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("tipo", "general")
      .neq("estado_pago", "rechazado");
    const cupoRestante = (evento?.aforo_general_total ?? 0) - (generalVendidos ?? 0);
    if (cupoRestante < cantidad) {
      return {
        ok: false,
        error:
          cupoRestante <= 0
            ? "Se agotaron los cupos generales."
            : `Solo quedan ${cupoRestante} entradas generales — baja la cantidad.`,
      };
    }
  }

  const { disponibilidad, cotizacion } = await cotizarCompra(service, v.tipo, cantidad);
  const tasaEurVes = await obtenerTasaActual(service);
  const totalBs = tasaEurVes ? convertirABs(cotizacion.total, tasaEurVes) : null;

  return { ok: true, tipo: v.tipo, sillaIds, cantidad, expiraEn, cotizacion, disponibilidad, tasaEurVes, totalBs };
}

const confirmarSchema = z.object({
  tipo: z.enum(["vip", "general"]),
  sillaIds: z.array(z.string().uuid()).max(MAX_POR_COMPRA.vip).optional(),
  cantidad: z.coerce.number().int().min(1).max(MAX_POR_COMPRA.general).optional(),
  expiraEnEsperado: z.string().optional(),
  compradorNombre: z.string().min(2),
  compradorTelefono: z.string().min(7),
  compradorEmail: z.string().email("Correo inválido — es la única forma de enviarte el QR de entrada."),
  metodoPago: z.enum(["pago_movil", "transferencia", "zelle", "binance", "efectivo_usd", "efectivo_bs"]),
  referenciaPago: z.string().min(3, "Ingresa el número de referencia del pago."),
  honeypot: z.string().max(0).optional(), // campo invisible: si viene lleno, es un bot
});

export type ConfirmarCheckoutResult =
  | { ok: true; avisoEmail?: string; duplicado?: boolean; cantidad: number; total: number }
  | { ok: false; error: string };

// Fase 2: el comprador ya pagó y vuelve con la referencia — se crean los
// tickets pendientes (uno por asistente, todos con el mismo grupo_id) y, si es
// VIP, el bloqueo temporal pasa a ser permanente porque ya hay ticket.
export async function confirmarCheckoutPublico(input: unknown): Promise<ConfirmarCheckoutResult> {
  const parsed = confirmarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos del formulario." };
  }
  const v = parsed.data;

  if (v.honeypot) {
    // Bot: respondemos como si todo hubiera salido bien, sin hacer nada.
    console.warn("Checkout bloqueado por honeypot:", v.compradorEmail);
    return { ok: true, cantidad: 0, total: 0 };
  }

  // El formulario ya deshabilita los métodos que no están activos (ej. pago
  // móvil "muy pronto") y no ofrece efectivo, pero el servidor no lo validaba.
  const metodo = METODOS_PAGO_ACTIVOS.find((m) => m.valor === v.metodoPago && m.canales.includes("web"));
  if (!metodo) {
    return { ok: false, error: "Ese método de pago no está disponible para compra en línea — elige otro." };
  }

  const service = createServiceClient();

  const limite = await verificarLimite(service, "confirmar");
  if (!limite.ok) return { ok: false, error: limite.error };

  const limiteCorreo = await verificarLimitePorCorreo(service, v.compradorEmail);
  if (!limiteCorreo.ok) return { ok: false, error: limiteCorreo.error };

  const { data: evento } = await service.from("eventos").select("id, aforo_general_total").limit(1).single();
  if (!evento) return { ok: false, error: "No se encontró el evento en la base de datos." };

  const sillaIds = v.tipo === "vip" ? [...new Set(v.sillaIds ?? [])] : [];
  const cantidad = v.tipo === "vip" ? sillaIds.length : (v.cantidad ?? 1);
  if (cantidad < 1) return { ok: false, error: "Elige al menos una entrada." };

  // Idempotencia: misma persona, misma referencia, mismo tipo, en los últimos
  // 10 minutos → no crear un segundo grupo de tickets; avisar que ya estaba.
  const { data: ticketsExistentes } = await service
    .from("tickets")
    .select("id")
    .eq("comprador_email", v.compradorEmail)
    .eq("referencia_pago", v.referenciaPago)
    .eq("tipo", v.tipo)
    .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .limit(1);

  if (ticketsExistentes && ticketsExistentes.length > 0) {
    return { ok: true, duplicado: true, cantidad, total: 0 };
  }

  if (v.tipo === "general") {
    // A diferencia de VIP (que bloquea sillas puntuales), General no tiene
    // reserva: se vuelve a contar justo antes de insertar para no vender
    // más entradas generales de las que caben.
    const { count: generalVendidos } = await service
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("tipo", "general")
      .neq("estado_pago", "rechazado");

    const cupoRestante = evento.aforo_general_total - (generalVendidos ?? 0);
    if (cupoRestante < cantidad) {
      return {
        ok: false,
        error:
          cupoRestante <= 0
            ? "Se agotaron los cupos generales — ya no quedan entradas de este tipo."
            : `Solo quedan ${cupoRestante} entradas generales. Vuelve atrás y ajusta la cantidad.`,
      };
    }
  } else {
    if (!v.expiraEnEsperado) {
      return { ok: false, error: "Falta la reserva de sillas — vuelve a intentarlo desde el mapa." };
    }

    await liberarSillasVencidas(service);

    // Todas las sillas del grupo deben seguir con el hold de ESTA compra.
    const { data: sillasActuales } = await service
      .from("sillas_vip")
      .select("id, estado, reservado_hasta")
      .in("id", sillaIds);

    const vigentes = (sillasActuales ?? []).filter(
      (s) => s.estado === "reservada" && s.reservado_hasta === v.expiraEnEsperado
    );
    if (vigentes.length !== sillaIds.length) {
      return {
        ok: false,
        error: "Tu tiempo para pagar expiró y las sillas se liberaron. Vuelve a elegir tus sillas en el mapa.",
      };
    }
  }

  // Cotización final en el servidor (la del cliente es solo para mostrar):
  // el precio de cada ticket sale de la etapa vigente en este instante.
  const { cotizacion } = await cotizarCompra(service, v.tipo, cantidad);
  const enBs = metodoEsEnBs(v.metodoPago);
  const tasa = enBs ? await obtenerTasaActual(service) : null;

  const grupoId = randomUUID();
  const filas = cotizacion.lineas.map((linea, i) => ({
    evento_id: evento.id,
    grupo_id: grupoId,
    canal: "web",
    etapa: linea.etapa,
    tipo: v.tipo,
    silla_id: v.tipo === "vip" ? sillaIds[i] : null,
    comprador_nombre: v.compradorNombre,
    comprador_telefono: v.compradorTelefono,
    comprador_email: v.compradorEmail,
    // Precio siempre en USD (moneda de la lista). Si pagó en Bs, precio_bs es
    // el monto exacto que se le indicó, con la tasa del momento.
    precio: linea.total,
    moneda: "USD",
    precio_bs: enBs && tasa ? convertirABs(linea.total, tasa) : null,
    tasa_aplicada: enBs && tasa ? tasa : null,
    metodo_pago: v.metodoPago,
    referencia_pago: v.referenciaPago,
    vendido_por: null,
  }));

  const { error: insertError } = await service.from("tickets").insert(filas);

  if (insertError) {
    if (v.tipo === "vip" && sillaIds.length) {
      await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).in("id", sillaIds);
    }
    console.error("Error creando tickets públicos:", insertError.message);
    return { ok: false, error: "No se pudo registrar tu compra — intenta de nuevo." };
  }

  if (v.tipo === "vip" && sillaIds.length) {
    // Ya no es un bloqueo temporal — a partir de aquí quedan reservadas porque tienen ticket.
    await service.from("sillas_vip").update({ reservado_hasta: null }).in("id", sillaIds);
  }

  revalidatePath("/comprar");
  revalidatePath("/finanzas");
  revalidatePath("/ventas");
  revalidatePath("/dashboard");

  let avisoEmail: string | undefined;
  try {
    await enviarCorreoPendiente({
      destinatario: v.compradorEmail,
      nombreComprador: v.compradorNombre,
      cantidad,
      tipo: v.tipo,
      totalUsd: cotizacion.total,
      totalBs: enBs && tasa ? convertirABs(cotizacion.total, tasa) : null,
      referencia: v.referenciaPago,
    });
  } catch (e) {
    console.error("Error enviando correo de compra recibida:", (e as Error).message);
    avisoEmail = "Tu compra quedó registrada, pero no pudimos enviarte el correo de confirmación — escríbenos por WhatsApp para avisarte cuando esté listo tu QR.";
  }

  return { ok: true, avisoEmail, cantidad, total: cotizacion.total };
}
