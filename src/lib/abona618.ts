// Abona618 — la capa de datos del plan de cuotas. Todo lo que toca las tablas
// `abona618_config`, `planes_pago` y `cuotas` pasa por aquí: el checkout, el
// panel de Finanzas, la página del comprador y el cron llaman a estas
// funciones y no escriben SQL por su cuenta.
//
// El reparto de montos y las fechas NO viven aquí: viven en cuotas.ts, que es
// puro y está cubierto por el barrido de pruebas. Este archivo solo orquesta.

import type { SupabaseClient } from "@supabase/supabase-js";
import { seleccionarTodo } from "@/lib/db";
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
import type { Tipo } from "@/lib/precios";

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
 * Los tres estados que mantienen una silla fuera del mercado. Vive aquí, en un
 * solo sitio, porque `contarVipEnPlan` (que decide si se ofrece el plan) y
 * `resumenPlanes` (que se lo muestra a Anita) tienen que contar exactamente lo
 * mismo. Si uno de los dos se desfasara, el dashboard diría que quedan cupos
 * mientras el checkout los está negando, o al revés.
 */
export const ESTADOS_OCUPAN_TOPE = ["al_dia", "en_mora", "completado"] as const;

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
    .in("estado", [...ESTADOS_OCUPAN_TOPE]);

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
  d: { tipo: Tipo; cantidad: number; total: number; canal?: string; hoy?: string }
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
  tipo: Tipo;
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
  tipo: Tipo;
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
    tipo: fila.tipo as Tipo,
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

/**
 * El plan de una compra, distinguiendo "no tiene plan" de "no pude leerlo".
 *
 * La diferencia es la que decide si se entrega una entrada. `verificarPago`
 * trata "sin plan" como una compra de contado y manda el QR; si un timeout de
 * la base se confundiera con "sin plan", quien pagó el 40 % recibiría su
 * entrada. Esta función es la que lo impide: ante cualquier error devuelve
 * `ok: false`, y quien toma decisiones de dinero tiene que leer ese campo.
 */
export async function leerPlanPorGrupoEstricto(
  service: SupabaseClient,
  grupoId: string
): Promise<{ ok: true; plan: PlanGuardado | null } | { ok: false; error: string }> {
  const { data: plan, error } = await service
    .from("planes_pago")
    .select("id, grupo_id, total_usd, tipo, cantidad, estado, acepto_condiciones_en, condiciones_version")
    .eq("grupo_id", grupoId)
    .maybeSingle();

  if (error) {
    console.error("Abona618: no se pudo leer el plan —", error.message);
    return { ok: false, error: error.message };
  }
  if (!plan) return { ok: true, plan: null };

  const { data: cuotas, error: errorCuotas } = await service.from("cuotas").select(SELECT_CUOTAS).eq("plan_id", plan.id);
  if (errorCuotas) {
    console.error("Abona618: no se pudieron leer las cuotas —", errorCuotas.message);
    return { ok: false, error: errorCuotas.message };
  }

  if (!cuotas || cuotas.length === 0) {
    console.error(
      `Abona618: el plan ${plan.id} (grupo ${grupoId}) NO TIENE CUOTAS. Queda con saldo completo y hay que ` +
        "arreglarlo a mano: ni el comprador ni Finanzas pueden pagarlo así."
    );
  }

  return { ok: true, plan: armarPlan(plan as Record<string, unknown>, (cuotas ?? []) as Record<string, unknown>[]) };
}

/**
 * El plan de una compra, o null. OJO: null significa "no hay plan" O "no se
 * pudo leer". Sirve para pantallas y acciones que ante la duda NO hacen nada
 * (registrar, anular, mostrar). Para decidir si se entrega una entrada se usa
 * `leerPlanPorGrupoEstricto` o `planConSaldo`, que sí distinguen el error.
 */
