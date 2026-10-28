import type { SupabaseClient } from "@supabase/supabase-js";

// Los tres tipos de entrada, del más caro al más barato. Preferencial se abrió
// el 13 de octubre (Anita): "solo había entradas muy caras o muy baratas".
// Son mesas redondas entre el VIP y la zona general, a $70 por persona, con
// mesa y silla elegidas en el mapa igual que VIP. Nacieron de 6 puestos; el
// 24 oct pasaron a 8 y a 4 filas (Anita), y el máximo por compra subió a 8
// para que una mesa completa siga saliendo en una sola compra.
export type Tipo = "vip" | "preferencial" | "general";
export type Etapa = "preventa" | "regular";

export const TIPOS: readonly Tipo[] = ["vip", "preferencial", "general"] as const;

/** Las zonas con mesa y silla numerada (viven en mesas_vip / sillas_vip). */
export type Zona = "vip" | "preferencial";

/** ¿Este tipo se vende con silla elegida en el mapa? */
export function conAsiento(tipo: Tipo): tipo is Zona {
  return tipo === "vip" || tipo === "preferencial";
}

export const ETIQUETA_TIPO: Record<Tipo, string> = {
  vip: "VIP",
  preferencial: "Preferencial",
  general: "General",
};

/** "VIP", "Preferencial", "General" / "Generales" según la cantidad. */
export function etiquetaTipo(tipo: Tipo | string, cantidad = 1): string {
  if (tipo === "general") return cantidad === 1 ? "General" : "Generales";
  return ETIQUETA_TIPO[tipo as Tipo] ?? String(tipo);
}

// ---------------------------------------------------------------- compras mixtas
//
// Desde el 28 oct (Anita) una compra hecha en Ventas puede llevar varias
// zonas: "2 Preferenciales y 1 General" con un solo código, un solo pago y un
// solo plan de cuotas. Cada ticket sigue teniendo su propio tipo; lo que
// cambia es cómo se DESCRIBE la compra. Regla de estas funciones: una compra
// de una sola zona se describe exactamente igual que antes, para que nada de
// lo que ya existe cambie ni un carácter.

export type ParteCompra = { tipo: Tipo; cantidad: number };

/** "VIP", "Preferencial" / "Preferenciales", "General" / "Generales". */
function zonaEnPlural(tipo: Tipo, n: number): string {
  if (tipo === "vip") return "VIP";
  if (tipo === "preferencial") return n === 1 ? "Preferencial" : "Preferenciales";
  return n === 1 ? "General" : "Generales";
}

/** Cuántas entradas de cada zona, en orden VIP, Preferencial, General. */
export function partesDe(tipos: readonly (Tipo | string)[]): ParteCompra[] {
  const cuenta = new Map<Tipo, number>();
  for (const t of tipos) if (TIPOS.includes(t as Tipo)) cuenta.set(t as Tipo, (cuenta.get(t as Tipo) ?? 0) + 1);
  return TIPOS.filter((t) => cuenta.has(t)).map((t) => ({ tipo: t, cantidad: cuenta.get(t)! }));
}

/** ¿La compra lleva más de una zona? */
export function esMixta(tipos: readonly (Tipo | string)[]): boolean {
  return partesDe(tipos).length > 1;
}

/** La zona que manda en una compra mixta: VIP si hay, si no Preferencial, si no General. */
export function zonaPrincipal(tipos: readonly (Tipo | string)[]): Tipo {
  return partesDe(tipos)[0]?.tipo ?? ((tipos[0] as Tipo) ?? "general");
}

/** Una compra en una línea. Una sola zona: lo de siempre ("2 × VIP" con
 *  sep " × ", "2 VIP" con sep " "). Varias: "2 Preferenciales + 1 General". */
export function resumenCompra(tipos: readonly (Tipo | string)[], sep = " × "): string {
  const partes = partesDe(tipos);
  if (partes.length <= 1) {
    const tipo = partes[0]?.tipo ?? (tipos[0] as Tipo);
    return `${tipos.length}${sep}${etiquetaTipo(tipo, tipos.length)}`;
  }
  return partes.map((p) => `${p.cantidad} ${zonaEnPlural(p.tipo, p.cantidad)}`).join(" + ");
}

/** Para los correos de una compra mixta: "3 entradas: 2 Preferenciales y
 *  1 General". null si es de una sola zona (el correo dice lo de siempre). */
