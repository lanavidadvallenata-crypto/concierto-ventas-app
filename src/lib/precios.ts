import type { SupabaseClient } from "@supabase/supabase-js";

export type Tipo = "vip" | "general";
export type Etapa = "preventa" | "regular";

export const FEE_RATE = 0.1;

// Etapas de precio, en orden. Cada etapa tiene un precio base por tipo y un
// cupo (null = sin límite). Una etapa se agota cuando la cantidad de tickets
// NO rechazados registrados en esa etapa llega al cupo — pendientes y
// verificados cuentan igual (decisión de Anita, 19 sep: el precio se fija al
// comprar; si Finanzas rechaza, el cupo se libera).
//
// Para pasar a "sin preventa", basta con poner cupo 0. Para una segunda etapa,
// agregar otra entrada antes de "regular".
export const ETAPAS: { id: Etapa; nombre: string; base: Record<Tipo, number>; cupo: Record<Tipo, number> | null }[] = [
  { id: "preventa", nombre: "Preventa", base: { vip: 100, general: 20 }, cupo: { vip: 30, general: 50 } },
  { id: "regular", nombre: "Precio regular", base: { vip: 120, general: 30 }, cupo: null },
];

const ETAPA_REGULAR = ETAPAS[ETAPAS.length - 1];

// Precio de lista (regular). Se mantiene por compatibilidad: home, taquilla y
// cualquier pantalla que muestre "desde $X" sin consultar la base.
export const PRECIO_BASE: Record<Tipo, number> = ETAPA_REGULAR.base;

export const MAX_POR_COMPRA: Record<Tipo, number> = { vip: 10, general: 20 };

export function desglosar(base: number) {
  const fee = Math.round(base * FEE_RATE * 100) / 100;
  const total = Math.round((base + fee) * 100) / 100;
  return { base, fee, total };
}

export function calcularTotal(tipo: Tipo, etapa: Etapa = "regular") {
  const e = ETAPAS.find((x) => x.id === etapa) ?? ETAPA_REGULAR;
  return desglosar(e.base[tipo]);
}

export type LineaPrecio = { etapa: Etapa; nombreEtapa: string; base: number; fee: number; total: number };

export type CotizacionCompra = {
  lineas: LineaPrecio[]; // una por ticket, en orden
  total: number;
  fee: number;
  base: number;
  resumen: { etapa: Etapa; nombreEtapa: string; cantidad: number; totalUnitario: number }[];
};

export type DisponibilidadEtapa = { etapa: Etapa; nombreEtapa: string; restante: number | null; totalUnitario: number };

// Cuántos tickets quedan en cada etapa con cupo, por tipo. Lee la base.
export async function disponibilidadEtapas(service: SupabaseClient, tipo: Tipo): Promise<DisponibilidadEtapa[]> {
  const resultado: DisponibilidadEtapa[] = [];
  for (const e of ETAPAS) {
    if (!e.cupo) {
      resultado.push({ etapa: e.id, nombreEtapa: e.nombre, restante: null, totalUnitario: desglosar(e.base[tipo]).total });
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
      resultado.push({ etapa: e.id, nombreEtapa: e.nombre, restante: 0, totalUnitario: desglosar(e.base[tipo]).total });
      continue;
    }
    resultado.push({
      etapa: e.id,
      nombreEtapa: e.nombre,
      restante: Math.max(0, e.cupo[tipo] - (count ?? 0)),
      totalUnitario: desglosar(e.base[tipo]).total,
    });
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
      lineas.push({ etapa: d.etapa, nombreEtapa: d.nombreEtapa, ...desglosarDesdeTotal(d.totalUnitario) });
    }
    faltan -= toma;
  }
  // Si por alguna razón ninguna etapa cubrió (no debería: regular es ilimitada)
  while (faltan > 0) {
    lineas.push({ etapa: "regular", nombreEtapa: ETAPA_REGULAR.nombre, ...desglosarDesdeTotal(disponibilidad[disponibilidad.length - 1]?.totalUnitario ?? 0) });
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

// El total unitario ya incluye fee; recuperamos base y fee para el desglose.
function desglosarDesdeTotal(total: number) {
  const base = Math.round((total / (1 + FEE_RATE)) * 100) / 100;
  const fee = Math.round((total - base) * 100) / 100;
  return { base, fee, total };
}

// Atajo servidor: disponibilidad + cotización en una llamada.
export async function cotizarCompra(service: SupabaseClient, tipo: Tipo, cantidad: number) {
  const disponibilidad = await disponibilidadEtapas(service, tipo);
  return { disponibilidad, cotizacion: cotizar(disponibilidad, cantidad) };
}
