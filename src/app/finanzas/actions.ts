"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generarTokenQR } from "@/lib/qr";
import { enviarCorreoQR, enviarCorreoRechazo, type EntradaQR } from "@/lib/enviar-qr";
import { guardarTasaManual } from "@/lib/tasa";
import { obtenerAsiento } from "@/lib/asiento";
import { ETIQUETA_METODO } from "@/lib/formato";

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

type TicketGrupo = {
  id: string;
  grupo_id: string | null;
  vendido_por: string | null;
  tipo: "vip" | "general";
  silla_id: string | null;
  comprador_nombre: string;
  comprador_email: string | null;
  estado_pago: string;
  precio: number;
  precio_bs: number | null;
  metodo_pago: string;
  referencia_pago: string | null;
  qr_token: string | null;
  qr_usado: boolean;
};

const CAMPOS_GRUPO =
  "id, grupo_id, vendido_por, tipo, silla_id, comprador_nombre, comprador_email, estado_pago, precio, precio_bs, metodo_pago, referencia_pago, qr_token, qr_usado";

// Trae todos los tickets de la misma compra que el ticket dado. Los tickets
// viejos (antes de la compra múltiple) tienen grupo_id = su propio id, así
// que el grupo es de uno.
async function obtenerGrupo(ticketId: string): Promise<{ tickets: TicketGrupo[] } | { error: string }> {
  const service = createServiceClient();
  const { data: base, error: baseError } = await service
    .from("tickets")
    .select("id, grupo_id")
    .eq("id", ticketId)
    .maybeSingle();

  if (baseError) {
    console.error("Error leyendo ticket:", baseError.message);
    return { error: `No se pudo leer el ticket (${baseError.message}). Intenta de nuevo.` };
  }
  if (!base) return { error: "No se encontró ese ticket." };

  const grupoId = (base.grupo_id as string | null) ?? base.id;
  const { data, error } = await service
    .from("tickets")
    .select(CAMPOS_GRUPO)
    .or(`grupo_id.eq.${grupoId},id.eq.${grupoId}`)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error leyendo grupo de tickets:", error.message);
    return { error: `No se pudo leer la compra (${error.message}). Intenta de nuevo.` };
  }
  const tickets = (data ?? []).map((t) => ({ ...t, precio: Number(t.precio), precio_bs: t.precio_bs == null ? null : Number(t.precio_bs) })) as TicketGrupo[];
  if (tickets.length === 0) return { error: "No se encontró ese ticket." };
  return { tickets };
}

async function entradasParaCorreo(tickets: { tipo: string; silla_id: string | null; qr_token: string | null }[]): Promise<EntradaQR[]> {
  const service = createServiceClient();
  const entradas: EntradaQR[] = [];
  for (const t of tickets) {
    if (!t.qr_token) continue;
    const asiento = t.tipo === "vip" ? await obtenerAsiento(service, t.silla_id) : null;
    entradas.push({
      qrToken: t.qr_token,
      tipo: t.tipo as "vip" | "general",
      fila: asiento?.fila ?? null,
      mesaNumero: asiento?.mesaNumero ?? null,
      sillaNumero: asiento?.sillaNumero ?? null,
    });
  }
  return entradas;
}

function revalidarTodo() {
  revalidatePath("/finanzas");
  revalidatePath("/ventas");
  revalidatePath("/dashboard");
  revalidatePath("/comprar");
}

