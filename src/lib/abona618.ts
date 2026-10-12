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
  DIAS_GRACIA,
  TOPE_VIP_EN_PLAN,
  diasEntre,
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
  /** true cuando no se pudo leer la tabla. El módulo queda cerrado, pero el
   *  checkout necesita distinguirlo de un apagado deliberado. */
  error: boolean;
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
  error: true,
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
    error: false,
  };
}

/**
 * Cuántas entradas VIP están ocupando el tope ahora mismo. Cuentan los planes
 * al día, en mora y completados: los tres sacaron una silla del mercado. Los
 * vencidos y anulados no, porque su silla ya volvió al inventario.
 */
export async function contarVipEnPlan(service: SupabaseClient): Promise<number | null> {
  const { data, error } = await service
    .from("planes_pago")
    .select("cantidad")
    .eq("tipo", "vip")
    .in("estado", ["al_dia", "en_mora", "completado"]);

  if (error) {
    console.error("Abona618: no se pudo contar las VIP en plan —", error.message);
    // null es "no se pudo medir", NO "cero" y tampoco "está lleno". Antes esto
    // devolvía Number.MAX_SAFE_INTEGER para que el plan no se ofreciera, pero
    // aguas abajo eso llegaba como "el tope está lleno" y el checkout lo
    // honraba: un timeout terminaba abriendo crédito, justo lo contrario de lo
    // que se quería.
    return null;
  }
  return (data ?? []).reduce((s, f) => s + Number(f.cantidad ?? 0), 0);
}

/** `vipEnPlan` es null cuando no se midió (módulo apagado, compra general) o
 *  cuando la lectura falló: no es un cero. */
