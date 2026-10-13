"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { anularPlan, leerPlanPorGrupo, rechazarReporte, reportarCuota, verificarCuota, type CanalReporte } from "@/lib/abona618";
import { enviarCorreoCuotaVerificada, enviarCorreoPlanAnulado } from "@/lib/enviar-qr";
import { fechaCorta, usd } from "@/lib/cuotas";
import { metodoEsEnBs, normalizarReferencia, validarReferencia } from "@/lib/pagos";
import { generarTokenQR } from "@/lib/qr";
import { enviarCorreoQR } from "@/lib/enviar-qr";
import { obtenerAsiento } from "@/lib/asiento";
import type { Tipo } from "@/lib/precios";

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

/**
 * Reparte un monto en bolívares entre varias cuotas, en proporción a lo que
 * vale cada una y cuadrando al céntimo con el comprobante.
 *
 * Hace falta porque un comprobante trae UN número y puede cubrir varias
 * cuotas: si se guardara el total en cada una, los bolívares cobrados del
 * sistema saldrían al doble o al triple de lo que de verdad entró al banco.
 */
function repartirBs(total: number, pesos: number[]): number[] {
  const centavos = Math.round(total * 100);
  const suma = pesos.reduce((s, p) => s + p, 0);
  if (suma <= 0) return pesos.map(() => 0);
  const partes = pesos.map((p) => Math.round((centavos * p) / suma));
  partes[partes.length - 1] += centavos - partes.reduce((s, x) => s + x, 0);
  return partes.map((c) => Math.round(c) / 100);
}

const registrarSchema = z.object({
  // Varias cuotas a la vez porque así llega la plata de verdad: la primera
  // compradora real pagó $196 en UN solo Zelle, que cubría su inicial y su
  // cuota 01. Con una cuota por formulario había que anotar el mismo pago dos
  // veces, inventando cómo repartir el monto, y nadie se lo iba a imaginar
  // solo (Anita, 12 oct).
  cuotaIds: z.array(z.string().uuid()).min(1, "Elige al menos una cuota.").max(4),
  grupoId: z.string().uuid(),
  metodoPago: z.enum(["pago_movil", "transferencia", "zelle", "binance", "efectivo_usd", "efectivo_bs"]),
  referenciaPago: z.string().trim().min(1, "Escribe la referencia del pago."),
  canal: z.enum(["whatsapp", "llamada", "presencial", "otro"]),
  montoBs: z.coerce.number().positive().optional(),
  nota: z.string().trim().max(500).optional(),
});

/**
 * Ventas anota el pago que le llegó, cubriendo UNA o VARIAS cuotas con la
 * misma referencia. NO lo da por cobrado: queda reportado esperando a que
 * Finanzas lo vea en el banco. Es el paso que faltaba para que el cobro sea
 * un proceso acompañado y no dependa de que el comprador se acuerde.
 */
