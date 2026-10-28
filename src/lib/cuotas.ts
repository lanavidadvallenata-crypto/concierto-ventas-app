import type { Tipo } from "@/lib/precios";

// Abona618 — el plan de pago en cuotas. Única fuente de verdad del reparto,
// igual que precios.ts lo es de los precios: lo usan el checkout, el panel de
// Finanzas, los correos y el cron. Si un monto se calcula en dos sitios, un
// día van a discrepar y el comprador va a ver dos cifras distintas.
//
// Cómo funciona (Anita, 28 oct; reemplaza las quincenas del 12 oct):
//
//   · Cada pago vence 14 días después del anterior, contando desde el día de
//     la compra. Si cae sábado o domingo se paga ese día igual: no se corre
//     al lunes (Anita, 28 oct).
//   · Ningún pago puede vencer después del 27 de noviembre.
//   · El plan se encoge solo según cuándo se compre:
//       - caben dos cuotas de 14 días → 3 pagos: 40 % hoy, 30 % y 30 %;
//       - cabe solo una → 2 pagos: 50 % hoy y 50 % a los 14 días;
//       - no cabe ninguna → de contado.
//
// Por qué se dejaron las quincenas (Anita, 28 oct): con fechas fijas del mes,
// quien compraba cerca de una quincena volvía a pagar a los 3 días. El que
// compró el 27 de octubre tenía cuota el 30, y el que compraba el 13 de
// noviembre pagaba otra vez el 16. Con 14 días desde la compra todos tienen
// el mismo plazo, compren el día que compren.
//
// El plazo de gracia NO se le dice al comprador (Anita, 12 oct): si sabe que
// tiene dos días extra, espera hasta el último y pide prórroga. El comprador
// ve su fecha; la gracia la maneja el equipo por dentro.

// Días entre un pago y el siguiente, empezando por el día de la compra.
export const DIAS_ENTRE_PAGOS = 14;

// Límite duro: ningún pago puede vencer después de esta fecha. Ese día todo
// el mundo tiene que estar pagado completo, o perdió lo abonado.
export const TOPE_FINAL = "2026-11-27";

// Pagos en total, contando la inicial. Como máximo tres: la inicial y dos
// cuotas.
export const MAX_PAGOS = 3;

/** Cómo se reparte el total según cuántas cuotas caben después de la
 *  inicial (Anita, 28 oct). Con una sola cuota es mitad y mitad. */
export const REPARTO: Readonly<Record<number, readonly number[]>> = {
  1: [0.5, 0.5],
  2: [0.4, 0.3, 0.3],
};

// Días de plazo después de cada vencimiento antes de anular.
//
// INTERNO. No se le dice al comprador ni aparece en ninguna página ni correo
// suyo (Anita, 12 oct): "si no, esperan hasta el último día y piden más
// prórroga". El comprador ve su fecha de vencimiento y nada más; esto es
// margen operativo para que el equipo lo llame antes de anular.
export const DIAS_GRACIA = 2;

// Tope de entradas VIP que pueden estar en plan a la vez, y el número al que
// hay que avisarle a Anita para evaluar si se extiende (Anita, 11 y 12 oct).
export const TOPE_VIP_EN_PLAN = 100;
export const AVISO_TOPE_VIP = 90;

// ---------------------------------------------------------------- fechas