export function detalleMixto(tipos: readonly (Tipo | string)[]): string | null {
  const partes = partesDe(tipos);
  if (partes.length <= 1) return null;
  const textos = partes.map((p) => `${p.cantidad} ${zonaEnPlural(p.tipo, p.cantidad)}`);
  const lista = `${textos.slice(0, -1).join(", ")} y ${textos[textos.length - 1]}`;
  return `${tipos.length} entradas: ${lista}`;
}

/** Con qué tipo y cantidad se guarda el plan de una compra (planes_pago).
 *  El tope de VIP en cuotas cuenta los planes con tipo "vip" sumando su
 *  cantidad, así que una compra mixta con VIP se guarda como "vip" con SOLO
 *  sus entradas VIP: el tope cuenta exacto. Sin VIP, la zona principal con
 *  su cantidad. Las pantallas describen la compra con sus tickets, no con esto. */
export function tipoParaPlan(partes: readonly ParteCompra[]): ParteCompra {
  const vip = partes.find((p) => p.tipo === "vip");
  if (vip) return { tipo: "vip", cantidad: vip.cantidad };
  const principal = TIPOS.map((t) => partes.find((p) => p.tipo === t)).find(Boolean);
  return principal ?? { tipo: "general", cantidad: 0 };
}

/** "Entrada VIP" / "Entrada Preferencial" / "Entrada General". */
export function nombreEntrada(tipo: Tipo | string): string {
  return `Entrada ${ETIQUETA_TIPO[tipo as Tipo] ?? String(tipo)}`;
}

// Etapas de precio, en orden. Cada etapa tiene un precio base por tipo, su
// propio fee de servicio y un cupo (null = sin límite). Una etapa se agota
// cuando la cantidad de tickets NO rechazados registrados en esa etapa llega
// al cupo — pendientes y verificados cuentan igual (decisión de Anita, 19 sep:
// el precio se fija al comprar; si Finanzas rechaza, el cupo se libera).
//
// El fee es POR ETAPA (Anita, 25 sep). La preventa se anunció con el fee
// aparte y así se queda hasta agotarse: quien vio "$20" en el flyer paga
// $20 + $2 y ve el desglose. El precio regular nuevo ya lo lleva adentro:
// $140 VIP y $30 General son el número final, se muestra uno solo y no se
// habla de fee en ninguna pantalla.
//
// Para pasar a "sin preventa", basta con poner cupo 0. Para una segunda etapa,
// agregar otra entrada antes de "regular".
export const ETAPAS: {
  id: Etapa;
  nombre: string;
  base: Record<Tipo, number>;
  fee: number;
  cupo: Record<Tipo, number> | null;
}[] = [
  // Preferencial nunca tuvo preventa: cupo 0 = va directo a precio regular.
  // General: 50 -> 41 (Anita, 14 oct). La preventa General ya se agotó y no
  // se vuelve a vender. Un grupo pasa 9 entradas de preventa a Preferencial;
  // al anularlas el conteo baja 9 y, con 50, la web habría reabierto 9
  // entradas a $22 sola. Con 41 queda cerrada.
  // 41 -> 40 (Anita, 19 oct): Orianyelis Mercado pasa 1 General de preventa
  // (ref. 602268) a Preferencial en cuotas. Misma lógica: el cupo baja ANTES
  // de anular, para que la web no reabra 1 entrada a $22.
  { id: "preventa", nombre: "Preventa", base: { vip: 100, preferencial: 70, general: 20 }, fee: 0.1, cupo: { vip: 30, preferencial: 0, general: 40 } },
  { id: "regular", nombre: "Precio regular", base: { vip: 140, preferencial: 70, general: 30 }, fee: 0, cupo: null },
];

const ETAPA_REGULAR = ETAPAS[ETAPAS.length - 1];

function buscarEtapa(etapa: Etapa) {
  return ETAPAS.find((x) => x.id === etapa) ?? ETAPA_REGULAR;
}

// Preferencial: una mesa completa (6) como tope por compra (Anita, 13 oct).
export const MAX_POR_COMPRA: Record<Tipo, number> = { vip: 10, preferencial: 8, general: 20 };

/** El máximo de sillas que puede traer una compra con asiento, para validar
 *  entradas sin saber todavía el tipo. */
export const MAX_SILLAS_POR_COMPRA = Math.max(MAX_POR_COMPRA.vip, MAX_POR_COMPRA.preferencial);

export function desglosar(base: number, feeRate: number) {
  const fee = Math.round(base * feeRate * 100) / 100;
  const total = Math.round((base + fee) * 100) / 100;
  return { base, fee, total };
}