export async function registrarPagoDeCuotas(input: unknown): Promise<Resultado> {
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

  // Los montos se leen de la base, nunca del navegador: el reparto de los
  // bolívares depende de ellos y es lo que después cuadra con el banco.
  const plan = await leerPlanPorGrupo(service, v.grupoId);
  if (!plan) return { ok: false, error: "No encontramos el plan de esa compra." };
  if (plan.estado !== "al_dia" && plan.estado !== "en_mora") {
    // Antes se podía anotar un pago sobre un plan anulado: quedaba registrado
    // con sus bolívares, fuera de toda bandeja e imposible de aprobar.
    return {
      ok: false,
      error:
        plan.estado === "completado"
          ? "Ese plan ya está pagado completo."
          : "Esa compra ya fue anulada y su entrada volvió a la venta. Si pagó, regístralo como una compra nueva.",
    };
  }

  const ids = [...new Set(v.cuotaIds)];
  const elegidas = ids
    .map((id) => plan.cuotas.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c) && !c!.verificadoEn);

  if (elegidas.length !== ids.length) {
    return {
      ok: false,
      error: "Alguna de esas cuotas ya está cobrada o no es de esta compra. Recarga la pantalla y vuelve a intentarlo.",
    };
  }

  // Un pago ya anotado no se pisa: si fue el comprador, su referencia es la
  // que cuadra con el banco; si fue otra persona del equipo, la suya. Lo que
  // corresponde es que Finanzas lo confirme o lo rechace, no reescribirlo.
  const yaAnotadas = elegidas.filter((c) => c.reportadoEn);
  if (yaAnotadas.length > 0) {
    return {
      ok: false,
      error:
        `${yaAnotadas.map((c) => c.etiqueta).join(" y ")} ya ${yaAnotadas.length === 1 ? "tiene" : "tienen"} un pago anotado ` +
        "esperando a Finanzas. Si el pago anotado no es correcto, Finanzas lo rechaza con \"No llegó al banco\" y entonces se vuelve a anotar.",
    };
  }

  const totalUsd = Math.round(elegidas.reduce((s, c) => s + c.montoUsd, 0) * 100) / 100;
  const bs = v.montoBs != null ? repartirBs(v.montoBs, elegidas.map((c) => c.montoUsd)) : null;

  const nota = elegidas.length > 1
    ? [`Un solo pago de ${usd(totalUsd)} cubre: ${elegidas.map((c) => c.etiqueta).join(", ")}.`, v.nota]
        .filter(Boolean)
        .join(" ")
    : v.nota ?? null;

  const anotadas: string[] = [];
  for (let i = 0; i < elegidas.length; i++) {
    const c = elegidas[i];
    const r = await reportarCuota(service, {
      cuotaId: c.id,
      grupoId: v.grupoId,
      metodoPago: v.metodoPago,
      referenciaPago: referencia,
      montoBs: bs ? bs[i] : null,
      tasa: null,
      reportadoPor: user.id,
      canal: v.canal as CanalReporte,
      nota,
    });
    if (!r.ok) {
      revalidar();
      return {
        ok: false,
        error: anotadas.length === 0
          ? r.error
          : `Se anotaron ${anotadas.join(" y ")}, pero ${c.etiqueta} falló: ${r.error}`,
      };
    }
    anotadas.push(c.etiqueta);
  }

  revalidar();
  return {
    ok: true,
    aviso:
      `${anotadas.length === 1 ? "Pago anotado" : `Pago de ${usd(totalUsd)} anotado, cubre ${anotadas.join(" y ")}`}. ` +
      "Pasa a la cola de Finanzas para que lo confirmen en el banco — todavía no está cobrado.",
  };
}

/**
 * Finanzas confirma que el dinero entró. Acepta varias cuotas porque así se
 * anotan: un solo pago puede cubrir más de una, y aprobarlas de a una le
 * mandaría al comprador un correo por cada cuota del mismo pago.
 *
 * Si con esto el plan queda completo, la compra sigue el camino normal:
 * tickets a verificado, QR y correo. Si no, sale UN correo de cuota recibida
 * con el estado final y no se entrega nada.
 */
