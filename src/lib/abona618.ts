// Abona618 — la capa de datos del plan de cuotas. Todo lo que toca las tablas
// `abona618_config`, `planes_pago` y `cuotas` pasa por aquí: el checkout, el
// panel de Finanzas, la página del comprador y el cron llaman a estas
// funciones y no escriben SQL por su cuenta.
//
// El reparto de montos y las fechas NO viven aquí: viven en cuotas.ts, que es
// puro y está cubierto por el barrido de pruebas. Este archivo solo orquesta.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AVISO_TOPE_VIP,
  TOPE_VIP_EN_PLAN,
  hoyEnVenezuela,
  planPara,
  type Cuota,
  type Plan,
  type SinPlan,
} from "@/lib/cuotas";

export type Config = {
  activo: boolean;
  topeVip: number;
  avisoTopeVip: number;
  avisoTopeEnviadoEn: string | null;
};

// Si la tabla de configuración no existe todavía o la consulta falla, el
// módulo queda APAGADO. Un error de lectura nunca debe terminar en "vendamos
// a crédito por si acaso": la venta de contado sigue intacta y nadie se
// entera de que algo falló, salvo el log.
const CONFIG_APAGADA: Config = {
  activo: false,
  topeVip: TOPE_VIP_EN_PLAN,
  avisoTopeVip: AVISO_TOPE_VIP,
  avisoTopeEnviadoEn: null,
};

export async function leerConfig(service: SupabaseClient): Promise<Config> {
  const { data, error } = await service
    .from("abona618_config")
    .select("activo, tope_vip, aviso_tope_vip, aviso_tope_enviado_en")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("Abona618: no se pudo leer la configuración —", error.message);
    return CONFIG_APAGADA;
  }

  return {
    activo: Boolean(data.activo),
    topeVip: Number(data.tope_vip ?? TOPE_VIP_EN_PLAN),
    avisoTopeVip: Number(data.aviso_tope_vip ?? AVISO_TOPE_VIP),
    avisoTopeEnviadoEn: (data.aviso_tope_enviado_en as string | null) ?? null,
  };
}

/**
 * Cuántas entradas VIP están ocupando el tope ahora mismo. Cuentan los planes
 * al día, en mora y completados: los tres sacaron una silla del mercado. Los
 * vencidos y anulados no, porque su silla ya volvió al inventario.
 */
export async function contarVipEnPlan(service: SupabaseClient): Promise<number> {
  const { data, error } = await service
    .from("planes_pago")
    .select("cantidad")
    .eq("tipo", "vip")
    .in("estado", ["al_dia", "en_mora", "completado"]);

  if (error) {
    console.error("Abona618: no se pudo contar las VIP en plan —", error.message);
    // Devolver el tope hace que el plan NO se ofrezca. Ante la duda, no se
    // compromete una silla más.
    return Number.MAX_SAFE_INTEGER;
  }
  return (data ?? []).reduce((s, f) => s + Number(f.cantidad ?? 0), 0);
}

export type Ofrecible = { plan: Plan | SinPlan; config: Config; vipEnPlan: number };

/**
 * ¿Se le puede ofrecer el plan a esta compra, aquí y ahora? Junta las tres
 * cosas que lo deciden: el interruptor, el tope de VIP y el calendario.
 *
 * El checkout llama a esto antes de pintar la opción, y OTRA VEZ al confirmar:
 * entre que el comprador vio la pantalla y le dio a "ya pagué" pueden pasar 15
 * minutos, y en esos 15 minutos el tope pudo llenarse o Anita pudo apagar el
 * módulo.
 */
export async function planOfrecible(
  service: SupabaseClient,
  d: { tipo: "vip" | "general"; cantidad: number; total: number; canal?: string; hoy?: string }
): Promise<Ofrecible> {
  const config = await leerConfig(service);
  const hoy = d.hoy ?? hoyEnVenezuela();

  if (!config.activo) {
    return { plan: { hayPlan: false, motivo: "apagado" }, config, vipEnPlan: 0 };
  }

  const vipEnPlan = d.tipo === "vip" ? await contarVipEnPlan(service) : 0;

  const plan = planPara(d.total, hoy, {
    canal: d.canal,
    tipo: d.tipo,
    cantidad: d.cantidad,
    // El tope real sale de la base, no de la constante: Anita puede subirlo
    // sin que nadie despliegue nada.
    vipEnPlan: d.tipo === "vip" ? vipEnPlan : undefined,
    topeVip: config.topeVip,
  });

  return { plan, config, vipEnPlan };
}

// --------------------------------------------------------------- crear

export type DatosNuevoPlan = {
  grupoId: string;
  total: number;
  tipo: "vip" | "general";
  cantidad: number;
  cuotas: Cuota[];
  canal: string;
  creadoPor?: string | null;
  condicionesVersion?: string;
  // Datos del pago de la inicial, que el comprador acaba de reportar.
  metodoPago: string;
  referenciaPago: string | null;
  montoBsInicial: number | null;
  tasaAplicada: number | null;
};