export function calcularTotal(tipo: Tipo, etapa: Etapa = "regular") {
  const e = buscarEtapa(etapa);
  return desglosar(e.base[tipo], e.fee);
}

// ¿Esta etapa cobra fee aparte? Las pantallas lo usan para decidir si muestran
// el desglose o un solo precio.
export function etapaTieneFee(etapa: Etapa): boolean {
  return buscarEtapa(etapa).fee > 0;
}

export type LineaPrecio = { etapa: Etapa; nombreEtapa: string; base: number; fee: number; total: number };

export type CotizacionCompra = {
  lineas: LineaPrecio[]; // una por ticket, en orden
  total: number;
  fee: number;
  base: number;
  resumen: { etapa: Etapa; nombreEtapa: string; cantidad: number; totalUnitario: number }[];
};

export type DisponibilidadEtapa = {
  etapa: Etapa;
  nombreEtapa: string;
  restante: number | null;
  baseUnitario: number;
  feeRate: number;
  totalUnitario: number;
};

// Cuántos tickets quedan en cada etapa con cupo, por tipo. Lee la base.
export async function disponibilidadEtapas(service: SupabaseClient, tipo: Tipo): Promise<DisponibilidadEtapa[]> {
  const resultado: DisponibilidadEtapa[] = [];
  for (const e of ETAPAS) {
    const precio = desglosar(e.base[tipo], e.fee);
    const fila = { etapa: e.id, nombreEtapa: e.nombre, baseUnitario: precio.base, feeRate: e.fee, totalUnitario: precio.total };
    if (!e.cupo) {
      resultado.push({ ...fila, restante: null });
      continue;
    }
    const { count, error } = await service
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("tipo", tipo)
      .eq("etapa", e.id)
      .neq("estado_pago", "rechazado");
    if (error) {
      // Si no se puede contar, no regalamos precio de preventa: se trata como agotada.
      console.error("Error contando cupo de etapa:", e.id, error.message);
      resultado.push({ ...fila, restante: 0 });
      continue;
    }
    resultado.push({ ...fila, restante: Math.max(0, e.cupo[tipo] - (count ?? 0)) });
  }
  return resultado;
}

// Cotiza una compra de `cantidad` tickets de un tipo: va llenando etapas en
// orden. Si quedan 3 en preventa y se compran 5, salen 3 a preventa y 2 a
// regular, con el desglose por línea para mostrarlo antes de pagar.
export function cotizar(disponibilidad: DisponibilidadEtapa[], cantidad: number): CotizacionCompra {
  const lineas: LineaPrecio[] = [];
  let faltan = Math.max(0, Math.floor(cantidad));
  for (const d of disponibilidad) {
    if (faltan === 0) break;
    const toma = d.restante === null ? faltan : Math.min(faltan, d.restante);
    for (let i = 0; i < toma; i++) {
      lineas.push({ etapa: d.etapa, nombreEtapa: d.nombreEtapa, ...desglosar(d.baseUnitario, d.feeRate) });
    }
    faltan -= toma;
  }
  // Si por alguna razón ninguna etapa cubrió (no debería: regular es ilimitada)
  const ultima = disponibilidad[disponibilidad.length - 1];
  while (faltan > 0) {
    lineas.push({
      etapa: ultima?.etapa ?? "regular",
      nombreEtapa: ultima?.nombreEtapa ?? ETAPA_REGULAR.nombre,
      ...desglosar(ultima?.baseUnitario ?? 0, ultima?.feeRate ?? 0),
    });
    faltan--;
  }

  const resumenMap = new Map<Etapa, { etapa: Etapa; nombreEtapa: string; cantidad: number; totalUnitario: number }>();
  for (const l of lineas) {
    const r = resumenMap.get(l.etapa) ?? { etapa: l.etapa, nombreEtapa: l.nombreEtapa, cantidad: 0, totalUnitario: l.total };
    r.cantidad += 1;
    resumenMap.set(l.etapa, r);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    lineas,
    total: r2(lineas.reduce((s, l) => s + l.total, 0)),
    fee: r2(lineas.reduce((s, l) => s + l.fee, 0)),
    base: r2(lineas.reduce((s, l) => s + l.base, 0)),
    resumen: [...resumenMap.values()],
  };
}

// Atajo servidor: disponibilidad + cotización en una llamada.
export async function cotizarCompra(service: SupabaseClient, tipo: Tipo, cantidad: number) {
  const disponibilidad = await disponibilidadEtapas(service, tipo);
  return { disponibilidad, cotizacion: cotizar(disponibilidad, cantidad) };
}
