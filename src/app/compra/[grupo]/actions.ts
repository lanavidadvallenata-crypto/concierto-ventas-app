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
  metodoPago: z.enum(["pago_movil", "transferencia", "zelle", "binance"]),
  referenciaPago: z.string().trim().min(1, "Escribe la referencia de tu pago."),
  montoBs: z.coerce.number().positive().optional(),
});

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

  const r = await reportarCuota(service, {
    cuotaId: v.cuotaId,
    grupoId: v.grupoId,
    metodoPago: v.metodoPago,
    referenciaPago: referencia,
    montoBs: v.montoBs ?? null,
    tasa: null,
    // Sin reportadoPor: lo mandó el comprador, no el equipo. El canal queda
    // como "web", que es lo que distingue un reporte propio de uno anotado.
  });
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath(`/compra/${v.grupoId}`);
  revalidatePath("/cobranza");
  revalidatePath("/finanzas");

  return {
    ok: true,
    aviso: "Listo, recibimos tu aviso. Lo verificamos en el banco y te escribimos — puede tomar unas horas.",
  };
}
