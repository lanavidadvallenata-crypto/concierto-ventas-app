"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { anularPlan, leerPlanPorGrupo, reportarCuota, verificarCuota, type CanalReporte } from "@/lib/abona618";
import { enviarCorreoCuotaVerificada } from "@/lib/enviar-qr";
import { fechaCorta, graciaHasta, usd } from "@/lib/cuotas";
import { metodoEsEnBs, normalizarReferencia, validarReferencia } from "@/lib/pagos";
import { generarTokenQR } from "@/lib/qr";
import { enviarCorreoQR } from "@/lib/enviar-qr";
import { obtenerAsiento } from "@/lib/asiento";

type Resultado = { ok: true; aviso?: string } | { ok: false; error: string };

// Ventas registra, Finanzas aprueba (Anita, 12 oct). Las dos acciones piden
// rol, y la de aprobar además exige que no sea la misma persona que registró:
// es el mismo control cruzado que ya tienen las ventas manuales.
async function requiereEquipo(rolesPermitidos: string[]) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, rol: null, error: "Tu sesión expiró — vuelve a entrar." };

  const service = createServiceClient();
  const { data: perfil } = await service.from("perfiles").select("rol, activo, nombre").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.activo || !rolesPermitidos.includes(perfil.rol as string)) {
    return { user: null, rol: null, error: "No tienes permiso para esta acción." };
  }
  return { user, rol: perfil.rol as string, error: null };
}