// Hoy en Venezuela como "YYYY-MM-DD". El servidor corre en UTC y Venezuela
// está en UTC-4: a las 21:00 de Maracaibo ya es el día siguiente en UTC, y una
// cuota se daría por vencida tres horas antes de lo debido. Toda la aritmética
// de este archivo es sobre fechas civiles de Venezuela, nunca sobre Date.
export function hoyEnVenezuela(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

const MS_DIA = 86_400_000;

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function aNumeroDeDia(iso: string): number {
  // Estricto a propósito. Antes bastaba con que las tres partes no fueran 0:
  // "26-11-16" se interpretaba como el año 26 y daba una cuota con 36.490 días
  // de atraso, y "2026-02-30" se convertía en silencio en el 3 de marzo. Una
  // fecha de vencimiento mal leída es dinero que se reclama el día equivocado.
  if (typeof iso !== "string" || !FORMATO_FECHA.test(iso)) {
    throw new Error(`Fecha inválida: ${iso}`);
  }
  const [y, m, d] = iso.split("-").map(Number);
  const dia = Date.UTC(y, m - 1, d) / MS_DIA;
  if (!Number.isInteger(dia)) throw new Error(`Fecha inválida: ${iso}`);
  // Ida y vuelta: atrapa el desborde de mes y día (31 de noviembre, 30 de
  // febrero) sin tener que conocer el calendario.
  if (aIso(dia) !== iso) throw new Error(`Fecha inexistente: ${iso}`);
  return dia;
}

function aIso(dia: number): string {
  return new Date(dia * MS_DIA).toISOString().slice(0, 10);
}

/** Días enteros de `desde` a `hasta`. Negativo si `hasta` ya pasó. */
export function diasEntre(desde: string, hasta: string): number {
  return aNumeroDeDia(hasta) - aNumeroDeDia(desde);
}

export function sumarDias(iso: string, dias: number): string {
  return aIso(aNumeroDeDia(iso) + dias);
}

/** Último día para pagar una cuota sin perder la entrada. */
export function graciaHasta(venceEl: string): string {
  return sumarDias(venceEl, DIAS_GRACIA);
}

/** Día en que se anula y la entrada vuelve al inventario. */
export function liberaEl(venceEl: string): string {
  return sumarDias(venceEl, DIAS_GRACIA + 1);
}

// ---------------------------------------------------------------- reparto

/**
 * Reparte un total en centavos según los porcentajes dados. La suma de las
 * partes es SIEMPRE exacta: el residuo del redondeo cae en el último pago, no
 * en la inicial, para que el comprador vea un 40 % limpio al comprar.
 */
export function repartir(total: number, porcentajes: number[]): number[] {
  if (!Number.isFinite(total)) throw new Error(`Total no finito: ${total}`);
  if (porcentajes.length === 0) throw new Error("Repartir sin porcentajes perdería el total entero.");
  const suma = porcentajes.reduce((s, p) => s + p, 0);
  if (!Number.isFinite(suma) || Math.abs(suma - 1) > 1e-9) {
    // Con porcentajes que no suman 1 el ajuste de abajo puede iterar millones
    // de veces y colgar el worker. Esta función está exportada y corre dentro
    // de server actions: el guard es la diferencia entre un error y una caída.
    throw new Error(`Los porcentajes tienen que sumar 1, suman ${suma}`);
  }
  const centavos = Math.round(total * 100);
  if (centavos < porcentajes.length) {
    // No alcanza para dar un céntimo a cada pago. No puede pasar con los
    // precios reales, pero una cuota de 0 viola el check de la tabla y
    // reventaría la compra entera: mejor fallar aquí y en voz alta.
    throw new Error(`Total demasiado bajo para repartir en ${porcentajes.length} pagos: ${total}`);
  }
  const partes = porcentajes.map((p) => Math.round(centavos * p));
  const residuo = centavos - partes.reduce((s, x) => s + x, 0);
  partes[partes.length - 1] += residuo;

  // El residuo del redondeo puede dejar el último pago en cero o negativo con
  // totales de céntimos: se le quita al pago más grande (que según el plan es
  // la inicial o el pago final) hasta que todos tengan al menos un céntimo.
  for (let i = partes.length - 1; i >= 0; i--) {
    // Con los porcentajes validados arriba, suma(partes) === centavos y
    // centavos >= length, así que siempre hay una parte con 2 o más céntimos y
    // esto termina en menos de `length` vueltas. El tope es por si acaso.
    let vueltas = 0;
    while (partes[i] < 1 && vueltas++ < partes.length) {
      const mayor = partes.indexOf(Math.max(...partes));
      if (mayor === i) break;
      partes[mayor] -= 1;
      partes[i] += 1;
    }
  }
  return partes.map((c) => Math.round(c) / 100);
}

// ---------------------------------------------------------------- el plan

export type Cuota = {
  orden: number; // 1 es siempre la inicial
  etiqueta: string;
  porcentaje: number;
  monto: number;
  venceEl: string; // la inicial vence el día de la compra
  /** Último día para pagar ESTA cuota sin perder la entrada. */
  graciaHasta: string;
  /** Día en que, si esta cuota sigue sin pagarse, se anula la compra entera. */
  liberaEl: string;
  esInicial: boolean;
};

export type Plan = {
  hayPlan: true;
  cuotas: Cuota[];
  total: number;
  inicial: number;
  saldo: number; // lo que queda después de la inicial
  fechaTope: string; // vencimiento del último pago
  /** Gracia y liberación DEL ÚLTIMO pago. Ojo: cada cuota tiene las suyas
   *  (ver Cuota.graciaHasta), y la que importa en cada momento es la de la
   *  próxima cuota por pagar, no esta. */
  graciaHasta: string;
  liberaEl: string;
};

export type SinPlan = {
  hayPlan: false;
  /** apagado: el interruptor de la base está en false, el módulo no existe
   *  para el comprador. sin_margen: ya no queda plazo. taquilla: el día del
   *  evento se cobra completo (Anita, 12 oct). tope_vip: se agotaron los
   *  cupos VIP en plan — es el ÚNICO motivo que el checkout honra cuando el
   *  comprador ya pagó. error: no se pudo leer la base; nunca se honra, porque
   *  un timeout no puede terminar en "vendamos a crédito por si acaso". */
  motivo: "apagado" | "sin_margen" | "taquilla" | "tope_vip" | "error";
};

/**
 * Las fechas de cobro de una compra hecha el día `hoy`: cada 14 días desde la
 * compra, hasta dos cuotas, y ninguna después del 27 de noviembre. Vacío = no
 * hay plan y la entrada se vende de contado.
 *
 * Un fin de semana NO se corre al lunes (Anita, 28 oct): se paga ese día.
 */
export function fechasDelPlan(hoy: string): string[] {
  const fechas: string[] = [];
  for (let i = 1; i < MAX_PAGOS; i++) {
    const fecha = sumarDias(hoy, DIAS_ENTRE_PAGOS * i);
    // Se pasó del límite duro: las siguientes también se pasan.
    if (diasEntre(fecha, TOPE_FINAL) < 0) break;
    fechas.push(fecha);
  }
  return fechas;
}

/** ¿Se puede ofrecer el plan en esta fecha? (sin contar tope VIP ni canal) */
export function hayCuotasDisponibles(hoy: string = hoyEnVenezuela()): boolean {
  return fechasDelPlan(hoy).length > 0;
}

/**
 * El plan para una compra de `total` hecha el día `hoy`.
 *
 * `canal` y `vipEnPlan` son opcionales porque el simulador y los correos
 * calculan montos sin contexto de venta; el checkout sí los pasa.
 */
export function planPara(
  total: number,
  hoy: string = hoyEnVenezuela(),
  opciones: {
    canal?: string;
    tipo?: Tipo;
    vipEnPlan?: number;
    cantidad?: number;
    /** El tope real sale de la base (abona618_config.tope_vip) para que se
     *  pueda subir sin desplegar; la constante es solo el valor inicial. */
    topeVip?: number;
    /** true salta SOLO el chequeo del tope, para honrar un plan ya pagado
     *  cuando el tope se llenó mientras el comprador iba al banco. El
     *  calendario se respeta igual: las cuotas que se guardan tienen que ser
     *  las mismas que el comprador aceptó. */
    ignorarTope?: boolean;
  } = {}
): Plan | SinPlan {
  const { canal, tipo, vipEnPlan, cantidad = 1, topeVip = TOPE_VIP_EN_PLAN, ignorarTope = false } = opciones;

  // El total se valida ANTES de cualquier rama: antes, pasado el corte, un
  // NaN salía como "sin_margen" en silencio en vez de reventar.
  if (!Number.isFinite(total) || total <= 0) throw new Error(`Total inválido para un plan: ${total}`);

  // Taquilla el día del evento: el plan no aplica, se cobra completo.
  if (canal === "taquilla") return { hayPlan: false, motivo: "taquilla" };

  if (!ignorarTope && tipo === "vip" && vipEnPlan != null && vipEnPlan + cantidad > topeVip) {
    return { hayPlan: false, motivo: "tope_vip" };
  }

  const vigentes = fechasDelPlan(hoy);
  if (vigentes.length === 0) return { hayPlan: false, motivo: "sin_margen" };

  return armarPlanConFechas(total, hoy, vigentes);
}

/** Construye el plan: inicial hoy + una cuota por cada fecha, repartido según
 *  REPARTO (40/30/30 con dos cuotas, 50/50 con una). Es lo único que escribe
 *  cuotas, venga el calendario de `fechasDelPlan` o de lo que el comprador
 *  vio. */
function armarPlanConFechas(total: number, hoy: string, fechas: readonly string[]): Plan {
  const reparto = REPARTO[fechas.length];
  if (!reparto) throw new Error(`No hay reparto para ${fechas.length} cuotas`);
  const porcentajes = [...reparto];
  const montos = repartir(total, porcentajes);

  const cuotas: Cuota[] = porcentajes.map((pc, i) => {
    const venceEl = i === 0 ? hoy : fechas[i - 1];
    return {
      orden: i + 1,
      etiqueta: i === 0 ? "Inicial" : i === porcentajes.length - 1 ? "Pago final" : `Cuota 0${i}`,
      porcentaje: pc,
      monto: montos[i],
      venceEl,
      // CADA cuota tiene su propio margen interno y su propia anulación
      // (Anita, 12 oct). No se espera a la fecha final: si falla la primera
      // cuota, la compra se anula ahí y la entrada vuelve a la venta.
      graciaHasta: graciaHasta(venceEl),
      liberaEl: liberaEl(venceEl),
      esInicial: i === 0,
    };
  });

  const fechaTope = fechas[fechas.length - 1];

  return {
    hayPlan: true,
    cuotas,
    total: Math.round(total * 100) / 100,
    inicial: montos[0],
    saldo: Math.round(montos.slice(1).reduce((s, m) => s + m, 0) * 100) / 100,
    fechaTope,
    graciaHasta: graciaHasta(fechaTope),
    liberaEl: liberaEl(fechaTope),
  };
}

/**
 * El plan con EXACTAMENTE las fechas que el comprador vio y aceptó, aunque
 * hoy el calendario diga otra cosa.
 *
 * Entre que ve la pantalla y vuelve con la referencia pasan hasta 15
 * minutos, y si en medio cruzó la medianoche, `planPara` de hoy le da otro
 * calendario (o ninguno): aceptó tres pagos de 56/42/42 y se le guardaba uno
 * de $84 que nunca vio. Esto honra lo que vio, siempre que siga siendo un
 * calendario válido: fechas reales, en orden, ninguna pasada, ninguna después
 * del límite duro, y no más cuotas de las que el plan permite. Si no lo es,
 * devuelve null y se cae al calendario de hoy.
 *
 * NO salta el interruptor ni el tope: eso lo decide quien llama. Esto solo
 * garantiza que un calendario honrado sea un calendario posible.
 */
export function planConFechasVistas(total: number, hoy: string, fechas: string[]): Plan | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (fechas.length === 0 || fechas.length > MAX_PAGOS - 1) return null;
  try {
    for (let i = 0; i < fechas.length; i++) {
      if (diasEntre(hoy, fechas[i]) < 0) return null; // ya pasó
      if (diasEntre(fechas[i], TOPE_FINAL) < 0) return null; // después del límite duro
      if (i > 0 && diasEntre(fechas[i - 1], fechas[i]) <= 0) return null; // fuera de orden o repetida
    }
    return armarPlanConFechas(total, hoy, fechas);
  } catch {
    return null; // alguna fecha malformada: aNumeroDeDia lanza
  }
}

