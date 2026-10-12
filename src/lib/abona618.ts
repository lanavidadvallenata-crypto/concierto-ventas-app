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
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
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
