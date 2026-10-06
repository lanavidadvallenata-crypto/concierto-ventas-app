"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { registrarVentaInterna } from "@/lib/registrar-venta";
import { enviarCorreoQR, type EntradaQR } from "@/lib/enviar-qr";
import { obtenerAsiento } from "@/lib/asiento";
import { generarTokenQR } from "@/lib/qr";
import { buscarPaquete, type Paquete } from "@/lib/patrocinios";
import { validarReferencia, normalizarReferencia } from "@/lib/pagos";

export type ResultadoPatrocinio = { ok: true; aviso?: string } | { ok: false; error: string };

// Solo admin. Se verifica en el servidor: ocultar la pestaña no es seguridad.
async function requiereAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, error: "Tu sesión expiró — vuelve a entrar." };

  const service = createServiceClient();
  const { data: perfil } = await service.from("perfiles").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.activo || perfil.rol !== "admin") {
    return { user: null, error: "Solo un administrador puede gestionar patrocinios." };
  }
  return { user, error: null };
}

const esquema = z.object({
  paquete: z.enum(["aliado", "oficial"]),
  empresa: z.string().trim().min(2, "Escribe el nombre de la empresa o marca."),
  contactoNombre: z.string().trim().min(2, "Escribe el nombre del contacto."),
  contactoTelefono: z.string().trim().optional(),
  contactoEmail: z.string().trim().toLowerCase().email("Correo inválido — ahí llegan las entradas con QR."),
  montoUsd: z.coerce.number().positive("El monto debe ser mayor a 0."),
  metodoPago: z.enum(["pago_movil", "transferencia", "zelle", "binance", "efectivo_usd", "efectivo_bs"]),
  referenciaPago: z.string().trim().min(1, "Escribe el dato del pago recibido."),
  sillaIds: z.string().optional(), // JSON de uuids (solo paquete oficial)
  notas: z.string().trim().optional(),
});

function revalidar() {
  revalidatePath("/patrocinantes");
  revalidatePath("/dashboard");
  revalidatePath("/ventas");
}