/**
 * Crea el plan y sus cuotas, con la inicial ya marcada como REPORTADA (el
 * comprador dice que pagó) pero no verificada: eso lo hace Finanzas cuando vea
 * el dinero en el banco.
 *
 * Si la inserción de las cuotas falla, se borra el plan: un plan sin cuotas es
 * una compra que nadie va a cobrar nunca.
 */
export async function crearPlan(
  service: SupabaseClient,
  d: DatosNuevoPlan
): Promise<{ ok: true; planId: string } | { ok: false; error: string }> {
  const { data: plan, error } = await service
    .from("planes_pago")
    .insert({
      grupo_id: d.grupoId,
      total_usd: d.total,
      tipo: d.tipo,
      cantidad: d.cantidad,
      canal: d.canal,
      creado_por: d.creadoPor ?? null,
      condiciones_version: d.condicionesVersion ?? "v1",
    })
    .select("id")
    .single();

  if (error || !plan) {
    console.error("Abona618: no se pudo crear el plan —", error?.message);
    return { ok: false, error: "No se pudo registrar tu plan de pago." };
  }

  const ahora = new Date().toISOString();
  const filas = d.cuotas.map((c) => ({
    plan_id: plan.id as string,
    orden: c.orden,
    etiqueta: c.etiqueta,
    porcentaje: c.porcentaje,
    monto_usd: c.monto,
    vence_el: c.venceEl,
    // Solo la inicial viene reportada: es la que el comprador acaba de pagar.
    ...(c.esInicial
      ? {
          reportado_en: ahora,
          metodo_pago: d.metodoPago,
          referencia_pago: d.referenciaPago,
          monto_bs: d.montoBsInicial,
          tasa_aplicada: d.tasaAplicada,
        }
      : {}),
  }));

  const { error: errorCuotas } = await service.from("cuotas").insert(filas);
  if (errorCuotas) {
    console.error("Abona618: no se pudieron crear las cuotas —", errorCuotas.message);
    await service.from("planes_pago").delete().eq("id", plan.id);
    return { ok: false, error: "No se pudo registrar tu plan de pago." };
  }

  return { ok: true, planId: plan.id as string };
}

// --------------------------------------------------------------- leer

export type CuotaGuardada = {
  id: string;
  orden: number;
  etiqueta: string;
  montoUsd: number;
  venceEl: string;
  reportadoEn: string | null;
  verificadoEn: string | null;
  metodoPago: string | null;
  referenciaPago: string | null;
};

export type PlanGuardado = {
  id: string;
  grupoId: string;
  totalUsd: number;
  tipo: "vip" | "general";
  cantidad: number;
  estado: "al_dia" | "en_mora" | "vencido" | "completado" | "anulado";
  aceptoCondicionesEn: string;
  condicionesVersion: string;
  cuotas: CuotaGuardada[];
  pagado: number;
  saldo: number;
  /** La próxima cuota por pagar, o null si ya está todo verificado. */
  proxima: CuotaGuardada | null;
};

const SELECT_CUOTAS =
  "id, orden, etiqueta, monto_usd, vence_el, reportado_en, verificado_en, metodo_pago, referencia_pago";

function armarPlan(fila: Record<string, unknown>, filasCuotas: Record<string, unknown>[]): PlanGuardado {
  const cuotas: CuotaGuardada[] = filasCuotas
    .map((c) => ({
      id: String(c.id),
      orden: Number(c.orden),
      etiqueta: String(c.etiqueta),
      montoUsd: Number(c.monto_usd),
      venceEl: String(c.vence_el),
      reportadoEn: (c.reportado_en as string | null) ?? null,
      verificadoEn: (c.verificado_en as string | null) ?? null,
      metodoPago: (c.metodo_pago as string | null) ?? null,
      referenciaPago: (c.referencia_pago as string | null) ?? null,
    }))
    .sort((a, b) => a.orden - b.orden);

  // Pagado = verificado. Lo que el comprador dice que pagó y Finanzas no ha
  // confirmado todavía no es plata: si se contara como pagado, un reporte
  // falso completaría un plan y liberaría un QR.
  const pagado = Math.round(cuotas.filter((c) => c.verificadoEn).reduce((s, c) => s + c.montoUsd, 0) * 100) / 100;
  const total = Number(fila.total_usd);

  return {
    id: String(fila.id),
    grupoId: String(fila.grupo_id),
    totalUsd: total,
    tipo: fila.tipo as "vip" | "general",
    cantidad: Number(fila.cantidad),
    estado: fila.estado as PlanGuardado["estado"],
    aceptoCondicionesEn: String(fila.acepto_condiciones_en),
    condicionesVersion: String(fila.condiciones_version ?? "v1"),
    cuotas,
    pagado,
    saldo: Math.round((total - pagado) * 100) / 100,
    proxima: cuotas.find((c) => !c.verificadoEn) ?? null,
  };
}

