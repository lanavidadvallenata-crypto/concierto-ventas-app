// Abona618 — el plan de pago en cuotas. Única fuente de verdad del reparto,
// igual que precios.ts lo es de los precios: lo usan el checkout, el panel de
// Finanzas, los correos y el cron. Si un monto se calcula en dos sitios, un
// día van a discrepar y el comprador va a ver dos cifras distintas.
//
// Cómo funciona (decidido entre Jose Luis y Anita, 9-12 oct):
//
//   · La inicial es SIEMPRE el 40 % y se paga al comprar.
//   · El 60 % restante se reparte entre las fechas fijas que todavía queden
//     por delante. Las fechas son del evento, no de la compra: 16 y 25 de
//     noviembre para todo el mundo (patrón MD Cash).
//   · El plan NO cierra de golpe: se va encogiendo solo. Quien compra
//     temprano paga en 3; quien compra tarde, en 2; y a menos de 5 días del
//     pago final no hay plan, se vende de contado.
//
// Por qué esas fechas: en Venezuela se cobra los días 15 y último. El 15 de
// noviembre de 2026 cae domingo, así que la cuota 01 es el lunes 16, primer
// día hábil después de la quincena. El pago final es el miércoles 25 y no el
// viernes 27 que había aprobado Jose Luis, porque los dos días de plazo de
// gracia tienen que caer en días de banco: después del 27 solo hay sábado y
// domingo, y la gracia existiría nada más en el papel (Anita, 12 oct).

export const INICIAL = 0.4;

// Fechas civiles de Venezuela, "YYYY-MM-DD", en orden.
export const FECHAS_PAGO = ["2026-11-16", "2026-11-25"] as const;

// Una fecha solo cuenta como cuota si faltan al menos estos días: una cuota
// que vence pasado mañana no es crédito, es una molestia.
export const MARGEN_MIN_DIAS = 5;

// Días de plazo después de cada vencimiento antes de anular, avisando todos
// los días (Anita, 12 oct).
export const DIAS_GRACIA = 2;

// Tope de entradas VIP que pueden estar en plan a la vez, y el número al que
// hay que avisarle a Anita para evaluar si se extiende (Anita, 11 y 12 oct).
export const TOPE_VIP_EN_PLAN = 100;
export const AVISO_TOPE_VIP = 90;

export const MAX_PAGOS = FECHAS_PAGO.length + 1;

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
  esInicial: boolean;
};

export type Plan = {
  hayPlan: true;
  cuotas: Cuota[];
  total: number;
  inicial: number;
  saldo: number; // lo que queda después de la inicial
  fechaTope: string; // vencimiento del último pago
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

/** Las fechas fijas que todavía dan margen suficiente desde `hoy`. */
export function fechasVigentes(hoy: string): string[] {
  return FECHAS_PAGO.filter((f) => diasEntre(hoy, f) >= MARGEN_MIN_DIAS);
}

/** ¿Se puede ofrecer el plan en esta fecha? (sin contar tope VIP ni canal) */
export function hayCuotasDisponibles(hoy: string = hoyEnVenezuela()): boolean {
  return fechasVigentes(hoy).length > 0;
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
    tipo?: "vip" | "general";
    vipEnPlan?: number;
    cantidad?: number;
    /** El tope real sale de la base (abona618_config.tope_vip) para que se
     *  pueda subir sin desplegar; la constante es solo el valor inicial. */
    topeVip?: number;
    /** true salta SOLO el chequeo del tope, para honrar un plan ya pagado
     *  cuando el tope se llenó mientras el comprador iba al banco. El
     *  calendario y el margen mínimo se respetan igual: las cuotas que se
     *  guardan tienen que ser las mismas que el comprador aceptó. */
    ignorarTope?: boolean;
  } = {}
): Plan | SinPlan {
  const { canal, tipo, vipEnPlan, cantidad = 1, topeVip = TOPE_VIP_EN_PLAN, ignorarTope = false } = opciones;

  // Taquilla el día del evento: el plan no aplica, se cobra completo.
  if (canal === "taquilla") return { hayPlan: false, motivo: "taquilla" };

  if (!ignorarTope && tipo === "vip" && vipEnPlan != null && vipEnPlan + cantidad > topeVip) {
    return { hayPlan: false, motivo: "tope_vip" };
  }

  const vigentes = fechasVigentes(hoy);
  if (vigentes.length === 0) return { hayPlan: false, motivo: "sin_margen" };

  // Number.isFinite además de > 0: antes Infinity pasaba el guard y producía
  // un plan entero con montos NaN, que se habrían escrito en la base.
  if (!Number.isFinite(total) || total <= 0) throw new Error(`Total inválido para un plan: ${total}`);

  const resto = 1 - INICIAL;
  const porcentajes = [INICIAL, ...vigentes.map(() => resto / vigentes.length)];
  const montos = repartir(total, porcentajes);

  const cuotas: Cuota[] = porcentajes.map((pc, i) => ({
    orden: i + 1,
    etiqueta: i === 0 ? "Inicial" : i === porcentajes.length - 1 ? "Pago final" : `Cuota 0${i}`,
    porcentaje: pc,
    monto: montos[i],
    venceEl: i === 0 ? hoy : vigentes[i - 1],
    esInicial: i === 0,
  }));

  const fechaTope = vigentes[vigentes.length - 1];

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
export const CONDICIONES_VERSION = "v1";

export const CONDICIONES: string[] = [
  "Tu entrada queda apartada a tu nombre desde que verificamos tu pago inicial. El precio se te congela: no sube aunque suba la tarifa.",
  "El QR de acceso te llega cuando completes el 100 % del pago. Antes de eso no tienes entrada válida para entrar al concierto.",
  `Las fechas de pago son fijas e iguales para todo el mundo: ${FECHAS_PAGO.map((f) => fechaCorta(f)).join(" y ")} de 2026. No se cuentan desde el día de tu compra.`,
  `Después de cada fecha límite tienes ${DIAS_GRACIA} días de plazo para pagar. Te avisamos por correo antes de cada fecha y durante el plazo.`,
  "Si al terminar el plazo falta algo por pagar, anulamos la compra y la entrada se libera para volver a venderse. Lo que ya abonaste no se devuelve.",
  "Puedes adelantar pagos o pagar el total cuando quieras, sin recargo.",
  "El plan de cuotas no aplica en taquilla el día del evento. Ese día la entrada se paga completa.",
  "Los cupos en cuotas de la zona VIP son limitados. Cuando se agotan, VIP se vende solo de contado.",
];