export async function registrarPatrocinio(formData: FormData): Promise<ResultadoPatrocinio> {
  const { user, error: authError } = await requiereAdmin();
  if (!user) return { ok: false, error: authError! };

  const parsed = esquema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  const paquete = buscarPaquete(d.paquete as Paquete);

  const errorReferencia = validarReferencia(d.metodoPago, d.referenciaPago);
  if (errorReferencia) return { ok: false, error: errorReferencia };
  const referencia = normalizarReferencia(d.metodoPago, d.referenciaPago);

  let sillaIds: string[] = [];
  if (paquete.tipo === "vip") {
    try {
      sillaIds = JSON.parse(d.sillaIds || "[]");
    } catch {
      sillaIds = [];
    }
    if (sillaIds.length !== paquete.entradas) {
      return { ok: false, error: `Elige exactamente ${paquete.entradas} sillas en el mapa para este paquete.` };
    }
  }

  const service = createServiceClient();

  // Las entradas del patrocinio se emiten como tickets normales: ocupan silla
  // VIP real y descuentan del cupo general. Precio 0 (cortesía) y etapa
  // regular, para no consumir el cupo de preventa.
  const venta = await registrarVentaInterna(service, {
    tipo: paquete.tipo,
    sillaIds,
    cantidad: paquete.entradas,
    compradorNombre: `${d.empresa} — ${d.contactoNombre}`,
    compradorTelefono: d.contactoTelefono || "",
    compradorEmail: d.contactoEmail,
    metodoPago: d.metodoPago,
    referenciaPago: referencia,
    precioTotalManual: null,
    etapaForzada: "regular",
    vendidoPor: user.id,
    canal: "patrocinio",
    verificarDeInmediato: true,
    cortesia: true,
  });

  if (!venta.ok) return { ok: false, error: venta.error };

  // Registro del patrocinio (el dinero vive aquí, no en boletería).
  const { error: errorPatro } = await service.from("patrocinantes").insert({
    empresa: d.empresa,
    contacto_nombre: d.contactoNombre,
    contacto_telefono: d.contactoTelefono || null,
    contacto_email: d.contactoEmail,
    paquete: d.paquete,
    monto_usd: d.montoUsd,
    metodo_pago: d.metodoPago,
    referencia_pago: referencia,
    grupo_id: venta.grupoId,
    notas: d.notas || null,
    creado_por: user.id,
  });

  if (errorPatro) {
    console.error("Error guardando patrocinante:", errorPatro.message);
    // Las entradas ya se emitieron: no se revierten en silencio (ocupan aforo
    // real). Se avisa para que el admin anule desde la lista si hace falta.
    revalidar();
    return {
      ok: false,
      error: "Las entradas se emitieron, pero no se pudo guardar la ficha del patrocinante. Anótalo y avísame para revisarlo.",
    };
  }

  // QR a los invitados del patrocinante: mismo correo que cualquier compra.
  const { data: tickets } = await service
    .from("tickets")
    .select("id, tipo, silla_id")
    .eq("grupo_id", venta.grupoId);

  const entradas: EntradaQR[] = [];
  for (const t of tickets ?? []) {
    const qrToken = generarTokenQR();
    await service.from("tickets").update({ qr_token: qrToken }).eq("id", t.id);
    const asiento = t.tipo === "vip" ? await obtenerAsiento(service, t.silla_id) : null;
    entradas.push({
      qrToken,
      tipo: t.tipo as "vip" | "general",
      fila: asiento?.fila ?? null,
      mesaNumero: asiento?.mesaNumero ?? null,
      sillaNumero: asiento?.sillaNumero ?? null,
    });
  }

  revalidar();

  try {
    await enviarCorreoQR({
      destinatario: d.contactoEmail,
      nombreComprador: d.contactoNombre,
      entradas,
      grupoId: venta.grupoId,
    });
    await service
      .from("tickets")
      .update({ qr_enviado_en: new Date().toISOString() })
      .eq("grupo_id", venta.grupoId);
  } catch (e) {
    console.error("Error enviando QR de patrocinio:", (e as Error).message);
    return {
      ok: true,
      aviso: `Patrocinio registrado y ${paquete.entradas} entradas reservadas, pero el correo a ${d.contactoEmail} no salió. Reenvíalo desde Finanzas buscando "${d.empresa}".`,
    };
  }

  return {
    ok: true,
    aviso: `Patrocinio de ${d.empresa} registrado. ${paquete.entradas} ${paquete.tipo === "vip" ? "entradas VIP" : "entradas generales"} enviadas a ${d.contactoEmail}.`,
  };
}

export async function anularPatrocinio(formData: FormData): Promise<ResultadoPatrocinio> {
  const { user, error: authError } = await requiereAdmin();
  if (!user) return { ok: false, error: authError! };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Falta el patrocinio a anular." };

  const service = createServiceClient();
  const { data: patro } = await service
    .from("patrocinantes")
    .select("id, empresa, grupo_id, anulado_en")
    .eq("id", id)
    .maybeSingle();

  if (!patro) return { ok: false, error: "No se encontró ese patrocinio." };
  if (patro.anulado_en) return { ok: false, error: "Ese patrocinio ya está anulado." };

  if (patro.grupo_id) {
    const { data: tickets } = await service
      .from("tickets")
      .select("id, silla_id")
      .eq("grupo_id", patro.grupo_id)
      .neq("estado_pago", "rechazado");

    const sillas = (tickets ?? []).map((t) => t.silla_id).filter((s): s is string => !!s);

    await service
      .from("tickets")
      .update({ estado_pago: "rechazado", verificado_por: user.id, verificado_en: new Date().toISOString() })
      .eq("grupo_id", patro.grupo_id);

    if (sillas.length) {
      await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).in("id", sillas);
    }
  }

  await service
    .from("patrocinantes")
    .update({ anulado_en: new Date().toISOString(), anulado_por: user.id })
    .eq("id", id);

  revalidar();
  return { ok: true, aviso: `Patrocinio de ${patro.empresa} anulado. Las entradas quedaron sin efecto y las sillas liberadas.` };
}

