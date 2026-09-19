"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generarTokenQR } from "@/lib/qr";
import { enviarCorreoQR } from "@/lib/enviar-qr";
import { guardarTasaManual } from "@/lib/tasa";
import { obtenerAsiento } from "@/lib/asiento";

type Resultado = { ok: true; aviso?: string } | { ok: false; error: string };

async function requiereFinanzas() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, rol: null, error: "Tu sesión expiró — vuelve a entrar." };

  const service = createServiceClient();
  const { data: perfil } = await service.from("perfiles").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.activo || (perfil.rol !== "finanzas" && perfil.rol !== "admin")) {
    return { user: null, rol: null, error: "No tienes permiso para verificar pagos." };
  }
  return { user, rol: perfil.rol as "finanzas" | "admin", error: null };
}

export async function verificarPago(ticketId: string): Promise<Resultado> {
  const { user, rol, error } = await requiereFinanzas();
  if (!user) return { ok: false, error: error! };

  const service = createServiceClient();

  // Sin "embed" de sillas_vip: ver src/lib/asiento.ts (la FK tickets →
  // sillas_vip no existe en la base y el embed hacía fallar TODA
  // verificación con "No se encontró ese ticket").
  const { data: ticket, error: ticketError } = await service
    .from("tickets")
    .select("id, vendido_por, tipo, silla_id, comprador_nombre, comprador_email, estado_pago")
    .eq("id", ticketId)
    .maybeSingle();

  if (ticketError) {
    console.error("Error leyendo ticket a verificar:", ticketError.message);
    return { ok: false, error: `No se pudo leer el ticket (${ticketError.message}). Intenta de nuevo.` };
  }
  if (!ticket) return { ok: false, error: "No se encontró ese ticket." };
  if (ticket.estado_pago !== "pendiente") return { ok: false, error: "Ese ticket ya fue procesado." };

  // Control cruzado anti-fraude: quien vende no verifica su propia venta.
  // Aplica al rol "finanzas". El rol "admin" (la dueña del sistema) SÍ puede
  // verificar una venta que ella misma registró: en un equipo chico ella es
  // ventas y finanzas a la vez, y sin esta excepción sus propias ventas
  // quedaban imposibles de aprobar para siempre.
  if (ticket.vendido_por === user.id && rol !== "admin") {
    return {
      ok: false,
      error: "Esta venta la registraste tú. Por control cruzado, la tiene que verificar otra persona de Finanzas o un admin.",
    };
  }

  const qrToken = generarTokenQR();

  // UPDATE atómico: solo aplica si el ticket sigue "pendiente" en este instante.
  const { data: actualizado, error: updateError } = await service
    .from("tickets")
    .update({
      estado_pago: "verificado",
      verificado_por: user.id,
      verificado_en: new Date().toISOString(),
      qr_token: qrToken,
    })
    .eq("id", ticketId)
    .eq("estado_pago", "pendiente")
    .select("id")
    .maybeSingle();

  if (updateError || !actualizado) {
    return { ok: false, error: "Ese ticket ya fue procesado por otra persona." };
  }

  if (ticket.tipo === "vip" && ticket.silla_id) {
    await service.from("sillas_vip").update({ estado: "vendida" }).eq("id", ticket.silla_id);
  }

  revalidatePath("/finanzas");
  revalidatePath("/ventas");
  revalidatePath("/dashboard");

  if (!ticket.comprador_email) {
    return { ok: true, aviso: "Pago verificado, pero este ticket no tiene correo — no hay a dónde mandar el QR." };
  }

  const asiento = ticket.tipo === "vip" ? await obtenerAsiento(service, ticket.silla_id) : null;
  try {
    await enviarCorreoQR({
      destinatario: ticket.comprador_email,
      nombreComprador: ticket.comprador_nombre,
      tipo: ticket.tipo as "vip" | "general",
      fila: asiento?.fila ?? null,
      mesaNumero: asiento?.mesaNumero ?? null,
      sillaNumero: asiento?.sillaNumero ?? null,
      qrToken,
    });
    await service.from("tickets").update({ qr_enviado_en: new Date().toISOString() }).eq("id", ticketId);
  } catch (e) {
    console.error("Error enviando QR:", (e as Error).message);
    // El pago YA quedó verificado (y el ticket ya salió de pendientes). Antes
    // esto devolvía ok:false, y en pantalla parecía que la verificación había
    // fallado — la persona volvía a buscar el ticket y no lo encontraba.
    return {
      ok: true,
      aviso: `Pago verificado, pero el correo con el QR a ${ticket.comprador_email} no salió. Búscalo abajo por nombre o correo y usa "Reenviar QR".`,
    };
  }

  return { ok: true };
}

export async function rechazarPago(ticketId: string): Promise<Resultado> {
  const { user, error } = await requiereFinanzas();
  if (!user) return { ok: false, error: error! };

  const service = createServiceClient();

  const { data: ticket, error: ticketError } = await service
    .from("tickets")
    .select("id, tipo, silla_id, estado_pago")
    .eq("id", ticketId)
    .maybeSingle();

  if (ticketError) {
    console.error("Error leyendo ticket a rechazar:", ticketError.message);
    return { ok: false, error: `No se pudo leer el ticket (${ticketError.message}). Intenta de nuevo.` };
  }
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
    await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).eq("id", ticket.silla_id);
  }

  revalidatePath("/finanzas");
  revalidatePath("/ventas");
  revalidatePath("/dashboard");
  revalidatePath("/comprar");
  return { ok: true };
}