export type Ofrecible = { plan: Plan | SinPlan; config: Config; vipEnPlan: number | null };

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

  if (config.error) {
    return { plan: { hayPlan: false, motivo: "error" }, config, vipEnPlan: null };
  }
  if (!config.activo) {
    return { plan: { hayPlan: false, motivo: "apagado" }, config, vipEnPlan: null };
  }

  const vipEnPlan = d.tipo === "vip" ? await contarVipEnPlan(service) : null;
  if (d.tipo === "vip" && vipEnPlan === null) {
    return { plan: { hayPlan: false, motivo: "error" }, config, vipEnPlan: null };
  }

  const plan = planPara(d.total, hoy, {
    canal: d.canal,
    tipo: d.tipo,
    cantidad: d.cantidad,
    // El tope real sale de la base, no de la constante: Anita puede subirlo
    // sin que nadie despliegue nada.
    vipEnPlan: vipEnPlan ?? undefined,
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
      // Explícitos a propósito: `contarVipEnPlan` filtra por `estado` y el
      // correo de anulación cita `acepto_condiciones_en`. Depender del default
      // de la columna significaba que un esquema recreado a mano con otro
      // default rompía el tope de VIP en silencio.
      estado: "al_dia",
      acepto_condiciones_en: new Date().toISOString(),
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

export type CanalReporte = "whatsapp" | "llamada" | "presencial" | "web" | "otro";

export type CuotaGuardada = {
  id: string;
  orden: number;
  etiqueta: string;
  montoUsd: number;
  venceEl: string;
  reportadoEn: string | null;
  /** Quién anotó el pago. null = lo reportó el comprador desde su página. */
  reportadoPor: string | null;
  canalReporte: CanalReporte | null;
  nota: string | null;
  verificadoEn: string | null;
  verificadoPor: string | null;
  metodoPago: string | null;
  referenciaPago: string | null;
  montoBs: number | null;
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
  "id, orden, etiqueta, monto_usd, vence_el, reportado_en, reportado_por, canal_reporte, nota, verificado_en, verificado_por, metodo_pago, referencia_pago, monto_bs";

function armarPlan(fila: Record<string, unknown>, filasCuotas: Record<string, unknown>[]): PlanGuardado {
  const cuotas: CuotaGuardada[] = filasCuotas
    .map((c) => ({
      id: String(c.id),
      orden: Number(c.orden),
      etiqueta: String(c.etiqueta),
      montoUsd: Number(c.monto_usd),
      venceEl: String(c.vence_el),
      reportadoEn: (c.reportado_en as string | null) ?? null,
      reportadoPor: (c.reportado_por as string | null) ?? null,
      canalReporte: (c.canal_reporte as CanalReporte | null) ?? null,
      nota: (c.nota as string | null) ?? null,
      verificadoEn: (c.verificado_en as string | null) ?? null,
      verificadoPor: (c.verificado_por as string | null) ?? null,
      metodoPago: (c.metodo_pago as string | null) ?? null,
      referenciaPago: (c.referencia_pago as string | null) ?? null,
      montoBs: c.monto_bs == null ? null : Number(c.monto_bs),
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

  if (!cuotas || cuotas.length === 0) {
    // Un plan sin cuotas no se puede pagar: no hay nada que reportar ni que
    // verificar. Queda con saldo completo, así que el candado del QR sigue
    // puesto (que es lo correcto), pero hace falta arreglarlo a mano.
    console.error(
      `Abona618: PLAN SIN CUOTAS, REVISAR A MANO — plan ${plan.id}, grupo ${plan.grupo_id}. ` +
        "La compra no se puede completar hasta que se le creen las cuotas."
    );
  }

  return armarPlan(plan, cuotas ?? []);
}

/**
 * ¿Esta compra tiene un plan con saldo? Es la pregunta que tiene que hacerse
 * Finanzas ANTES de aprobar un pago: si la respuesta es sí, aprobar significa
 * dar por pagada una cuota, no entregar la entrada.
 *
 * El estado del plan NO entra en la decisión, solo el saldo. Antes esta
 * función devolvía null para los planes `vencido` y `anulado` — es decir,
 * soltaba el candado justo en los dos casos donde más hace falta: un plan
 * vencido tiene sus tickets todavía en `pendiente`, siguen apareciendo en la
 * cola de Finanzas, y aprobarlos entregaría la entrada completa de alguien que
 * dejó de pagar.
 */
export async function planConSaldo(service: SupabaseClient, grupoId: string | null): Promise<PlanGuardado | null> {
  if (!grupoId) return null;
  const plan = await leerPlanPorGrupo(service, grupoId);
  if (!plan) return null;
  return plan.saldo > 0 ? plan : null;
}

// --------------------------------------------------------------- escribir

/**
 * El comprador dice que pagó una cuota. Todavía no es plata.
 *
 * `grupoId` es obligatorio y no es decorativo: sin él, quien conozca el id de
 * una cuota puede reportar pagos sobre la compra de otra persona. No hay
 * política RLS que lo impida (las tablas son solo de service_role), así que la
 * comprobación de propiedad vive aquí.
 */
export async function reportarCuota(
  service: SupabaseClient,
  d: {
    cuotaId: string;
    grupoId: string;
    metodoPago: string;
    referenciaPago: string | null;
    montoBs: number | null;
    tasa: number | null;
    /** null = lo reportó el comprador desde su página. Con un id, lo registró
     *  alguien del equipo y entonces `canal` es obligatorio. */
    reportadoPor?: string | null;
    canal?: CanalReporte;
    nota?: string | null;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (d.reportadoPor && !d.canal) {
    // Lo exige la base (constraint reporte_con_canal) y lo exige la operación:
    // el siguiente que atienda a ese comprador tiene que saber por dónde
    // llegó el pago anterior.
    return { ok: false, error: "Falta decir por dónde llegó el pago (WhatsApp, llamada, presencial)." };
  }
  const plan = await leerPlanPorGrupo(service, d.grupoId);
  if (!plan) return { ok: false, error: "No encontramos tu plan de pago." };
  if (!plan.cuotas.some((c) => c.id === d.cuotaId)) {
    console.warn(`Abona618: intento de reportar la cuota ${d.cuotaId} desde el grupo ${d.grupoId}, que no es su dueño.`);
    return { ok: false, error: "Ese pago no corresponde a tu compra." };
  }

  // El UPDATE solo aplica si la cuota sigue sin verificar: así un reporte
  // tardío no borra los datos del pago que Finanzas ya confirmó.
  const { data, error } = await service
    .from("cuotas")
    .update({
      reportado_en: new Date().toISOString(),
      reportado_por: d.reportadoPor ?? null,
      canal_reporte: d.canal ?? (d.reportadoPor ? null : "web"),
      metodo_pago: d.metodoPago,
      referencia_pago: d.referenciaPago,
      monto_bs: d.montoBs,
      tasa_aplicada: d.tasa,
      ...(d.nota !== undefined ? { nota: d.nota } : {}),
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
 * Tres cosas que esta función tuvo que aprender a hacer bien:
 *
 * Es IDEMPOTENTE. Si la cuota ya estaba verificada no devuelve error: vuelve a
 * calcular el estado real del plan y lo informa con `yaEstaba: true`. Antes
 * devolvía "esa cuota ya la verificó otra persona" y se quedaba ahí, así que
 * un timeout entre el UPDATE de la cuota y la lectura del plan dejaba un plan
 * pagado al 100 % que el sistema creía incompleto, sin forma de repararlo
 * desde la interfaz.
 *
 * Solo UNO completa el plan. El UPDATE a `completado` está condicionado a que
 * el plan no lo esté ya, así que cuando dos personas de Finanzas verifican dos
 * cuotas DISTINTAS del mismo plan a la vez, solo una recibe `completo: true` y
 * los QR salen una sola vez. El candado anterior (`verificado_en is null`)
 * protegía la misma cuota contra dos clics, que es el caso fácil, no este.
 *
 * No RESUCITA planes muertos. Verificar un pago sobre un plan anulado o
 * vencido se rechaza: su silla ya volvió al inventario y probablemente se
 * revendió, así que completarlo entregaría un QR de un asiento que ahora es de
 * otra persona.
 */
export async function verificarCuota(
  service: SupabaseClient,
  d: { cuotaId: string; verificadoPor: string }
): Promise<
  | { ok: true; plan: PlanGuardado; completo: boolean; cuota: CuotaGuardada; yaEstaba: boolean }
  | { ok: false; error: string }
> {
  const { data: cuotaPrevia, error: errorBusqueda } = await service
    .from("cuotas")
    .select("id, plan_id, verificado_en")
    .eq("id", d.cuotaId)
    .maybeSingle();

  if (errorBusqueda) {
    console.error("Abona618: no se pudo leer la cuota —", errorBusqueda.message);
    return { ok: false, error: "No se pudo leer la cuota. Intenta de nuevo." };
  }
  if (!cuotaPrevia) return { ok: false, error: "No encontramos esa cuota." };

  const planId = String(cuotaPrevia.plan_id);

  const { data: estadoPrevio } = await service.from("planes_pago").select("estado").eq("id", planId).maybeSingle();
  const estadoAntes = estadoPrevio?.estado as PlanGuardado["estado"] | undefined;
  if (estadoAntes === "anulado" || estadoAntes === "vencido") {
    return {
      ok: false,
      error:
        estadoAntes === "anulado"
          ? "Esta compra fue anulada: su entrada ya volvió a la venta. Registra el pago como una compra nueva."
          : "Este plan venció y su entrada ya se liberó. Registra el pago como una compra nueva.",
    };
  }

  const { data: fila, error } = await service
    .from("cuotas")
    .update({ verificado_en: new Date().toISOString(), verificado_por: d.verificadoPor })
    .eq("id", d.cuotaId)
    .is("verificado_en", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Abona618: no se pudo verificar la cuota —", error.message);
    return { ok: false, error: "No se pudo marcar la cuota como pagada." };
  }

  // Sin fila = ya estaba verificada. No es un error: se sigue adelante para
  // recalcular el plan, que es justo lo que hace falta en un reintento.
  const yaEstaba = !fila;

  const { data: planFila, error: errorPlan } = await service
    .from("planes_pago")
    .select("id, grupo_id, total_usd, tipo, cantidad, estado, acepto_condiciones_en, condiciones_version")
    .eq("id", planId)
    .maybeSingle();
  const { data: cuotasFilas, error: errorCuotas } = await service.from("cuotas").select(SELECT_CUOTAS).eq("plan_id", planId);

  if (errorPlan || errorCuotas || !planFila) {
    // La cuota puede haber quedado verificada. Se dice con todas las letras,
    // porque el reintento SÍ repara: esta función es idempotente.
    console.error(
      `Abona618: cuota ${d.cuotaId} verificada pero no se pudo recalcular el plan ${planId} — ` +
        `${errorPlan?.message ?? errorCuotas?.message ?? "plan no encontrado"}`
    );
    return { ok: false, error: "El pago quedó registrado, pero no se pudo recalcular el plan. Vuelve a intentarlo." };
  }

  const plan = armarPlan(planFila, cuotasFilas ?? []);
  const saldoCero = plan.saldo <= 0;
  let completo = false;

  if (saldoCero) {
    // Condicionado: el primero en llegar completa el plan y recibe la orden de
    // entregar los QR. El segundo se encuentra el plan ya completado y no
    // vuelve a mandarlos.
    const { data: completado } = await service
      .from("planes_pago")
      .update({ estado: "completado", completado_en: new Date().toISOString() })
      .eq("id", plan.id)
      .neq("estado", "completado")
      .select("id")
      .maybeSingle();
    completo = Boolean(completado);
    plan.estado = "completado";
  } else if (plan.estado === "en_mora") {
    // Se puso al día: sale del rojo en Finanzas y deja de recibir avisos de
    // gracia.
    await service.from("planes_pago").update({ estado: "al_dia" }).eq("id", plan.id);
    plan.estado = "al_dia";
  }

  const cuota = plan.cuotas.find((c) => c.id === d.cuotaId);
  if (!cuota) {
    console.error(`Abona618: la cuota ${d.cuotaId} no aparece en su propio plan ${planId}. REVISAR A MANO.`);
    return { ok: false, error: "El pago quedó registrado, pero el plan quedó inconsistente. Revísalo a mano." };
  }

  return { ok: true, plan, completo, cuota, yaEstaba };
}

/**
 * Anula el plan de una compra. Lo llama Finanzas cuando rechaza o anula la
 * compra entera, y lo llamará el cron cuando se cierre el plazo de gracia.
 *
 * Hace falta porque rechazar una compra devolvía la silla al inventario pero
 * dejaba el plan en `al_dia`, y `contarVipEnPlan` cuenta por estado del plan:
 * cada rechazo quemaba un cupo del tope de VIP para siempre, así que el tope
 * de 100 se iba degradando solo. Y además el plan seguía siendo una
 * obligación viva: el cron de cobranza le reclamaría dinero a alguien cuya
 * compra ya no existe.
 *
 * `motivo` es "vencido" cuando lo cierra el cron por falta de pago y
 * "anulado" cuando lo decide una persona. Los dos liberan el cupo; la
 * diferencia es para los reportes y para el correo que recibe el comprador.
 */
export async function anularPlan(
  service: SupabaseClient,
  d: { grupoId: string | null; por: string | null; motivo: "anulado" | "vencido"; nota?: string }
): Promise<{ anulado: boolean; plan: PlanGuardado | null }> {
  if (!d.grupoId) return { anulado: false, plan: null };

  const plan = await leerPlanPorGrupo(service, d.grupoId);
  if (!plan) return { anulado: false, plan: null };
  if (plan.estado === "anulado" || plan.estado === "vencido") return { anulado: false, plan };

  const { data, error } = await service
    .from("planes_pago")
    .update({
      estado: d.motivo,
      anulado_en: new Date().toISOString(),
      anulado_por: d.por,
      ...(d.nota ? { notas: d.nota } : {}),
    })
    .eq("id", plan.id)
    .not("estado", "in", "(anulado,vencido)")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`Abona618: no se pudo anular el plan ${plan.id} — ${error.message}. El cupo de VIP sigue ocupado.`);
    return { anulado: false, plan };
  }

  return { anulado: Boolean(data), plan: { ...plan, estado: d.motivo } };
}

// ---------------------------------------------------------------- cobranza

/**
 * La lista de trabajo del equipo. Esto es el corazón de la decisión de Anita
 * del 12 de octubre: el cobro de cuotas no se deja en manos del comprador —
 * "lo puedo perder de vista o no lo hacen porque no se acuerdan" — así que el
 * equipo necesita ver, en una sola pantalla y ordenado por urgencia, a quién
 * hay que escribirle hoy y con qué saldo.
 *
 * Sale agrupado por lo que el equipo tiene que HACER con cada grupo, no por
 * estado de base de datos:
 *
 *   porVerificar — ya reportadas: Finanzas tiene que ir al banco y aprobar.
 *   vencenHoy    — hay que escribirle hoy mismo.
 *   proximas     — vencen dentro de los próximos días: recordatorio suave.
 *   enGracia     — ya vencieron y están en los dos días de plazo. Última
 *                  llamada antes de que la entrada se libere.
 *   paraAnular   — se pasó el plazo. Hay que anular y revender.
 */
export type CuotaPorCobrar = {
  cuotaId: string;
  etiqueta: string;
  montoUsd: number;
  montoBs: number | null;
  venceEl: string;
  diasParaVencer: number;
  reportadoEn: string | null;
  canalReporte: CanalReporte | null;
  reportadoPor: string | null;
  nota: string | null;
  // Lo que anotó quien cobró: la pantalla lo muestra para que Finanzas sepa
  // qué monto y qué referencia buscar en el banco.
  metodoPago: string | null;
  referenciaPago: string | null;
  planId: string;
  grupoId: string;
  totalUsd: number;
  pagado: number;
  saldo: number;
  tipo: "vip" | "general";
  cantidad: number;
  estadoPlan: PlanGuardado["estado"];
  compradorNombre: string | null;
  compradorTelefono: string | null;
  compradorEmail: string | null;
};

export type ListaCobranza = {
  porVerificar: CuotaPorCobrar[];
  vencenHoy: CuotaPorCobrar[];
  proximas: CuotaPorCobrar[];
  enGracia: CuotaPorCobrar[];
  paraAnular: CuotaPorCobrar[];
  /** Totales para el encabezado: lo que falta cobrar y de cuántas compras. */
  saldoTotal: number;
  planesActivos: number;
  vipEnPlan: number;
};

const LISTA_VACIA: ListaCobranza = {
  porVerificar: [],
  vencenHoy: [],
  proximas: [],
  enGracia: [],
  paraAnular: [],
  saldoTotal: 0,
  planesActivos: 0,
  vipEnPlan: 0,
};

export async function listaDeCobranza(
  service: SupabaseClient,
  opciones: { hoy?: string; diasProximas?: number } = {}
): Promise<ListaCobranza> {
  const hoy = opciones.hoy ?? hoyEnVenezuela();
  const diasProximas = opciones.diasProximas ?? 10;

  const { data: planes, error } = await service
    .from("planes_pago")
    .select("id, grupo_id, total_usd, tipo, cantidad, estado, acepto_condiciones_en, condiciones_version")
    .in("estado", ["al_dia", "en_mora"]);

  if (error) {
    console.error("Abona618: no se pudo leer la lista de cobranza —", error.message);
    return LISTA_VACIA;
  }
  if (!planes || planes.length === 0) return LISTA_VACIA;

  const ids = planes.map((p) => String(p.id));
  const { data: cuotasFilas, error: errorCuotas } = await service
    .from("cuotas")
    .select(`plan_id, ${SELECT_CUOTAS}`)
    .in("plan_id", ids);
  if (errorCuotas) {
    console.error("Abona618: no se pudieron leer las cuotas de la cobranza —", errorCuotas.message);
    return LISTA_VACIA;
  }

  // Los datos de contacto viven en tickets, que no tiene FK con planes_pago
  // (grupo_id no es único allí). Una consulta y un mapa, en vez de un join.
  const grupos = planes.map((p) => String(p.grupo_id));
  const { data: tickets } = await service
    .from("tickets")
    .select("grupo_id, comprador_nombre, comprador_telefono, comprador_email")
    .in("grupo_id", grupos);

  const contacto = new Map<string, { nombre: string | null; telefono: string | null; email: string | null }>();
  for (const t of tickets ?? []) {
    const g = String(t.grupo_id);
    if (!contacto.has(g)) {
      contacto.set(g, {
        nombre: (t.comprador_nombre as string | null) ?? null,
        telefono: (t.comprador_telefono as string | null) ?? null,
        email: (t.comprador_email as string | null) ?? null,
      });
    }
  }

  const porPlan = new Map<string, Record<string, unknown>[]>();
  for (const c of cuotasFilas ?? []) {
    const k = String(c.plan_id ?? "");
    const lista = porPlan.get(k) ?? [];
    lista.push(c as Record<string, unknown>);
    porPlan.set(k, lista);
  }

  const lista: ListaCobranza = { ...LISTA_VACIA, porVerificar: [], vencenHoy: [], proximas: [], enGracia: [], paraAnular: [] };

  for (const filaPlan of planes) {
    const plan = armarPlan(filaPlan as Record<string, unknown>, porPlan.get(String(filaPlan.id)) ?? []);
    if (plan.saldo <= 0) continue;

    lista.saldoTotal = Math.round((lista.saldoTotal + plan.saldo) * 100) / 100;
    lista.planesActivos++;
    if (plan.tipo === "vip") lista.vipEnPlan += plan.cantidad;

    const quien = contacto.get(plan.grupoId);

    for (const c of plan.cuotas) {
      if (c.verificadoEn) continue;

      const dias = diasEntre(hoy, c.venceEl);
      const item: CuotaPorCobrar = {
        cuotaId: c.id,
        etiqueta: c.etiqueta,
        montoUsd: c.montoUsd,
        montoBs: c.montoBs,
        venceEl: c.venceEl,
        diasParaVencer: dias,
        reportadoEn: c.reportadoEn,
        canalReporte: c.canalReporte,
        reportadoPor: c.reportadoPor,
        nota: c.nota,
        metodoPago: c.metodoPago,
        referenciaPago: c.referenciaPago,
        planId: plan.id,
        grupoId: plan.grupoId,
        totalUsd: plan.totalUsd,
        pagado: plan.pagado,
        saldo: plan.saldo,
        tipo: plan.tipo,
        cantidad: plan.cantidad,
        estadoPlan: plan.estado,
        compradorNombre: quien?.nombre ?? null,
        compradorTelefono: quien?.telefono ?? null,
        compradorEmail: quien?.email ?? null,
      };

      // Lo reportado va aparte de todo lo demás: ahí no hay que llamar a
      // nadie, hay que ir al banco. Es el trabajo de Finanzas, no de Ventas.
      if (c.reportadoEn) {
        lista.porVerificar.push(item);
      } else if (dias > 0) {
        if (dias <= diasProximas) lista.proximas.push(item);
      } else if (dias === 0) {
        lista.vencenHoy.push(item);
      } else if (-dias <= DIAS_GRACIA) {
        lista.enGracia.push(item);
      } else {
        lista.paraAnular.push(item);
      }
    }
  }

  // Lo más urgente primero dentro de cada grupo.
  const porFecha = (a: CuotaPorCobrar, b: CuotaPorCobrar) => a.diasParaVencer - b.diasParaVencer;
  lista.porVerificar.sort((a, b) => (a.reportadoEn ?? "").localeCompare(b.reportadoEn ?? ""));
  lista.vencenHoy.sort(porFecha);
  lista.proximas.sort(porFecha);
  lista.enGracia.sort(porFecha);
  lista.paraAnular.sort(porFecha);

  return lista;
}
