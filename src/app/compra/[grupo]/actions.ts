"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { leerPlanPorGrupo, reportarCuota } from "@/lib/abona618";
import { metodoEsEnBs, normalizarReferencia, validarReferencia } from "@/lib/pagos";
import { verificarLimite } from "@/lib/rate-limit";

const schema = z.object({
  grupoId: z.string().uuid(),
  cuotaId: z.string().uuid(),
  /** true = "pagué todo lo que me falta": el mismo pago cubre esta cuota y
   *  todas las siguientes. Las condiciones lo permiten ("puedes adelantar
   *  pagos o pagar el total cuando quieras") y sin esto quien pagaba el
   *  resto de un golpe solo podía avisar de una cuota, y el cron le
   *  reclamaba el resto como si no hubiera pagado. */
  cubreTodo: z.boolean().optional(),
  metodoPago: z.enum(["pago_movil", "transferencia", "zelle", "binance"]),
  referenciaPago: z.string().trim().min(1, "Escribe la referencia de tu pago."),
  montoBs: z.coerce.number().positive().optional(),
});

function repartirProporcional(total: number, pesos: number[]): number[] {
  const centavos = Math.round(total * 100);
  const partes = pesos.map((p) => Math.round(centavos * p));
  partes[partes.length - 1] += centavos - partes.reduce((s, x) => s + x, 0);
  return partes.map((c) => c / 100);
}

/**
 * El comprador avisa que pagó una cuota desde su propia página.
 *
 * El camino principal del cobro es el equipo (Anita, 12 oct): Ventas lo
 * acompaña por WhatsApp y anota el pago. Esto es para quien se adelanta y
 * quiere dejarlo registrado él mismo — no sustituye al seguimiento, lo
 * ahorra cuando el comprador es ordenado.
 *
 * No pide sesión: la llave es el grupo_id, un UUID aleatorio que no se puede
 * adivinar, igual que el resto de esta página. Lo que sí hace es comprobar
 * que la cuota pertenezca a esa compra, para que conocer un id suelto no
 * sirva de nada.
 */
export async function reportarMiPago(
  input: unknown
): Promise<{ ok: true; aviso: string } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  const v = parsed.data;

  const service = createServiceClient();

  const limite = await verificarLimite(service, "confirmar");
  if (!limite.ok) return { ok: false, error: limite.error };

  const errorRef = validarReferencia(v.metodoPago, v.referenciaPago);
  if (errorRef) return { ok: false, error: errorRef };
  const referencia = normalizarReferencia(v.metodoPago, v.referenciaPago);

  if (metodoEsEnBs(v.metodoPago) && v.montoBs == null) {
    return { ok: false, error: "Ese método es en bolívares: escribe el monto exacto que transferiste." };
  }

  const plan = await leerPlanPorGrupo(service, v.grupoId);
  if (!plan) return { ok: false, error: "No encontramos tu plan de pago." };
  if (plan.estado === "anulado" || plan.estado === "vencido") {
    return {
      ok: false,
      error: "Esta compra ya fue anulada. Escríbenos por WhatsApp antes de pagar nada más.",
    };
  }

  const pendientes = plan.cuotas.filter((c) => !c.verificadoEn && !c.reportadoEn);
  const desde = pendientes.findIndex((c) => c.id === v.cuotaId);
  if (desde < 0) return { ok: false, error: "Ese pago ya está anotado o ya fue confirmado. Recarga la página." };
  const cuotas = v.cubreTodo ? pendientes.slice(desde) : [pendientes[desde]];

  // Si el pago fue en bolívares y cubre varias cuotas, el monto del
  // comprobante se reparte en proporción para que lo cobrado en Bs cuadre con
  // el banco (igual que cuando lo anota el equipo).
  const totalUsd = cuotas.reduce((s, c) => s + c.montoUsd, 0);
  const bsPorCuota = v.montoBs != null
    ? repartirProporcional(v.montoBs, cuotas.map((c) => c.montoUsd / totalUsd))
    : cuotas.map(() => null);

  for (let i = 0; i < cuotas.length; i++) {
    const r = await reportarCuota(service, {
      cuotaId: cuotas[i].id,
      grupoId: v.grupoId,
      metodoPago: v.metodoPago,
      referenciaPago: referencia,
      montoBs: bsPorCuota[i],
      tasa: null,
      nota: cuotas.length > 1 ? `El comprador avisó un solo pago que cubre ${cuotas.map((c) => c.etiqueta).join(", ")}.` : undefined,
      // Sin reportadoPor: lo mandó el comprador, no el equipo. El canal queda
      // como "web", que es lo que distingue un reporte propio de uno anotado.
    });
    if (!r.ok) return { ok: false, error: r.error };
  }

  revalidatePath(`/compra/${v.grupoId}`);
  revalidatePath("/cobranza");
  revalidatePath("/finanzas");

  return {
    ok: true,
    aviso: "Listo, recibimos tu aviso. Lo verificamos en el banco y te escribimos — puede tomar unas horas.",
  };
}