// Verifica TODA la compra (todos los tickets pendientes del grupo): genera un
// QR por ticket y manda un solo correo con todos.
export async function verificarPago(ticketId: string): Promise<Resultado> {
  const { user, rol, error } = await requiereFinanzas();
  if (!user) return { ok: false, error: error! };

  const grupo = await obtenerGrupo(ticketId);
  if ("error" in grupo) return { ok: false, error: grupo.error };

  const pendientes = grupo.tickets.filter((t) => t.estado_pago === "pendiente");
  if (pendientes.length === 0) return { ok: false, error: "Esa compra ya fue procesada." };

  // Control cruzado anti-fraude: quien vende no verifica su propia venta.
  // Aplica al rol "finanzas". El rol "admin" (la dueña del sistema) SÍ puede.
  if (pendientes.some((t) => t.vendido_por === user.id) && rol !== "admin") {
    return {
      ok: false,
      error: "Esta venta la registraste tú. Por control cruzado, la tiene que verificar otra persona de Finanzas o un admin.",
    };
  }

  const service = createServiceClient();
  const ahora = new Date().toISOString();
  const verificados: TicketGrupo[] = [];

  for (const t of pendientes) {
    const qrToken = generarTokenQR();
    // UPDATE atómico por ticket: solo aplica si sigue "pendiente" en este instante.
    const { data: actualizado, error: updateError } = await service
      .from("tickets")
      .update({ estado_pago: "verificado", verificado_por: user.id, verificado_en: ahora, qr_token: qrToken })
      .eq("id", t.id)
      .eq("estado_pago", "pendiente")
      .select("id")
      .maybeSingle();
    if (updateError || !actualizado) continue; // otra persona lo procesó justo ahora
    verificados.push({ ...t, qr_token: qrToken });
    if (t.tipo === "vip" && t.silla_id) {
      await service.from("sillas_vip").update({ estado: "vendida", reservado_hasta: null }).eq("id", t.silla_id);
    }
  }

  revalidarTodo();

  if (verificados.length === 0) return { ok: false, error: "Esa compra ya fue procesada por otra persona." };

  const primero = verificados[0];
  if (!primero.comprador_email) {
    return { ok: true, aviso: "Pago verificado, pero esta compra no tiene correo — no hay a dónde mandar el QR." };
  }

  const entradas = await entradasParaCorreo(verificados);
  try {
    await enviarCorreoQR({ destinatario: primero.comprador_email, nombreComprador: primero.comprador_nombre, entradas });
    await service
      .from("tickets")
      .update({ qr_enviado_en: new Date().toISOString() })
      .in("id", verificados.map((t) => t.id));
  } catch (e) {
    console.error("Error enviando QR:", (e as Error).message);
    // El pago YA quedó verificado (y salió de pendientes).
    return {
      ok: true,
      aviso: `Pago verificado, pero el correo con ${entradas.length > 1 ? "los QR" : "el QR"} a ${primero.comprador_email} no salió. Búscalo abajo y usa "Reenviar QR".`,
    };
  }

  return { ok: true };
}

// Rechaza TODA la compra, libera las sillas y avisa al comprador por correo
// con botón de WhatsApp para mandar el comprobante.
export async function rechazarPago(ticketId: string): Promise<Resultado> {
  const { user, error } = await requiereFinanzas();
  if (!user) return { ok: false, error: error! };

  const grupo = await obtenerGrupo(ticketId);
  if ("error" in grupo) return { ok: false, error: grupo.error };

  const pendientes = grupo.tickets.filter((t) => t.estado_pago === "pendiente");
  if (pendientes.length === 0) return { ok: false, error: "Esa compra ya fue procesada." };

  const service = createServiceClient();
  const ahora = new Date().toISOString();
  const rechazados: TicketGrupo[] = [];

  for (const t of pendientes) {
    const { data: actualizado, error: updateError } = await service
      .from("tickets")
      .update({ estado_pago: "rechazado", verificado_por: user.id, verificado_en: ahora })
      .eq("id", t.id)
      .eq("estado_pago", "pendiente")
      .select("id")
      .maybeSingle();
    if (updateError || !actualizado) continue;
    rechazados.push(t);
    if (t.tipo === "vip" && t.silla_id) {
      await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).eq("id", t.silla_id);
    }
  }

  revalidarTodo();

  if (rechazados.length === 0) return { ok: false, error: "Esa compra ya fue procesada por otra persona." };

  const primero = rechazados[0];
  if (!primero.comprador_email) return { ok: true, aviso: "Pago rechazado. Esta compra no tiene correo, no se avisó al comprador." };

  const totalUsd = rechazados.reduce((s, t) => s + t.precio, 0);
  const totalBs = rechazados.every((t) => t.precio_bs != null) ? rechazados.reduce((s, t) => s + (t.precio_bs ?? 0), 0) : null;
  try {
    await enviarCorreoRechazo({
      destinatario: primero.comprador_email,
      nombreComprador: primero.comprador_nombre,
      cantidad: rechazados.length,
      tipo: primero.tipo,
      totalUsd: Math.round(totalUsd * 100) / 100,
      totalBs: totalBs == null ? null : Math.round(totalBs * 100) / 100,
      referencia: primero.referencia_pago,
      metodoEtiqueta: ETIQUETA_METODO[primero.metodo_pago] ?? primero.metodo_pago,
    });
  } catch (e) {
    console.error("Error enviando correo de rechazo:", (e as Error).message);
    return { ok: true, aviso: `Pago rechazado, pero el correo de aviso a ${primero.comprador_email} no salió. Avísale por WhatsApp.` };
  }

  return { ok: true };
}