// ===========================================================================
// CORTESÍAS — entradas que ocupan aforo pero NO son dinero ni patrocinio.
// Canje, sorteo, prensa, staff, invitación. Precio 0, canal 'cortesia' y
// método 'cortesia': así no entran a recaudación ni a la tabla de
// patrocinantes, pero sí descuentan cupo real y salen con su QR.
// ===========================================================================

const esquemaCortesia = z.object({
  beneficiario: z.string().trim().min(2, "Escribe a nombre de quién va la cortesía."),
  motivo: z.enum(["canje", "sorteo", "prensa", "staff", "invitacion", "otro"]),
  detalle: z.string().trim().optional(),
  contactoEmail: z.string().trim().toLowerCase().email("Correo inválido — ahí llegan las entradas con QR."),
  contactoTelefono: z.string().trim().optional(),
  cantidadVip: z.coerce.number().int().min(0).max(10),
  cantidadGeneral: z.coerce.number().int().min(0).max(20),
  sillaIds: z.string().optional(), // JSON de uuids, solo si hay VIP
  notas: z.string().trim().optional(),
});

export async function registrarCortesia(formData: FormData): Promise<ResultadoPatrocinio> {
  const { user, error: authError } = await requiereAdmin();
  if (!user) return { ok: false, error: authError! };

  const parsed = esquemaCortesia.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  if (d.cantidadVip + d.cantidadGeneral < 1) {
    return { ok: false, error: "Indica al menos una entrada, VIP o general." };
  }

  let sillaIds: string[] = [];
  if (d.cantidadVip > 0) {
    try {
      sillaIds = JSON.parse(d.sillaIds || "[]");
    } catch {
      sillaIds = [];
    }
    if (sillaIds.length !== d.cantidadVip) {
      return { ok: false, error: `Elige exactamente ${d.cantidadVip} silla${d.cantidadVip === 1 ? "" : "s"} en el mapa.` };
    }
  }

  const service = createServiceClient();
  const nombre = `${d.beneficiario} — cortesía`;
  const grupos: string[] = [];
  const entradas: EntradaQR[] = [];

  // Una cortesía mixta emite dos grupos: uno VIP y uno general. Se registran en
  // orden y, si el segundo falla, el primero queda emitido y se avisa — no se
  // revierte en silencio porque ya ocupa aforo.
  const lotes: { tipo: "vip" | "general"; cantidad: number; sillas: string[] }[] = [];
  if (d.cantidadVip > 0) lotes.push({ tipo: "vip", cantidad: d.cantidadVip, sillas: sillaIds });
  if (d.cantidadGeneral > 0) lotes.push({ tipo: "general", cantidad: d.cantidadGeneral, sillas: [] });

  for (const lote of lotes) {
    const venta = await registrarVentaInterna(service, {
      tipo: lote.tipo,
      sillaIds: lote.sillas,
      cantidad: lote.cantidad,
      compradorNombre: nombre,
      compradorTelefono: d.contactoTelefono || "",
      compradorEmail: d.contactoEmail,
      metodoPago: "cortesia",
      referenciaPago: d.detalle || null,
      precioTotalManual: null,
      etapaForzada: "regular",
      vendidoPor: user.id,
      canal: "cortesia",
      verificarDeInmediato: true,
      cortesia: true,
    });
    if (!venta.ok) {
      if (grupos.length > 0) {
        revalidar();
        return {
          ok: false,
          error: `Se emitieron las entradas VIP pero las generales fallaron (${venta.error}). Anula la cortesía desde la lista y vuelve a registrarla completa.`,
        };
      }
      return { ok: false, error: venta.error };
    }
    grupos.push(venta.grupoId);
  }

  const { error: errorCortesia } = await service.from("cortesias").insert({
    beneficiario: d.beneficiario,
    motivo: d.motivo,
    detalle: d.detalle || null,
    contacto_email: d.contactoEmail,
    contacto_telefono: d.contactoTelefono || null,
    cantidad_vip: d.cantidadVip,
    cantidad_general: d.cantidadGeneral,
    grupos,
    notas: d.notas || null,
    creado_por: user.id,
  });

  if (errorCortesia) {
    console.error("Error guardando cortesía:", errorCortesia.message);
    revalidar();
    return {
      ok: false,
      error: "Las entradas se emitieron, pero no se pudo guardar la ficha de la cortesía. Anótalo y avísame para revisarlo.",
    };
  }

  // Un solo correo con todas las entradas, VIP y generales juntas.
  for (const grupoId of grupos) {
    const { data: tickets } = await service.from("tickets").select("id, tipo, silla_id").eq("grupo_id", grupoId);
    for (const t of tickets ?? []) {
      const qrToken = generarTokenQR();
      await service.from("tickets").update({ qr_token: qrToken }).eq("id", t.id);
      const asiento = t.tipo === "vip" ? await obtenerAsiento(service, t.silla_id) : null;
      entradas.push({
        qrToken,
        tipo: t.tipo as "vip" | "general",
        fila: asiento?.fila ?? null,
        mesaNumero: asiento?.mesaNumero ?? null,
        sillaNumero: asiento?.sillaNumero ?? null,
      });
    }
  }

  revalidar();

  const total = d.cantidadVip + d.cantidadGeneral;
  try {
    await enviarCorreoQR({
      destinatario: d.contactoEmail,
      nombreComprador: d.beneficiario,
      entradas,
      grupoId: grupos[0],
    });
    for (const grupoId of grupos) {
      await service.from("tickets").update({ qr_enviado_en: new Date().toISOString() }).eq("grupo_id", grupoId);
    }
  } catch (e) {
    console.error("Error enviando QR de cortesía:", (e as Error).message);
    return {
      ok: true,
      aviso: `Cortesía registrada y ${total} entrada${total === 1 ? "" : "s"} reservada${total === 1 ? "" : "s"}, pero el correo a ${d.contactoEmail} no salió. Reenvíalo desde Finanzas buscando "${d.beneficiario}".`,
    };
  }

  return {
    ok: true,
    aviso: `Cortesía para ${d.beneficiario} registrada. ${total} entrada${total === 1 ? "" : "s"} enviada${total === 1 ? "" : "s"} a ${d.contactoEmail}. No suma dinero a la recaudación.`,
  };
}