/** El plan de una compra, buscado por el grupo_id de sus tickets. */
export async function leerPlanPorGrupo(service: SupabaseClient, grupoId: string): Promise<PlanGuardado | null> {
  const { data: plan, error } = await service
    .from("planes_pago")
    .select("id, grupo_id, total_usd, tipo, cantidad, estado, acepto_condiciones_en, condiciones_version")
    .eq("grupo_id", grupoId)
    .maybeSingle();

  if (error || !plan) {
    if (error) console.error("Abona618: no se pudo leer el plan —", error.message);
    return null;
  }

  const { data: cuotas, error: errorCuotas } = await service.from("cuotas").select(SELECT_CUOTAS).eq("plan_id", plan.id);
  if (errorCuotas) {
    console.error("Abona618: no se pudieron leer las cuotas —", errorCuotas.message);
    return null;
  }

  return armarPlan(plan, cuotas ?? []);
}

/**
 * ¿Esta compra tiene un plan con saldo? Es la pregunta que tiene que hacerse
 * Finanzas ANTES de aprobar un pago: si la respuesta es sí, aprobar significa
 * dar por pagada una cuota, no entregar la entrada.
 */
export async function planConSaldo(service: SupabaseClient, grupoId: string | null): Promise<PlanGuardado | null> {
  if (!grupoId) return null;
  const plan = await leerPlanPorGrupo(service, grupoId);
  if (!plan) return null;
  if (plan.estado === "anulado" || plan.estado === "vencido") return null;
  return plan.saldo > 0 ? plan : null;
}

// --------------------------------------------------------------- escribir

/** El comprador dice que pagó una cuota. Todavía no es plata. */
export async function reportarCuota(
  service: SupabaseClient,
  d: { cuotaId: string; metodoPago: string; referenciaPago: string | null; montoBs: number | null; tasa: number | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  // El UPDATE solo aplica si la cuota sigue sin verificar: así un reporte
  // tardío no borra los datos del pago que Finanzas ya confirmó.
  const { data, error } = await service
    .from("cuotas")
    .update({
      reportado_en: new Date().toISOString(),
      metodo_pago: d.metodoPago,
      referencia_pago: d.referenciaPago,
      monto_bs: d.montoBs,
      tasa_aplicada: d.tasa,
    })
    .eq("id", d.cuotaId)
    .is("verificado_en", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Abona618: no se pudo reportar la cuota —", error.message);
    return { ok: false, error: "No se pudo registrar tu pago. Escríbenos por WhatsApp." };
  }
  if (!data) return { ok: false, error: "Esa cuota ya está verificada — no hace falta reportarla otra vez." };
  return { ok: true };
}

/**
 * Finanzas vio el dinero. Marca la cuota como verificada y dice si con eso el
 * plan quedó completo, que es lo que decide si se entregan los QR.
 *
 * El UPDATE condicionado a `verificado_en is null` evita el caso de dos
 * personas de Finanzas aprobando la misma cuota a la vez: la segunda no
 * encuentra fila y no se manda el correo dos veces.
 */
export async function verificarCuota(
  service: SupabaseClient,
  d: { cuotaId: string; verificadoPor: string }
): Promise<
  | { ok: true; plan: PlanGuardado; completo: boolean; cuota: CuotaGuardada }
  | { ok: false; error: string }
> {
  const { data: fila, error } = await service
    .from("cuotas")
    .update({ verificado_en: new Date().toISOString(), verificado_por: d.verificadoPor })
    .eq("id", d.cuotaId)
    .is("verificado_en", null)
    .select("id, plan_id")
    .maybeSingle();

  if (error) {
    console.error("Abona618: no se pudo verificar la cuota —", error.message);
    return { ok: false, error: "No se pudo marcar la cuota como pagada." };
  }
  if (!fila) return { ok: false, error: "Esa cuota ya la verificó otra persona." };

  const { data: planFila } = await service
    .from("planes_pago")
    .select("id, grupo_id, total_usd, tipo, cantidad, estado, acepto_condiciones_en, condiciones_version")
    .eq("id", fila.plan_id)
    .maybeSingle();
  const { data: cuotasFilas } = await service.from("cuotas").select(SELECT_CUOTAS).eq("plan_id", fila.plan_id);

  if (!planFila) return { ok: false, error: "La cuota quedó verificada, pero no se encontró su plan." };

  const plan = armarPlan(planFila, cuotasFilas ?? []);
  const completo = plan.saldo <= 0;

  if (completo) {
    await service
      .from("planes_pago")
      .update({ estado: "completado", completado_en: new Date().toISOString() })
      .eq("id", plan.id);
    plan.estado = "completado";
  } else if (plan.estado === "en_mora") {
    // Se puso al día: sale del rojo en Finanzas y deja de recibir avisos de
    // gracia.
    await service.from("planes_pago").update({ estado: "al_dia" }).eq("id", plan.id);
    plan.estado = "al_dia";
  }

  const cuota = plan.cuotas.find((c) => c.id === String(fila.id))!;
  return { ok: true, plan, completo, cuota };
}