// Vuelve una compra rechazada a "pendiente" (el comprador mandó el
// comprobante). Si era VIP, intenta volver a reservar las mismas sillas; si
// alguna ya la tomó otra persona, no se reabre y se explica cuál.
export async function reabrirPago(ticketId: string): Promise<Resultado> {
  const { user, error } = await requiereFinanzas();
  if (!user) return { ok: false, error: error! };

  const grupo = await obtenerGrupo(ticketId);
  if ("error" in grupo) return { ok: false, error: grupo.error };

  const rechazados = grupo.tickets.filter((t) => t.estado_pago === "rechazado");
  if (rechazados.length === 0) return { ok: false, error: "Solo se puede reabrir una compra rechazada." };

  const service = createServiceClient();

  // Sillas VIP: todas deben seguir disponibles.
  const sillaIds = rechazados.filter((t) => t.tipo === "vip" && t.silla_id).map((t) => t.silla_id!);
  if (sillaIds.length) {
    const { data: sillas } = await service.from("sillas_vip").select("id, estado, numero").in("id", sillaIds);
    const ocupadas = (sillas ?? []).filter((s) => s.estado !== "disponible");
    if (ocupadas.length) {
      return {
        ok: false,
        error: `No se puede reabrir: la silla ${ocupadas.map((s) => s.numero).join(", ")} ya la tomó otra persona. Registra una venta nueva con otra silla.`,
      };
    }
    const tomadas: string[] = [];
    for (const id of sillaIds) {
      const { data: silla } = await service
        .from("sillas_vip")
        .update({ estado: "reservada", reservado_hasta: null })
        .eq("id", id)
        .eq("estado", "disponible")
        .select("id")
        .maybeSingle();
      if (!silla) {
        if (tomadas.length) await service.from("sillas_vip").update({ estado: "disponible" }).in("id", tomadas);
        return { ok: false, error: "Una de las sillas se acaba de ocupar. Registra una venta nueva con otra silla." };
      }
      tomadas.push(silla.id);
    }
  }

  const { error: updateError } = await service
    .from("tickets")
    .update({ estado_pago: "pendiente", verificado_por: null, verificado_en: null })
    .in("id", rechazados.map((t) => t.id))
    .eq("estado_pago", "rechazado");

  if (updateError) {
    if (sillaIds.length) await service.from("sillas_vip").update({ estado: "disponible" }).in("id", sillaIds);
    return { ok: false, error: `No se pudo reabrir (${updateError.message}).` };
  }

  revalidarTodo();
  return { ok: true, aviso: `Compra reabierta: ${rechazados.length} entrada${rechazados.length === 1 ? "" : "s"} de vuelta en pendientes.` };
}

// Reenvía el correo con los QR de una compra ya verificada (mismos tokens).
export async function reenviarQR(ticketId: string): Promise<Resultado> {
  const { user, error } = await requiereFinanzas();
  if (!user) return { ok: false, error: error! };

  const grupo = await obtenerGrupo(ticketId);
  if ("error" in grupo) return { ok: false, error: grupo.error };

  const verificados = grupo.tickets.filter((t) => t.estado_pago === "verificado" && t.qr_token && !t.qr_usado);
  if (verificados.length === 0) {
    return { ok: false, error: "No hay entradas verificadas sin usar en esta compra para reenviar." };
  }
  const primero = verificados[0];
  if (!primero.comprador_email) return { ok: false, error: "Esta compra no tiene correo." };

  const entradas = await entradasParaCorreo(verificados);
  try {
    await enviarCorreoQR({ destinatario: primero.comprador_email, nombreComprador: primero.comprador_nombre, entradas });
  } catch (e) {
    console.error("Error reenviando QR:", (e as Error).message);
    return { ok: false, error: "No se pudo enviar el correo. Revisa que el correo esté bien escrito e intenta de nuevo en un minuto." };
  }

  const service = createServiceClient();
  await service
    .from("tickets")
    .update({ qr_enviado_en: new Date().toISOString() })
    .in("id", verificados.map((t) => t.id));
  return { ok: true, aviso: `${entradas.length > 1 ? `${entradas.length} QR reenviados` : "QR reenviado"} a ${primero.comprador_email}.` };
}

