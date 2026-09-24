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