export async function anularCortesia(formData: FormData): Promise<ResultadoPatrocinio> {
  const { user, error: authError } = await requiereAdmin();
  if (!user) return { ok: false, error: authError! };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Falta la cortesía a anular." };

  const service = createServiceClient();
  const { data: cortesia } = await service
    .from("cortesias")
    .select("id, beneficiario, grupos, anulado_en")
    .eq("id", id)
    .maybeSingle();

  if (!cortesia) return { ok: false, error: "No se encontró esa cortesía." };
  if (cortesia.anulado_en) return { ok: false, error: "Esa cortesía ya está anulada." };

  for (const grupoId of (cortesia.grupos as string[] | null) ?? []) {
    const { data: tickets } = await service
      .from("tickets")
      .select("id, silla_id")
      .eq("grupo_id", grupoId)
      .neq("estado_pago", "rechazado");

    const sillas = (tickets ?? []).map((t) => t.silla_id).filter((s): s is string => !!s);

    await service
      .from("tickets")
      .update({ estado_pago: "rechazado", verificado_por: user.id, verificado_en: new Date().toISOString() })
      .eq("grupo_id", grupoId);

    if (sillas.length) {
      await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).in("id", sillas);
    }
  }

  await service.from("cortesias").update({ anulado_en: new Date().toISOString(), anulado_por: user.id }).eq("id", id);

  revalidar();
  return { ok: true, aviso: `Cortesía de ${cortesia.beneficiario} anulada. Las entradas quedaron sin efecto y el cupo liberado.` };
}
