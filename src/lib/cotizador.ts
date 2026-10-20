// Cotizador de cuotas para el equipo de ventas (Anita, 20 oct).
//
// Una vendedora tiene que poder responder en un minuto "¿cuánto pago hoy y
// cuánto después?" para cualquier mezcla de entradas — 2 Preferenciales y 1
// General, por ejemplo — sin hacer cuentas a mano. Las cuentas a mano ya
// costaron plata: el caso Rene Carruyo (venta manual registrada como contado
// cuando era en cuotas) y la tabla del 28 oct que cambia el calendario.
//
// Por eso NO hay reglas propias aquí: cada línea se cotiza con exactamente lo
// mismo que usa el checkout (`cotizarCompra` + `planOfrecible`). Lo que dice
// el cotizador es lo que la web le va a cobrar al cliente, al céntimo, con el
// calendario del día y el tope de VIP en cuotas real.
//
// La web vende UN tipo de entrada por compra, así que una mezcla son varias
// compras, cada una con su plan y su pago. El cotizador lo dice tal cual.
//
// Este archivo es puro (lo usa también la pantalla). La parte que lee la base
// está en cotizador-servidor.ts.

import { etiquetaTipo, MAX_POR_COMPRA, type Tipo } from "@/lib/precios";
import { fechaCorta, usd, type PlanPublico, type SinPlan } from "@/lib/cuotas";
import { convertirABs } from "@/lib/tasa";
import { formatoBs } from "@/lib/formato";

export const TIPOS_COTIZABLES: Tipo[] = ["vip", "preferencial", "general"];

export type Pedido = Partial<Record<Tipo, number>>;

export type LineaCotizada = {
  tipo: Tipo;
  cantidad: number;
  total: number;
  /** Plan de cuotas que la web le ofrecería hoy a esta compra. */
  plan: PlanPublico | null;
  /** Por qué no hay cuotas, si no las hay. */
  sinPlan: SinPlan["motivo"] | null;
  /** Lo que queda a la venta en esa zona ahora mismo. null = no se pudo leer. */
  disponibles: number | null;
};

export type PagoDelDia = { venceEl: string; usd: number; bs: number | null; esHoy: boolean };

export type Cotizacion = {
  hoy: string;
  tasaEurVes: number | null;
  lineas: LineaCotizada[];
  /** Todos los pagos de todas las compras, sumados por fecha. */
  porFecha: PagoDelDia[];
  totalUsd: number;
};

export function validarPedido(pedido: Pedido): { ok: true; lineas: { tipo: Tipo; cantidad: number }[] } | { ok: false; error: string } {
  const lineas: { tipo: Tipo; cantidad: number }[] = [];
  for (const tipo of TIPOS_COTIZABLES) {
    const n = Number(pedido[tipo] ?? 0);
    if (!Number.isInteger(n) || n < 0) return { ok: false, error: "Las cantidades tienen que ser números enteros." };
    if (n > MAX_POR_COMPRA[tipo]) {
      return {
        ok: false,
        error: `${etiquetaTipo(tipo, 2)}: máximo ${MAX_POR_COMPRA[tipo]} por compra. Para más, se cotizan y se compran por separado.`,
      };
    }
    if (n > 0) lineas.push({ tipo, cantidad: n });
  }
  if (lineas.length === 0) return { ok: false, error: "Elige al menos una entrada." };
  return { ok: true, lineas };
}

/** Suma por fecha los pagos de todas las compras. Puro: se prueba solo. */
export function sumarPorFecha(lineas: LineaCotizada[], hoy: string, tasaEurVes: number | null): PagoDelDia[] {
  const mapa = new Map<string, number>();
  for (const l of lineas) {
    // Sin plan, la compra se paga completa hoy.
    const pagos = l.plan ? l.plan.cuotas.map((c) => ({ venceEl: c.venceEl, monto: c.monto })) : [{ venceEl: hoy, monto: l.total }];
    for (const p of pagos) mapa.set(p.venceEl, Math.round(((mapa.get(p.venceEl) ?? 0) + p.monto) * 100) / 100);
  }
  return [...mapa.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([venceEl, monto]) => ({
      venceEl,
      usd: monto,
      bs: tasaEurVes ? convertirABs(monto, tasaEurVes) : null,
      esHoy: venceEl === hoy,
    }));
}

const NOMBRE_PLURAL: Record<Tipo, [string, string]> = {
  vip: ["entrada VIP", "entradas VIP"],
  preferencial: ["entrada Preferencial", "entradas Preferenciales"],
  general: ["entrada General", "entradas Generales"],
};

function nombre(tipo: Tipo, n: number) {
  return `${n} ${NOMBRE_PLURAL[tipo][n === 1 ? 0 : 1]}`;
}

/**
 * El mensaje que la vendedora copia y manda por WhatsApp. Sin días de gracia,
 * sin "3 cuotas" (el número de pagos cambia el 28 oct y la fecha manda), sin
 * "La" delante del nombre. Los bolívares solo para lo de hoy: lo de después se
 * paga a la tasa de ese día.
 */
export function mensajeCotizacion(c: Cotizacion): string {
  const conPlan = c.lineas.filter((l) => l.plan);
  const sinPlan = c.lineas.filter((l) => !l.plan);
  const hoyPago = c.porFecha.find((p) => p.esHoy);
  const partes: string[] = [];

  partes.push("¡Hola! Así queda tu compra para Navidad Vallenata:");
  partes.push("");
  for (const l of c.lineas) {
    if (l.plan) {
      const pagos = l.plan.cuotas
        .map((q) => (q.esInicial ? `hoy ${usd(q.monto)}` : `${fechaCorta(q.venceEl)} ${usd(q.monto)}`))
        .join(" · ");
      partes.push(`• ${nombre(l.tipo, l.cantidad)} (${usd(l.total)}): ${pagos}`);
    } else {
      partes.push(`• ${nombre(l.tipo, l.cantidad)} (${usd(l.total)}): pago completo hoy`);
    }
  }
  partes.push("");

  if (hoyPago) {
    const bs = hoyPago.bs != null ? ` (${formatoBs(hoyPago.bs)} a la tasa BCV de hoy)` : "";
    partes.push(`Total hoy: ${usd(hoyPago.usd)}${bs}.`);
  }
  // Con una sola compra, las fechas ya están en su línea: repetirlas es ruido.
  // Con varias, el cliente quiere saber cuánto junta en cada fecha.
  if (c.lineas.length > 1) {
    for (const p of c.porFecha.filter((x) => !x.esHoy)) {
      partes.push(`Total el ${fechaCorta(p.venceEl)}: ${usd(p.usd)}.`);
    }
    const montosHoy = c.lineas.map((l) => usd(l.plan ? l.plan.inicial : l.total)).join(" y ");
    partes.push(`Son ${c.lineas.length} compras separadas (una por tipo de entrada), así que hoy son ${c.lineas.length} pagos: ${montosHoy}.`);
  }

  if (conPlan.length > 0) {
    partes.push("");
    partes.push(
      "Tu puesto queda apartado a tu nombre con el precio congelado. Las fechas son fijas y puedes adelantar pagos cuando quieras. Las entradas con su QR te llegan al correo cuando completas el último pago."
    );
  }
  if (sinPlan.length > 0 && conPlan.length > 0) {
    partes.push(`${sinPlan.map((l) => nombre(l.tipo, l.cantidad)).join(" y ")}: se paga completo, sin cuotas.`);
  }
  return partes.join("\n");
}