/**
 * Lo que puede viajar al navegador del comprador. Sin `graciaHasta` ni
 * `liberaEl`: el margen interno no se le dice (Anita, 12 oct), y "no decirlo"
 * incluye no mandárselo en un JSON aunque la pantalla no lo pinte. Lo que no
 * se manda no se filtra.
 */
export type CuotaPublica = Pick<Cuota, "orden" | "etiqueta" | "monto" | "venceEl" | "esInicial">;
export type PlanPublico = { hayPlan: true; cuotas: CuotaPublica[]; total: number; inicial: number; saldo: number };

export function aPlanPublico(p: Plan): PlanPublico {
  return {
    hayPlan: true,
    total: p.total,
    inicial: p.inicial,
    saldo: p.saldo,
    cuotas: p.cuotas.map((c) => ({ orden: c.orden, etiqueta: c.etiqueta, monto: c.monto, venceEl: c.venceEl, esInicial: c.esInicial })),
  };
}

// ---------------------------------------------------------------- textos

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "25 de noviembre" */
export function fechaCorta(iso: string): string {
  aNumeroDeDia(iso); // valida: antes "basura" salía como "undefined de undefined"
  const [, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

/** "miércoles 25 de noviembre" */
export function fechaLarga(iso: string): string {
  const dia = new Date(aNumeroDeDia(iso) * MS_DIA).getUTCDay();
  return `${DIAS_SEMANA[dia]} ${fechaCorta(iso)}`;
}

export function usd(monto: number): string {
  return `$${monto.toFixed(2)}`;
}

/** El resumen de una línea que va en el checkout y en el correo. */
export function resumenPlan(plan: Plan): string {
  return plan.cuotas
    .map((c) => `${c.etiqueta} (${Math.round(c.porcentaje * 100)} %): ${usd(c.monto)}` +
      (c.esInicial ? " — al comprar" : ` — hasta el ${fechaCorta(c.venceEl)}`))
    .join("\n");
}

// ---------------------------------------------------------------- condiciones

/**
 * Las condiciones que el comprador acepta con una casilla antes de pagar.
 *
 * Viven aquí y no en la pantalla porque las cita el correo de anulación —
 * "según las condiciones que aceptaste el tal día a tal hora" — y porque la
 * página de la compra las tiene que volver a mostrar tal cual. Una sola
 * fuente: si cambian, cambian en los tres sitios a la vez.
 *
 * Al cambiarlas hay que subir CONDICIONES_VERSION. Cada plan guarda la
 * versión que aceptó su comprador, así que a nadie se le reclama algo que no
 * estaba cuando compró.
 */
export const CONDICIONES_VERSION = "v4";

export const CONDICIONES: string[] = [
  "Tu entrada queda apartada a tu nombre desde que verificamos tu pago inicial. El precio se te congela: no sube aunque suba la tarifa.",
  "El QR de acceso te llega cuando completes el 100 % del pago. Antes de eso no tienes entrada válida para entrar al concierto.",
  "Tus pagos vencen cada 14 días, contando desde el día de tu compra, aunque caigan en fin de semana. Ves todas tus fechas, con su monto, antes de pagar, y te avisamos por correo antes de cada una.",
  `Ninguna de tus fechas de pago es posterior al ${fechaCorta(TOPE_FINAL)} de 2026.`,
  "Si no pagas en la fecha de cualquiera de tus cuotas, anulamos toda la compra: no se espera a la fecha final. Tu entrada vuelve a la venta y lo que ya abonaste no se devuelve.",
  "Puedes adelantar pagos o pagar el total cuando quieras, sin recargo.",
  "El plan de cuotas no aplica en taquilla el día del evento. Ese día la entrada se paga completa.",
  "Los cupos en cuotas de la zona VIP son limitados. Cuando se agotan, VIP se vende solo de contado.",
];