export async function aprobarCuotas(cuotaIds: string[]): Promise<Resultado> {
  const { user, rol, error } = await requiereEquipo(["finanzas", "admin"]);
  if (!user) return { ok: false, error: error! };

  const ids = [...new Set((cuotaIds ?? []).filter((x) => typeof x === "string" && x.length > 0))];
  if (ids.length === 0) return { ok: false, error: "No elegiste ningún pago." };

  const service = createServiceClient();

  const { data: filas } = await service
    .from("cuotas")
    .select("id, plan_id, etiqueta, reportado_por, reportado_en")
    .in("id", ids);
  const cuotasFila = filas ?? [];
  if (cuotasFila.length !== ids.length) {
    return { ok: false, error: "No encontramos alguno de esos pagos. Recarga la pantalla." };
  }
  if (new Set(cuotasFila.map((c) => String(c.plan_id))).size > 1) {
    return { ok: false, error: "Esos pagos son de compras distintas: apruébalos por separado." };
  }
  for (const c of cuotasFila) {
    if (!c.reportado_en) {
      return { ok: false, error: `Nadie ha anotado ${c.etiqueta} todavía. Regístrala primero con la referencia.` };
    }
  }

  // Control cruzado POR CUOTA: quien anotó un pago no lo aprueba, pero sí
  // puede aprobar los que anotó otra persona. Antes un lote con una sola
  // cuota propia se rechazaba entero, y si dos personas de Finanzas habían
  // anotado una cuota cada una, nadie que no fuera admin podía aprobar nada.
  const propias = rol === "admin" ? [] : cuotasFila.filter((c) => c.reportado_por === user.id);
  const aprobables = cuotasFila.filter((c) => !propias.includes(c));
  if (aprobables.length === 0) {
    return {
      ok: false,
      error: "Este pago lo anotaste tú. Por control cruzado lo tiene que aprobar otra persona de Finanzas o un admin.",
    };
  }
  const idsAprobables = aprobables.map((c) => String(c.id));
  const notaPropias =
    propias.length > 0
      ? ` ${propias.map((c) => String(c.etiqueta)).join(" y ")} ${propias.length === 1 ? "queda" : "quedan"} sin aprobar porque ${propias.length === 1 ? "la" : "las"} anotaste tú: ${propias.length === 1 ? "la" : "las"} aprueba otra persona.`
      : "";

  const { data: planFila } = await service
    .from("planes_pago")
    .select("grupo_id")
    .eq("id", cuotasFila[0].plan_id)
    .maybeSingle();
  const grupoId = planFila ? String(planFila.grupo_id) : null;
  if (!grupoId) return { ok: false, error: "Esos pagos no tienen una compra asociada. Revísalos a mano." };

  // Una por una, en orden. Si alguna falla se informa y se para: las que ya
  // pasaron quedan cobradas, que es la verdad del banco, y el reintento sobre
  // una cuota ya verificada es idempotente.
  const etiquetas: string[] = [];
  let montoTotal = 0;
  let completo = false;
  let todasYaEstaban = true;
  let ultimo: Awaited<ReturnType<typeof verificarCuota>> | null = null;

  for (const id of idsAprobables) {
    const r = await verificarCuota(service, { cuotaId: id, verificadoPor: user.id });
    if (!r.ok) {
      revalidar();
      return {
        ok: false,
        error: etiquetas.length === 0 ? r.error : `Se aprobó ${etiquetas.join(" y ")}, pero la siguiente falló: ${r.error}`,
      };
    }
    ultimo = r;
    if (r.completo) completo = true;
    if (!r.yaEstaba) {
      // Solo lo que se aprobó AHORA cuenta como "lo que acabamos de
      // verificar": una cuota ya cobrada hace días no se le vuelve a
      // acreditar al comprador en el correo.
      todasYaEstaban = false;
      etiquetas.push(r.cuota.etiqueta);
      montoTotal = Math.round((montoTotal + r.cuota.montoUsd) * 100) / 100;
    }
  }

  if (!ultimo || !ultimo.ok) return { ok: false, error: "No se pudo aprobar. Recarga la pantalla." };
  const plan = ultimo.plan;

  // Reparación: el plan ya estaba completado (por este u otro intento) pero
  // sus entradas siguen en pendiente — se cayó la entrega del QR a mitad de
  // camino. Antes esto respondía "eso ya estaba aprobado" para siempre y el
  // comprador, con el 100 % pagado, no tenía forma de recibir su entrada.
  // Decidir por el ESTADO (plan completo + tickets pendientes) en vez de por
  // la señal de un solo uso es lo que hace que el reintento repare.
  if (!completo && plan.estado === "completado" && plan.saldo <= 0) {
    const { data: pendientes } = await service
      .from("tickets")
      .select("id")
      .eq("grupo_id", grupoId)
      .eq("estado_pago", "pendiente")
      .limit(1);
    if ((pendientes ?? []).length > 0) {
      console.warn(`Abona618: plan ${plan.id} completado con entradas aún pendientes — reparando la entrega del QR.`);
      completo = true;
    }
  }

  const { data: tickets } = await service
    .from("tickets")
    .select("id, tipo, silla_id, comprador_nombre, comprador_email, estado_pago, qr_token")
    .eq("grupo_id", grupoId);
  const lista = tickets ?? [];
  const primero = lista[0];
  const queSeAprobo = etiquetas.join(" y ");

  if (!completo) {
    revalidar();
    if (todasYaEstaban) {
      return {
        ok: true,
        aviso: `Eso ya estaba aprobado. Lleva ${usd(plan.pagado)} de ${usd(plan.totalUsd)} y le falta ${usd(plan.saldo)}. No se entregó ningún QR.${notaPropias}`,
      };
    }
    let aviso =
      `${queSeAprobo} ${etiquetas.length === 1 ? "aprobada" : "aprobadas"}: ${usd(montoTotal)}. ` +
      `Lleva ${usd(plan.pagado)} de ${usd(plan.totalUsd)} y le falta ${usd(plan.saldo)}. No se entregó ningún QR.${notaPropias}`;

    const correo = primero?.comprador_email as string | null | undefined;
    if (correo) {
      try {
        await enviarCorreoCuotaVerificada({
          destinatario: correo,
          nombreComprador: String(primero.comprador_nombre),
          grupoId,
          etiquetaCuota: queSeAprobo,
          montoVerificado: montoTotal,
          totalUsd: plan.totalUsd,
          pagado: plan.pagado,
          saldo: plan.saldo,
          pendientes: plan.cuotas
            .filter((c) => !c.verificadoEn)
            .map((c) => ({ etiqueta: c.etiqueta, monto: c.montoUsd, venceEl: fechaCorta(c.venceEl) })),
          proximaFecha: plan.proxima ? fechaCorta(plan.proxima.venceEl) : null,
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
    if (t.silla_id) {
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
    const asiento = t.silla_id ? await obtenerAsiento(service, t.silla_id) : null;
    entradas.push({
      qrToken: t.qr_token,
      tipo: t.tipo as Tipo,
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
 * Anular por falta de pago: se pasó el margen interno, la entrada vuelve al
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

  const enVuelo = plan.cuotas.filter((c) => c.reportadoEn && !c.verificadoEn);
  if (enVuelo.length > 0) {
    // "Falta de pago" con un pago anotado esperando al banco no es falta de
    // pago. Primero Finanzas lo confirma o lo rechaza; después se decide.
    return {
      ok: false,
      error:
        `${enVuelo.map((c) => c.etiqueta).join(" y ")} ${enVuelo.length === 1 ? "tiene" : "tienen"} un pago anotado sin confirmar. ` +
        "Confírmalo en el banco o recházalo antes de anular: no se anula a alguien con dinero en camino.",
    };
  }

  const r = await anularPlan(service, {
    grupoId,
    por: user.id,
    motivo: "vencido",
    nota: `Anulado por falta de pago. Quedaron ${usd(plan.pagado)} abonados que no se devuelven.`,
  });
  if (!r.anulado) return { ok: false, error: "Ese plan ya estaba anulado o vencido." };

  // Las entradas vuelven al inventario: se rechazan y se liberan las sillas.
  const { data: tickets } = await service
    .from("tickets")
    .select("id, tipo, silla_id, estado_pago, comprador_nombre, comprador_email")
    .eq("grupo_id", grupoId);
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
    if (t.silla_id) {
      await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).eq("id", t.silla_id);
    }
  }

  revalidar();

  let avisoCorreo = " Avísale por WhatsApp.";
  const comprador = (tickets ?? [])[0];
  const correo = comprador?.comprador_email as string | null | undefined;
  if (correo) {
    try {
      await enviarCorreoPlanAnulado({
        destinatario: correo,
        nombreComprador: String(comprador.comprador_nombre ?? ""),
        grupoId,
        montoPendiente: plan.saldo,
        abonado: plan.pagado,
        // Citar cuándo aceptó las condiciones es lo único que convierte "no se
        // devuelve" en algo que se sostiene si el comprador reclama.
        aceptoEn: plan.aceptoCondicionesEn
          ? new Date(plan.aceptoCondicionesEn).toLocaleString("es-VE", {
              timeZone: "America/Caracas",
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })
          : null,
      });
      avisoCorreo = ` Le avisamos por correo a ${correo}.`;
    } catch (e) {
      console.error("Error enviando el correo de anulación:", (e as Error).message);
      avisoCorreo = ` El correo a ${correo} NO salió — avísale tú por WhatsApp.`;
    }
  } else {
    avisoCorreo = " Esta compra no tiene correo: avísale por WhatsApp.";
  }

  return {
    ok: true,
    aviso:
      `Plan anulado. ${liberadas} entrada${liberadas === 1 ? "" : "s"} de vuelta a la venta. ` +
      `Quedaron ${usd(plan.pagado)} abonados que, según las condiciones, no se devuelven.` +
      avisoCorreo,
  };
}

/**
 * Anular una compra en plan que NO está vencida: compra duplicada, comprador
 * que se arrepintió, prueba del equipo. Solo admin, con motivo escrito.
 *
 * Nació el 13 de octubre: la primera compra Preferencial fue una prueba en
 * cuotas y no había ningún botón para deshacerla — al estar en plan no sale
 * en la cola de Finanzas, y en Cobranza "Anular" solo aparece vencida. Se
 * resolvió por SQL esa vez; esto es para que no haga falta la próxima.
 *
 * Diferencias con anularPorFaltaDePago, a propósito:
 *   · Se permite aunque haya un pago anotado sin confirmar: el admin ya
 *     decidió, y la pantalla le avisa cuánto hay en camino antes de apretar.
 *   · El correo NO dice "lo abonado no se devuelve": eso aquí lo decide el
 *     equipo caso por caso y se habla por WhatsApp.
 *   · El plan queda "anulado" (no "vencido"), con el motivo en las notas,
 *     para que en el dashboard no cuente como impago.
 */
export async function anularCompraEnPlan(input: unknown): Promise<Resultado> {
  const parsed = z
    .object({ grupoId: z.string().uuid(), motivo: z.string().trim().min(5, "Escribe el motivo (mínimo 5 letras).").max(200) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  const { grupoId, motivo } = parsed.data;

  const { user, error } = await requiereEquipo(["admin"]);
  if (!user) return { ok: false, error: error! };

  const service = createServiceClient();
  const plan = await leerPlanPorGrupo(service, grupoId);
  if (!plan) return { ok: false, error: "No encontramos el plan de esa compra." };
  if (plan.estado === "completado") {
    return { ok: false, error: "Esa compra ya está pagada completa y con QR. Se anula desde Finanzas → Aprobadas → Anular compra." };
  }
  if (plan.estado === "anulado" || plan.estado === "vencido") return { ok: false, error: "Esa compra ya estaba anulada." };

  const { data: perfil } = await service.from("perfiles").select("nombre").eq("id", user.id).maybeSingle();
  const quien = (perfil?.nombre as string | undefined) ?? "admin";
  const enVuelo = plan.cuotas.filter((c) => c.reportadoEn && !c.verificadoEn);

  const r = await anularPlan(service, {
    grupoId,
    por: user.id,
    motivo: "anulado",
    nota:
      `Anulada por ${quien}: ${motivo}. Abonado ${usd(plan.pagado)}.` +
      (enVuelo.length ? ` Se descartaron ${enVuelo.length} pago(s) anotado(s) sin confirmar.` : ""),
  });
  if (!r.anulado) return { ok: false, error: "Ese plan ya estaba anulado o vencido." };

  // Las entradas vuelven al inventario: se rechazan y se liberan las sillas.
  const { data: tickets } = await service
    .from("tickets")
    .select("id, tipo, silla_id, estado_pago, comprador_nombre, comprador_email")
    .eq("grupo_id", grupoId);
  const ahora = new Date().toISOString();
  let liberadas = 0;
  for (const t of tickets ?? []) {
    if (t.estado_pago !== "pendiente") continue;
    const { data: ok } = await service
      .from("tickets")
      .update({ estado_pago: "rechazado", verificado_por: user.id, verificado_en: ahora })
      .eq("id", t.id)
      .eq("estado_pago", "pendiente")
      .select("id")
      .maybeSingle();
    if (!ok) continue;
    liberadas++;
    if (t.silla_id) {
      await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).eq("id", t.silla_id);
    }
  }

  revalidar();

  let avisoCorreo = " Avísale por WhatsApp.";
  const comprador = (tickets ?? [])[0];
  const correo = comprador?.comprador_email as string | null | undefined;
  if (correo) {
    try {
      await enviarCorreoPlanAnulado({
        destinatario: correo,
        nombreComprador: String(comprador.comprador_nombre ?? ""),
        grupoId,
        montoPendiente: plan.saldo,
        abonado: plan.pagado,
        aceptoEn: null,
        motivo: "por_el_equipo",
      });
      avisoCorreo = ` Le avisamos por correo a ${correo}.`;
    } catch (e) {
      console.error("Error enviando el correo de anulación:", (e as Error).message);
      avisoCorreo = ` El correo a ${correo} NO salió — avísale tú por WhatsApp.`;
    }
  } else {
    avisoCorreo = " Esta compra no tiene correo: avísale por WhatsApp.";
  }

  return {
    ok: true,
    aviso:
      `Compra anulada. ${liberadas} entrada${liberadas === 1 ? "" : "s"} de vuelta a la venta.` +
      (plan.pagado > 0 ? ` Tiene ${usd(plan.pagado)} abonados: define con el comprador qué se hace con eso.` : "") +
      avisoCorreo,
  };
}

/**
 * Finanzas buscó en el banco el pago anotado y no estaba. La cuota vuelve a
 * "sin pagar", con su fecha, y el cron le vuelve a escribir. Es el único
 * camino para deshacer un reporte equivocado o inventado: sin esto, cualquier
 * referencia de seis dígitos congelaba una entrada hasta el día del evento.
 */
export async function rechazarPagoAnotado(input: unknown): Promise<Resultado> {
  const { user, error } = await requiereEquipo(["finanzas", "admin"]);
  if (!user) return { ok: false, error: error! };

  const parsed = z
    .object({ cuotaId: z.string().uuid(), motivo: z.string().trim().min(3, "Di por qué: es lo que va a leer quien lo anotó.").max(300) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };

  const service = createServiceClient();
  const r = await rechazarReporte(service, { cuotaId: parsed.data.cuotaId, por: user.id, motivo: parsed.data.motivo });
  if (!r.ok) return { ok: false, error: r.error };

  revalidar();
  return {
    ok: true,
    aviso: `${r.etiqueta} vuelve a estar pendiente de pago, con su fecha. Avísale al comprador por WhatsApp qué pasó con su referencia.`,
  };
}