// Reenvía el correo con el QR de un ticket ya verificado. Casos reales:
// el correo rebotó, el comprador lo borró, lo buscó en spam y no está, o el
// envío falló justo al verificar. No genera un token nuevo: reenvía el
// mismo QR (si el comprador ya lo tenía, sigue siendo válido y único).
export async function reenviarQR(ticketId: string): Promise<Resultado> {
  const { user, error } = await requiereFinanzas();
  if (!user) return { ok: false, error: error! };

  const service = createServiceClient();

  const { data: ticket, error: ticketError } = await service
    .from("tickets")
    .select("id, tipo, silla_id, comprador_nombre, comprador_email, estado_pago, qr_token, qr_usado")
    .eq("id", ticketId)
    .maybeSingle();

  if (ticketError) {
    console.error("Error leyendo ticket para reenviar QR:", ticketError.message);
    return { ok: false, error: `No se pudo leer el ticket (${ticketError.message}). Intenta de nuevo.` };
  }
  if (!ticket) return { ok: false, error: "No se encontró ese ticket." };
  if (ticket.estado_pago !== "verificado" || !ticket.qr_token) {
    return { ok: false, error: "Solo se puede reenviar el QR de un pago ya verificado." };
  }
  if (!ticket.comprador_email) return { ok: false, error: "Este ticket no tiene correo." };
  if (ticket.qr_usado) return { ok: false, error: "Ese QR ya fue usado en la puerta — no se reenvía." };

  const asiento = ticket.tipo === "vip" ? await obtenerAsiento(service, ticket.silla_id) : null;
  try {
    await enviarCorreoQR({
      destinatario: ticket.comprador_email,
      nombreComprador: ticket.comprador_nombre,
      tipo: ticket.tipo as "vip" | "general",
      fila: asiento?.fila ?? null,
      mesaNumero: asiento?.mesaNumero ?? null,
      sillaNumero: asiento?.sillaNumero ?? null,
      qrToken: ticket.qr_token,
    });
  } catch (e) {
    console.error("Error reenviando QR:", (e as Error).message);
    return { ok: false, error: "No se pudo enviar el correo. Revisa que el correo esté bien escrito e intenta de nuevo en un minuto." };
  }

  await service.from("tickets").update({ qr_enviado_en: new Date().toISOString() }).eq("id", ticketId);
  return { ok: true, aviso: `QR reenviado a ${ticket.comprador_email}.` };
}

export type TicketBuscado = {
  id: string;
  compradorNombre: string;
  compradorEmail: string | null;
  compradorTelefono: string;
  tipo: "vip" | "general";
  precio: number;
  metodoPago: string;
  referenciaPago: string | null;
  estadoPago: "pendiente" | "verificado" | "rechazado";
  creadoEn: string;
  qrEnviadoEn: string | null;
  qrUsado: boolean;
};

// Búsqueda para atender al comprador que escribe "pagué y no me llegó nada":
// por nombre, correo, teléfono o referencia, en cualquier estado.
export async function buscarTickets(consulta: string): Promise<{ ok: true; tickets: TicketBuscado[] } | { ok: false; error: string }> {
  const { user, error } = await requiereFinanzas();
  if (!user) return { ok: false, error: error! };

  const q = consulta.trim();
  if (q.length < 3) return { ok: false, error: "Escribe al menos 3 letras o números." };

  // Escapar los comodines de ilike para que "50%" no busque cualquier cosa.
  const patron = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;

  const service = createServiceClient();
  const { data, error: dbError } = await service
    .from("tickets")
    .select("id, comprador_nombre, comprador_email, comprador_telefono, tipo, precio, metodo_pago, referencia_pago, estado_pago, created_at, qr_enviado_en, qr_usado")
    .or(
      `comprador_nombre.ilike.${patron},comprador_email.ilike.${patron},comprador_telefono.ilike.${patron},referencia_pago.ilike.${patron}`
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (dbError) {
    console.error("Error buscando tickets:", dbError.message);
    return { ok: false, error: "No se pudo buscar. Intenta de nuevo." };
  }

  return {
    ok: true,
    tickets: (data ?? []).map((t) => ({
      id: t.id as string,
      compradorNombre: t.comprador_nombre as string,
      compradorEmail: (t.comprador_email as string | null) ?? null,
      compradorTelefono: t.comprador_telefono as string,
      tipo: t.tipo as "vip" | "general",
      precio: Number(t.precio),
      metodoPago: t.metodo_pago as string,
      referenciaPago: (t.referencia_pago as string | null) ?? null,
      estadoPago: t.estado_pago as "pendiente" | "verificado" | "rechazado",
      creadoEn: t.created_at as string,
      qrEnviadoEn: (t.qr_enviado_en as string | null) ?? null,
      qrUsado: Boolean(t.qr_usado),
    })),
  };
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