function revalidar() {
  revalidatePath("/cobranza");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

const registrarSchema = z.object({
  cuotaId: z.string().uuid(),
  grupoId: z.string().uuid(),
  metodoPago: z.enum(["pago_movil", "transferencia", "zelle", "binance", "efectivo_usd", "efectivo_bs"]),
  referenciaPago: z.string().trim().min(1, "Escribe la referencia del pago."),
  canal: z.enum(["whatsapp", "llamada", "presencial", "otro"]),
  montoBs: z.coerce.number().positive().optional(),
  nota: z.string().trim().max(500).optional(),
});

/**
 * Ventas anota el pago que le llegó. NO lo da por cobrado: queda reportado
 * esperando a que Finanzas lo vea en el banco. Es el paso que faltaba para
 * que el cobro sea un proceso acompañado y no dependa de que el comprador
 * se acuerde de reportar por su cuenta.
 */
export async function registrarPagoDeCuota(input: unknown): Promise<Resultado> {
  const { user, error } = await requiereEquipo(["ventas", "finanzas", "admin"]);
  if (!user) return { ok: false, error: error! };

  const parsed = registrarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  const v = parsed.data;

  const errorRef = validarReferencia(v.metodoPago, v.referenciaPago);
  if (errorRef) return { ok: false, error: errorRef };
  const referencia = normalizarReferencia(v.metodoPago, v.referenciaPago);

  if (metodoEsEnBs(v.metodoPago) && v.montoBs == null) {
    return { ok: false, error: "Ese método es en bolívares: escribe el monto exacto en Bs que te mostró el comprobante." };
  }

  const service = createServiceClient();
  const r = await reportarCuota(service, {
    cuotaId: v.cuotaId,
    grupoId: v.grupoId,
    metodoPago: v.metodoPago,
    referenciaPago: referencia,
    montoBs: v.montoBs ?? null,
    tasa: null,
    reportadoPor: user.id,
    canal: v.canal as CanalReporte,
    nota: v.nota ?? null,
  });
  if (!r.ok) return { ok: false, error: r.error };

  revalidar();
  return {
    ok: true,
    aviso: "Pago anotado. Pasa a la cola de Finanzas para que lo confirmen en el banco — todavía no está cobrado.",
  };
}

/**
 * Finanzas confirma que el dinero entró. Si con esa cuota el plan queda
 * completo, la compra sigue el camino normal: tickets a verificado, QR y
 * correo. Si no, sale el correo de cuota recibida y no se entrega nada.
 */
export async function aprobarCuota(cuotaId: string): Promise<Resultado> {
  const { user, rol, error } = await requiereEquipo(["finanzas", "admin"]);
  if (!user) return { ok: false, error: error! };

  const service = createServiceClient();

  const { data: cuotaFila } = await service
    .from("cuotas")
    .select("id, plan_id, reportado_por, reportado_en")
    .eq("id", cuotaId)
    .maybeSingle();
  if (!cuotaFila) return { ok: false, error: "No encontramos esa cuota." };
  if (!cuotaFila.reportado_en) {
    return { ok: false, error: "Nadie ha anotado este pago todavía. Regístralo primero con la referencia." };
  }
  // Control cruzado: quien anotó el pago no lo aprueba. El admin sí puede.
  if (cuotaFila.reportado_por === user.id && rol !== "admin") {
    return {
      ok: false,
      error: "Este pago lo anotaste tú. Por control cruzado lo tiene que aprobar otra persona de Finanzas o un admin.",
    };
  }

  const { data: planFila } = await service.from("planes_pago").select("grupo_id").eq("id", cuotaFila.plan_id).maybeSingle();
  const grupoId = planFila ? String(planFila.grupo_id) : null;
  if (!grupoId) return { ok: false, error: "Esa cuota no tiene una compra asociada. Revísala a mano." };

  const r = await verificarCuota(service, { cuotaId, verificadoPor: user.id });
  if (!r.ok) return { ok: false, error: r.error };

  const { data: tickets } = await service
    .from("tickets")
    .select("id, tipo, silla_id, comprador_nombre, comprador_email, estado_pago, qr_token")
    .eq("grupo_id", grupoId);
  const lista = tickets ?? [];
  const primero = lista[0];

  if (!r.completo) {
    revalidar();
    let aviso =
      `${r.cuota.etiqueta} aprobada: ${usd(r.cuota.montoUsd)}. Lleva ${usd(r.plan.pagado)} de ` +
      `${usd(r.plan.totalUsd)} y le falta ${usd(r.plan.saldo)}. No se entregó ningún QR.`;

    if (r.yaEstaba) return { ok: true, aviso: `Esa cuota ya estaba aprobada. ${aviso}` };

    const correo = primero?.comprador_email as string | null | undefined;
    if (correo) {
      try {
        await enviarCorreoCuotaVerificada({
          destinatario: correo,
          nombreComprador: String(primero.comprador_nombre),
          grupoId,
          etiquetaCuota: r.cuota.etiqueta,
          montoVerificado: r.cuota.montoUsd,
          totalUsd: r.plan.totalUsd,
          pagado: r.plan.pagado,
          saldo: r.plan.saldo,
          pendientes: r.plan.cuotas
            .filter((c) => !c.verificadoEn)
            .map((c) => ({ etiqueta: c.etiqueta, monto: c.montoUsd, venceEl: fechaCorta(c.venceEl) })),
          proximoPlazo: r.plan.proxima ? fechaCorta(graciaHasta(r.plan.proxima.venceEl)) : null,
        });
      } catch (e) {
        console.error("Error enviando correo de cuota verificada:", (e as Error).message);
        aviso += ` El correo a ${correo} no salió — avísale por WhatsApp.`;
      }
    } else {
      aviso += " Esta compra no tiene correo: avísale por WhatsApp.";
    }
    return { ok: true, aviso };
  }

  // Plan completo: ahora sí se entregan las entradas.
  const ahora = new Date().toISOString();
  const verificados: { id: string; tipo: string; silla_id: string | null; qr_token: string }[] = [];
  for (const t of lista) {
    if (t.estado_pago !== "pendiente") continue;
    const qrToken = generarTokenQR();
    const { data: ok } = await service
      .from("tickets")
      .update({ estado_pago: "verificado", verificado_por: user.id, verificado_en: ahora, qr_token: qrToken })
      .eq("id", t.id)
      .eq("estado_pago", "pendiente")
      .select("id")
      .maybeSingle();
    if (!ok) continue;
    verificados.push({ id: String(t.id), tipo: String(t.tipo), silla_id: (t.silla_id as string | null) ?? null, qr_token: qrToken });
    if (t.tipo === "vip" && t.silla_id) {
      await service.from("sillas_vip").update({ estado: "vendida", reservado_hasta: null }).eq("id", t.silla_id);
    }
  }

  revalidar();

  if (verificados.length === 0) {
    return { ok: true, aviso: "Plan completado, pero las entradas ya estaban procesadas. Revisa que los QR hayan salido." };
  }

  const correo = primero?.comprador_email as string | null | undefined;
  if (!correo) {
    return { ok: true, aviso: "Plan completado y entradas liberadas, pero esta compra no tiene correo: no hay a dónde mandar los QR." };
  }

  const entradas = [];
  for (const t of verificados) {
    const asiento = t.tipo === "vip" ? await obtenerAsiento(service, t.silla_id) : null;
    entradas.push({
      qrToken: t.qr_token,
      tipo: t.tipo as "vip" | "general",
      fila: asiento?.fila ?? null,
      mesaNumero: asiento?.mesaNumero ?? null,
      sillaNumero: asiento?.sillaNumero ?? null,
    });
  }

  try {
    await enviarCorreoQR({ destinatario: correo, nombreComprador: String(primero.comprador_nombre), entradas, grupoId });
    await service.from("tickets").update({ qr_enviado_en: new Date().toISOString() }).in("id", verificados.map((t) => t.id));
  } catch (e) {
    console.error("Error enviando QR al completar el plan:", (e as Error).message);
    return {
      ok: true,
      aviso: `¡Plan completado! Pero el correo con ${entradas.length > 1 ? "los QR" : "el QR"} a ${correo} no salió. Búscalo en Finanzas y usa "Reenviar QR".`,
    };
  }

  return {
    ok: true,
    aviso: `¡Plan completado! ${entradas.length > 1 ? `${entradas.length} QR enviados` : "QR enviado"} a ${correo}.`,
  };
}

/**
 * Anular por falta de pago: se pasó el plazo de gracia, la entrada vuelve al
 * inventario y lo abonado no se devuelve. Mientras no exista el cron, esto se
 * hace a mano desde la pantalla de cobranza.
 */
export async function anularPorFaltaDePago(grupoId: string): Promise<Resultado> {
  const { user, error } = await requiereEquipo(["finanzas", "admin"]);
  if (!user) return { ok: false, error: error! };

  const service = createServiceClient();
  const plan = await leerPlanPorGrupo(service, grupoId);
  if (!plan) return { ok: false, error: "No encontramos el plan de esa compra." };
  if (plan.saldo <= 0) return { ok: false, error: "Ese plan está pagado completo: no se puede anular por falta de pago." };

  const r = await anularPlan(service, {
    grupoId,
    por: user.id,
    motivo: "vencido",
    nota: `Anulado por falta de pago. Quedaron ${usd(plan.pagado)} abonados que no se devuelven.`,
  });
  if (!r.anulado) return { ok: false, error: "Ese plan ya estaba anulado o vencido." };

  // Las entradas vuelven al inventario: se rechazan y se liberan las sillas.
  const { data: tickets } = await service.from("tickets").select("id, tipo, silla_id, estado_pago").eq("grupo_id", grupoId);
  let liberadas = 0;
  for (const t of tickets ?? []) {
    if (t.estado_pago !== "pendiente") continue;
    const { data: ok } = await service
      .from("tickets")
      .update({ estado_pago: "rechazado" })
      .eq("id", t.id)
      .eq("estado_pago", "pendiente")
      .select("id")
      .maybeSingle();
    if (!ok) continue;
    liberadas++;
    if (t.tipo === "vip" && t.silla_id) {
      await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).eq("id", t.silla_id);
    }
  }

  revalidar();
  return {
    ok: true,
    aviso:
      `Plan anulado. ${liberadas} entrada${liberadas === 1 ? "" : "s"} de vuelta a la venta. ` +
      `Quedaron ${usd(plan.pagado)} abonados que, según las condiciones, no se devuelven. Avísale por WhatsApp.`,
  };
}