export async function leerPlanPorGrupo(service: SupabaseClient, grupoId: string): Promise<PlanGuardado | null> {
  const r = await leerPlanPorGrupoEstricto(service, grupoId);
  return r.ok ? r.plan : null;
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
export type EstadoDelCandado =
  /** La compra no tiene plan: es de contado, se entrega al verificar. */
  | { estado: "sin_plan" }
  /** Tiene plan y todavía debe: el candado está puesto. */
  | { estado: "con_saldo"; plan: PlanGuardado }
  /** Tiene plan y ya pagó todo: se puede entregar. */
  | { estado: "pagado"; plan: PlanGuardado }
  /** No se pudo leer. NUNCA se trata como "sin plan": un timeout no puede
   *  terminar en una entrada entregada con el 60 % sin pagar. */
  | { estado: "error"; error: string };

export async function planConSaldo(service: SupabaseClient, grupoId: string | null): Promise<EstadoDelCandado> {
  if (!grupoId) return { estado: "sin_plan" };
  const r = await leerPlanPorGrupoEstricto(service, grupoId);
  if (!r.ok) return { estado: "error", error: r.error };
  if (!r.plan) return { estado: "sin_plan" };
  return r.plan.saldo > 0 ? { estado: "con_saldo", plan: r.plan } : { estado: "pagado", plan: r.plan };
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
    // Condicionado dos veces. Por `estado in (al_dia, en_mora)`: solo un plan
    // VIVO se completa, así que si alguien lo anuló mientras esta cuota se
    // verificaba, no se completa un plan cuya silla ya volvió a la venta (la
    // base además lo prohíbe con el check completado_no_anulado). Y como el
    // primero en llegar lo cambia de estado, el segundo no recibe `completo` y
    // los QR salen una sola vez.
    const { data: completado, error: errorCompletar } = await service
      .from("planes_pago")
      .update({ estado: "completado", completado_en: new Date().toISOString() })
      .eq("id", plan.id)
      .in("estado", ["al_dia", "en_mora"])
      .select("id")
      .maybeSingle();

    if (errorCompletar) {
      // Se dice en voz alta: el dinero quedó cobrado y el plan no se cerró.
      // El reintento repara, porque la cuota ya está verificada y esto se
      // vuelve a intentar desde el principio.
      console.error(`Abona618: plan ${plan.id} pagado al 100 % pero no se pudo marcar completado —`, errorCompletar.message);
      return { ok: false, error: "El pago quedó registrado, pero no se pudo cerrar el plan. Vuelve a intentarlo." };
    }

    if (completado) {
      completo = true;
      plan.estado = "completado";
    } else if (plan.estado === "completado") {
      // Ya lo había cerrado otra persona (o un intento anterior): no es error,
      // pero la entrega de los QR ya no es de esta llamada.
      completo = false;
    } else {
      // Ni se cerró ni estaba cerrado: lo anularon en medio. Pagó todo y su
      // silla ya es de otro. No hay salida automática buena; se frena aquí.
      console.error(`Abona618: plan ${plan.id} pagado al 100 % pero quedó en estado ${plan.estado}. REVISAR A MANO.`);
      return {
        ok: false,
        error: "El pago quedó registrado, pero esta compra fue anulada mientras se verificaba. Hay que revisarla a mano antes de entregar nada.",
      };
    }
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
 * Finanzas no encontró en el banco un pago que alguien anotó. La cuota vuelve
 * a estar "sin reportar": recupera su fecha, vuelve a su caja de cobranza y
 * el cron le vuelve a escribir.
 *
 * Hace falta porque sin esto un reporte equivocado — o inventado — congelaba
 * la entrada para siempre: `reportado_en` no se limpiaba en ningún sitio,
 * la cuota caía en "por confirmar" sin mirar la fecha, el cron la daba por
 * pagada y la pantalla decía "a esta persona no hay que cobrarle nada". Una
 * referencia de seis dígitos cualquiera sacaba una silla del inventario
 * hasta el día del evento, y nadie tenía un botón para deshacerlo.
 *
 * Deja rastro: la referencia y el método que se rechazan quedan en la nota,
 * con quién lo rechazó y por qué. Lo verificado no se toca.
 */
export async function rechazarReporte(
  service: SupabaseClient,
  d: { cuotaId: string; por: string; motivo: string }
): Promise<{ ok: true; etiqueta: string } | { ok: false; error: string }> {
  const { data: cuota, error } = await service
    .from("cuotas")
    .select("id, etiqueta, reportado_en, verificado_en, metodo_pago, referencia_pago, monto_bs, nota")
    .eq("id", d.cuotaId)
    .maybeSingle();
  if (error) {
    console.error("Abona618: no se pudo leer la cuota a rechazar —", error.message);
    return { ok: false, error: "No se pudo leer la cuota. Intenta de nuevo." };
  }
  if (!cuota) return { ok: false, error: "No encontramos esa cuota." };
  if (cuota.verificado_en) return { ok: false, error: "Esa cuota ya está cobrada y confirmada: no se puede rechazar." };
  if (!cuota.reportado_en) return { ok: false, error: "Esa cuota no tiene ningún pago anotado." };

  const rastro =
    `Reporte rechazado por Finanzas el ${new Date().toISOString().slice(0, 10)}: ${d.motivo.trim()}. ` +
    `Lo anotado era ${String(cuota.metodo_pago ?? "?")} ref. ${String(cuota.referencia_pago ?? "?")}` +
    (cuota.monto_bs != null ? ` por Bs ${Number(cuota.monto_bs).toFixed(2)}` : "") +
    ".";
  const nota = [cuota.nota, rastro].filter(Boolean).join(" ");

  const { data: fila, error: errorUpdate } = await service
    .from("cuotas")
    .update({
      reportado_en: null,
      reportado_por: null,
      canal_reporte: null,
      metodo_pago: null,
      referencia_pago: null,
      monto_bs: null,
      tasa_aplicada: null,
      nota,
    })
    .eq("id", d.cuotaId)
    .is("verificado_en", null)
    .select("id")
    .maybeSingle();
  if (errorUpdate) {
    console.error("Abona618: no se pudo rechazar el reporte —", errorUpdate.message);
    return { ok: false, error: "No se pudo rechazar el reporte. Intenta de nuevo." };
  }
  if (!fila) return { ok: false, error: "Esa cuota cambió mientras la revisabas. Recarga la pantalla." };
  return { ok: true, etiqueta: String(cuota.etiqueta) };
}

/**
 * Anula el plan de una compra. Lo llama una PERSONA de Finanzas cuando rechaza
 * o anula la compra entera. El cron no anula nunca (Anita, 12 oct): detecta,
 * marca en mora y avisa; el botón lo aprieta alguien.
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
  tipo: Tipo;
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
  /** Las que vencen más allá de la ventana de "próximas". No hay que
   *  llamarlas todavía, pero tienen que poder encontrarse: las condiciones
   *  permiten adelantar pagos, y si alguien adelanta y el equipo no puede
   *  anotarlo, la promesa no vale nada. */
  masAdelante: CuotaPorCobrar[];
  /** Las cuotas YA COBRADAS de cada compra, por grupo_id. La pantalla las
   *  muestra dentro de la tarjeta de cada persona: sin ellas, el equipo ve lo
   *  que falta pero no lo que ya pagó, y no puede saber si le escribe o no. */
  pagadasPorGrupo: Record<string, { etiqueta: string; montoUsd: number; referencia?: string | null }[]>;
  /** true = no se pudo leer la base. La pantalla y el cron tienen que
   *  distinguirlo de "no hay nada que cobrar": un cero que parece
   *  tranquilizador es peor que un error visible. */
  error: boolean;
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
  masAdelante: [],
  pagadasPorGrupo: {},
  error: false,
  saldoTotal: 0,
  planesActivos: 0,
  vipEnPlan: 0,
};
const LISTA_CON_ERROR: ListaCobranza = { ...LISTA_VACIA, error: true };

export async function listaDeCobranza(
  service: SupabaseClient,
  opciones: { hoy?: string; diasProximas?: number } = {}
): Promise<ListaCobranza> {
  const hoy = opciones.hoy ?? hoyEnVenezuela();
  const diasProximas = opciones.diasProximas ?? 10;

  // Las tres lecturas van paginadas con `seleccionarTodo`: PostgREST corta
  // en 1.000 filas sin avisar (ver db.ts), y con 3 cuotas por plan eso son
  // ~334 compras. Pasado ese punto, sin paginar, los deudores desaparecían de
  // la pantalla y del cron en silencio, y un plan podía volver partido con el
  // saldo mal calculado.
  const { data: planes, error } = await seleccionarTodo<Record<string, unknown>>(
    service,
    "planes_pago",
    "id, grupo_id, total_usd, tipo, cantidad, estado, acepto_condiciones_en, condiciones_version",
    (q) => q.in("estado", ["al_dia", "en_mora"]).order("id")
  );
  if (error) {
    console.error("Abona618: no se pudo leer la lista de cobranza —", error);
    return LISTA_CON_ERROR;
  }
  if (planes.length === 0) return LISTA_VACIA;

  const ids = planes.map((p) => String(p.id));
  const { data: cuotasFilas, error: errorCuotas } = await seleccionarTodo<Record<string, unknown>>(
    service,
    "cuotas",
    `plan_id, ${SELECT_CUOTAS}`,
    (q) => q.in("plan_id", ids).order("id")
  );
  if (errorCuotas) {
    console.error("Abona618: no se pudieron leer las cuotas de la cobranza —", errorCuotas);
    return LISTA_CON_ERROR;
  }

  // Los datos de contacto viven en tickets, que no tiene FK con planes_pago
  // (grupo_id no es único allí). Una consulta y un mapa, en vez de un join.
  const grupos = planes.map((p) => String(p.grupo_id));
  const { data: tickets, error: errorTickets } = await seleccionarTodo<Record<string, unknown>>(
    service,
    "tickets",
    "grupo_id, comprador_nombre, comprador_telefono, comprador_email",
    (q) => q.in("grupo_id", grupos).order("id")
  );
  if (errorTickets) {
    // Sin contacto no se puede cobrar: mejor decirlo que listar a todo el
    // mundo como "sin teléfono ni correo".
    console.error("Abona618: no se pudieron leer los contactos de la cobranza —", errorTickets);
    return LISTA_CON_ERROR;
  }

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
  for (const c of cuotasFilas) {
    const k = String(c.plan_id ?? "");
    const lista = porPlan.get(k) ?? [];
    lista.push(c as Record<string, unknown>);
    porPlan.set(k, lista);
  }

  const lista: ListaCobranza = {
    ...LISTA_VACIA,
    porVerificar: [],
    vencenHoy: [],
    proximas: [],
    enGracia: [],
    paraAnular: [],
    masAdelante: [],
    pagadasPorGrupo: {},
    error: false,
  };

  for (const filaPlan of planes) {
    const plan = armarPlan(filaPlan as Record<string, unknown>, porPlan.get(String(filaPlan.id)) ?? []);
    if (plan.saldo <= 0) continue;

    lista.saldoTotal = Math.round((lista.saldoTotal + plan.saldo) * 100) / 100;
    lista.planesActivos++;
    if (plan.tipo === "vip") lista.vipEnPlan += plan.cantidad;

    const quien = contacto.get(plan.grupoId);

    const pagadas = plan.cuotas
      .filter((c) => c.verificadoEn)
      // La referencia va para que el buscador de Cobranza encuentre a alguien
      // por la referencia de un pago ya confirmado (la de la inicial, casi siempre).
      .map((c) => ({ etiqueta: c.etiqueta, montoUsd: c.montoUsd, referencia: c.referenciaPago }));
    if (pagadas.length > 0) lista.pagadasPorGrupo[plan.grupoId] = pagadas;

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
        else lista.masAdelante.push(item);
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
  lista.masAdelante.sort(porFecha);

  return lista;
}

// ===========================================================================
// El resumen para el dashboard.
//
// Nace de dos números que el dashboard estaba dando mal desde que existe el
// módulo: sumaba el total de la compra en "esperando verificación" cuando solo
// había entrado el 40 %, y no contaba como recaudada la inicial que sí estaba
// en el banco. Sobreestimaba lo pendiente y subestimaba lo cobrado al mismo
// tiempo.
// ===========================================================================

/** Cuántos días hacia adelante cuentan como "esto se cobra ya". */
export const VENTANA_PROXIMAS_DIAS = 7;

export type ResumenPlanes = {
  /** true cuando alguna de las dos lecturas falló. Los números que vienen al
   *  lado NO son confiables y la pantalla tiene que decirlo: un cero que
   *  parece tranquilizador es peor que un error visible. Mismo criterio que
   *  `leerConfig`. */
  error: boolean;
  hayPlanes: boolean;

  /** Planes que todavía deben plata. Aquí vive el riesgo. */
  enCurso: {
    compras: number;
    entradas: number;
    /** Lo que valen esas compras a precio completo. */
    valorUsd: number;
    /** Cuotas ya verificadas: plata en el banco que el recaudado normal NO ve,
     *  porque los tickets de un plan siguen en `pendiente` hasta el final. */
    cobradoUsd: number;
    porCobrarUsd: number;
  };

  /** Cuotas de planes en curso cuya fecha ya pasó y nadie verificó. Si esto
   *  no es cero, hay trabajo atrasado en Cobranza. */
  vencidoSinCobrarUsd: number;
  /** Cuotas que vencen dentro de la ventana. Lo que viene. */
  proximoUsd: number;

  /** Pagaron el 100 %. Sus tickets ya están verificados, así que su plata YA
   *  está contada en el recaudado de siempre. No se suma a `cobradoUsd` ni al
   *  total en banco: sería contarla dos veces. */
  completados: { compras: number; entradas: number; valorUsd: number };

  /** Planes muertos y lo que quedó abonado. En los vencidos ese dinero se
   *  queda (es la regla que el comprador aceptó). Los anulados los decidió
   *  una persona de Finanzas y hay que mirarlos caso por caso: puede ser una
   *  compra duplicada o una devolución. */
  caidos: { vencidos: number; anulados: number; abonadoUsd: number };

  vip: { enPlan: number; tope: number; aviso: number };

  /** `tickets.grupo_id` de las compras con plan en curso. El dashboard los
   *  necesita para NO sumar el total de esas compras en "esperando
   *  verificación": de una compra de $140 en plan solo entraron $56, y los
   *  tickets siguen en `pendiente` hasta que se complete. */
  gruposEnCurso: string[];
};

const centavos = (n: number) => Math.round(n * 100) / 100;

function resumenVacio(config: Config, error: boolean): ResumenPlanes {
  return {
    error,
    hayPlanes: false,
    enCurso: { compras: 0, entradas: 0, valorUsd: 0, cobradoUsd: 0, porCobrarUsd: 0 },
    vencidoSinCobrarUsd: 0,
    proximoUsd: 0,
    completados: { compras: 0, entradas: 0, valorUsd: 0 },
    caidos: { vencidos: 0, anulados: 0, abonadoUsd: 0 },
    vip: { enPlan: 0, tope: config.topeVip, aviso: config.avisoTopeVip },
    gruposEnCurso: [],
  };
}

type FilaPlan = { id: string; grupo_id: string; estado: string; tipo: string; cantidad: number; total_usd: number | string };
type FilaCuota = { plan_id: string; monto_usd: number | string; vence_el: string; verificado_en: string | null };

/**
 * Todo lo que el dashboard necesita saber de los planes, en dos lecturas
 * paginadas. Se agrega en memoria y no en SQL a propósito: son decenas de
 * filas, la lógica queda cubierta por pruebas y no hay que mantener una vista
 * en la base que se desfase del código.
 */
export async function resumenPlanes(
  service: SupabaseClient,
  config: Config,
  hoy: string = hoyEnVenezuela()
): Promise<ResumenPlanes> {
  const [planes, cuotas] = await Promise.all([
    seleccionarTodo<FilaPlan>(service, "planes_pago", "id, grupo_id, estado, tipo, cantidad, total_usd"),
    seleccionarTodo<FilaCuota>(service, "cuotas", "plan_id, monto_usd, vence_el, verificado_en"),
  ]);

  if (planes.error || cuotas.error) {
    console.error("Abona618: no se pudo armar el resumen —", planes.error ?? cuotas.error);
    return resumenVacio(config, true);
  }
  if (planes.data.length === 0) return resumenVacio(config, false);

  // Cuotas agrupadas por plan, ya clasificadas por lo único que importa aquí:
  // si la plata entró, si se pasó la fecha, o si está por venir.
  const porPlan = new Map<string, { cobrado: number; vencido: number; proximo: number }>();
  for (const c of cuotas.data) {
    const planId = String(c.plan_id);
    const acc = porPlan.get(planId) ?? { cobrado: 0, vencido: 0, proximo: 0 };
    const monto = Number(c.monto_usd);
    if (!Number.isFinite(monto)) continue;
    if (c.verificado_en) {
      acc.cobrado += monto;
    } else {
      // Fechas civiles de Venezuela comparadas como texto YYYY-MM-DD: el
      // servidor corre en UTC y a las 8 p. m. de Maracaibo ya es "mañana"
      // allá. Comparar objetos Date aquí adelantaría un día los vencimientos.
      const dias = diasEntre(hoy, String(c.vence_el));
      if (dias < 0) acc.vencido += monto;
      else if (dias <= VENTANA_PROXIMAS_DIAS) acc.proximo += monto;
    }
    porPlan.set(planId, acc);
  }

  const r = resumenVacio(config, false);
  r.hayPlanes = true;

  for (const p of planes.data) {
    const cant = Number(p.cantidad) || 0;
    const total = Number(p.total_usd) || 0;
    const c = porPlan.get(String(p.id)) ?? { cobrado: 0, vencido: 0, proximo: 0 };

    if ((ESTADOS_OCUPAN_TOPE as readonly string[]).includes(p.estado) && p.tipo === "vip") {
      r.vip.enPlan += cant;
    }

    if (p.estado === "al_dia" || p.estado === "en_mora") {
      r.enCurso.compras += 1;
      r.enCurso.entradas += cant;
      r.enCurso.valorUsd += total;
      r.enCurso.cobradoUsd += c.cobrado;
      r.vencidoSinCobrarUsd += c.vencido;
      r.proximoUsd += c.proximo;
      if (p.grupo_id) r.gruposEnCurso.push(String(p.grupo_id));
    } else if (p.estado === "completado") {
      r.completados.compras += 1;
      r.completados.entradas += cant;
      r.completados.valorUsd += total;
    } else if (p.estado === "vencido" || p.estado === "anulado") {
      if (p.estado === "vencido") r.caidos.vencidos += 1;
      else r.caidos.anulados += 1;
      r.caidos.abonadoUsd += c.cobrado;
    }
  }

  r.enCurso.valorUsd = centavos(r.enCurso.valorUsd);
  r.enCurso.cobradoUsd = centavos(r.enCurso.cobradoUsd);
  r.enCurso.porCobrarUsd = centavos(r.enCurso.valorUsd - r.enCurso.cobradoUsd);
  r.vencidoSinCobrarUsd = centavos(r.vencidoSinCobrarUsd);
  r.proximoUsd = centavos(r.proximoUsd);
  r.completados.valorUsd = centavos(r.completados.valorUsd);
  r.caidos.abonadoUsd = centavos(r.caidos.abonadoUsd);

  return r;
}

// ---------------------------------------------------------------------------
// Planes caídos, uno por uno (Anita, 17 oct: "en el dashboard, donde dice
// caídos, necesito ver los detalles"). El resumen solo da cuántos y cuánto
// quedó abonado; aquí va quién, qué compró, cuánto pagó, cuándo se cayó,
// quién lo anuló y por qué. Solo lectura.
// ---------------------------------------------------------------------------
export type PlanCaido = {
  grupoId: string;
  estado: "vencido" | "anulado";
  tipo: string;
  cantidad: number;
  totalUsd: number;
  abonadoUsd: number;
  creadoEn: string | null;
  anuladoEn: string | null;
  anuladoPor: string | null;
  notas: string | null;
  compradorNombre: string | null;
  compradorEmail: string | null;
  compradorTelefono: string | null;
};

export async function listarCaidos(service: SupabaseClient): Promise<{ caidos: PlanCaido[]; error: string | null }> {
  const planes = await seleccionarTodo<Record<string, unknown>>(
    service,
    "planes_pago",
    "id, grupo_id, estado, tipo, cantidad, total_usd, creado_en, anulado_en, anulado_por, notas",
    (q) => q.in("estado", ["vencido", "anulado"])
  );
  if (planes.error) return { caidos: [], error: planes.error };
  if (planes.data.length === 0) return { caidos: [], error: null };

  const planIds = planes.data.map((p) => String(p.id));
  const grupoIds = planes.data.map((p) => String(p.grupo_id));
  const [cuotas, tickets] = await Promise.all([
    seleccionarTodo<Record<string, unknown>>(service, "cuotas", "plan_id, monto_usd, verificado_en", (q) => q.in("plan_id", planIds)),
    seleccionarTodo<Record<string, unknown>>(
      service,
      "tickets",
      "grupo_id, comprador_nombre, comprador_email, comprador_telefono",
      (q) => q.in("grupo_id", grupoIds)
    ),
  ]);
  if (cuotas.error || tickets.error) return { caidos: [], error: cuotas.error ?? tickets.error };

  const abonado = new Map<string, number>();
  for (const c of cuotas.data) {
    if (!c.verificado_en) continue;
    const monto = Number(c.monto_usd);
    if (!Number.isFinite(monto)) continue;
    abonado.set(String(c.plan_id), (abonado.get(String(c.plan_id)) ?? 0) + monto);
  }
  const comprador = new Map<string, Record<string, unknown>>();
  for (const t of tickets.data) if (!comprador.has(String(t.grupo_id))) comprador.set(String(t.grupo_id), t);

  const caidos: PlanCaido[] = planes.data.map((p) => {
    const t = comprador.get(String(p.grupo_id));
    return {
      grupoId: String(p.grupo_id),
      estado: p.estado === "vencido" ? "vencido" : "anulado",
      tipo: String(p.tipo),
      cantidad: Number(p.cantidad) || 0,
      totalUsd: centavos(Number(p.total_usd) || 0),
      abonadoUsd: centavos(abonado.get(String(p.id)) ?? 0),
      creadoEn: (p.creado_en as string | null) ?? null,
      anuladoEn: (p.anulado_en as string | null) ?? null,
      anuladoPor: (p.anulado_por as string | null) ?? null,
      notas: (p.notas as string | null) ?? null,
      compradorNombre: (t?.comprador_nombre as string | null) ?? null,
      compradorEmail: (t?.comprador_email as string | null) ?? null,
      compradorTelefono: (t?.comprador_telefono as string | null) ?? null,
    };
  });
  // Lo más reciente primero.
  caidos.sort((a, b) => (b.anuladoEn ?? b.creadoEn ?? "").localeCompare(a.anuladoEn ?? a.creadoEn ?? ""));
  return { caidos, error: null };
}