export type TicketBuscado = {
  id: string;
  grupoId: string;
  compradorNombre: string;
  compradorEmail: string | null;
  compradorTelefono: string;
  tipo: "vip" | "general";
  cantidad: number;
  precio: number;
  precioBs: number | null;
  metodoPago: string;
  referenciaPago: string | null;
  estadoPago: "pendiente" | "verificado" | "rechazado";
  canal: string;
  creadoEn: string;
  qrEnviadoEn: string | null;
  qrUsados: number;
};

// Búsqueda para atender al comprador que escribe "pagué y no me llegó nada":
// por nombre, correo, teléfono o referencia, en cualquier estado. Devuelve
// una fila por COMPRA (grupo), con la cantidad de entradas.
export async function buscarTickets(consulta: string): Promise<{ ok: true; tickets: TicketBuscado[] } | { ok: false; error: string }> {
  const { user, error } = await requiereFinanzas();
  if (!user) return { ok: false, error: error! };

  const q = consulta.trim();
  if (q.length < 3) return { ok: false, error: "Escribe al menos 3 letras o números." };

  const patron = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;

  const service = createServiceClient();
  const { data, error: dbError } = await service
    .from("tickets")
    .select("id, grupo_id, comprador_nombre, comprador_email, comprador_telefono, tipo, precio, precio_bs, metodo_pago, referencia_pago, estado_pago, canal, created_at, qr_enviado_en, qr_usado")
    .or(
      `comprador_nombre.ilike.${patron},comprador_email.ilike.${patron},comprador_telefono.ilike.${patron},referencia_pago.ilike.${patron}`
    )
    .order("created_at", { ascending: false })
    .limit(60);

  if (dbError) {
    console.error("Error buscando tickets:", dbError.message);
    return { ok: false, error: "No se pudo buscar. Intenta de nuevo." };
  }

  // Agrupar por compra
  const grupos = new Map<string, TicketBuscado>();
  for (const t of data ?? []) {
    const gid = (t.grupo_id as string | null) ?? (t.id as string);
    const existente = grupos.get(gid);
    if (existente) {
      existente.cantidad += 1;
      existente.precio = Math.round((existente.precio + Number(t.precio)) * 100) / 100;
      if (existente.precioBs != null && t.precio_bs != null) existente.precioBs = Math.round((existente.precioBs + Number(t.precio_bs)) * 100) / 100;
      if (t.qr_usado) existente.qrUsados += 1;
      // Estado del grupo: si hay alguno pendiente, pendiente; si no, el del primero.
      if (t.estado_pago === "pendiente") existente.estadoPago = "pendiente";
      continue;
    }
    grupos.set(gid, {
      id: t.id as string,
      grupoId: gid,
      compradorNombre: t.comprador_nombre as string,
      compradorEmail: (t.comprador_email as string | null) ?? null,
      compradorTelefono: t.comprador_telefono as string,
      tipo: t.tipo as "vip" | "general",
      cantidad: 1,
      precio: Number(t.precio),
      precioBs: t.precio_bs == null ? null : Number(t.precio_bs),
      metodoPago: t.metodo_pago as string,
      referenciaPago: (t.referencia_pago as string | null) ?? null,
      estadoPago: t.estado_pago as "pendiente" | "verificado" | "rechazado",
      canal: (t.canal as string) ?? "web",
      creadoEn: t.created_at as string,
      qrEnviadoEn: (t.qr_enviado_en as string | null) ?? null,
      qrUsados: t.qr_usado ? 1 : 0,
    });
  }

  return { ok: true, tickets: [...grupos.values()].slice(0, 20) };
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
