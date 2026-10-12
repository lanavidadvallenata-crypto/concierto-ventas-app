// Helpers de presentación compartidos por las pantallas internas.

export function haceCuanto(iso: string, ahora: number = Date.now()): string {
  const diff = Math.max(0, ahora - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

export function horaCaracas(iso: string): string {
  return new Date(iso).toLocaleString("es-VE", {
    timeZone: "America/Caracas",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const ETIQUETA_METODO: Record<string, string> = {
  pago_movil: "Pago móvil",
  transferencia: "Transferencia",
  zelle: "Zelle",
  binance: "Binance",
  efectivo_usd: "Efectivo $",
  efectivo_bs: "Efectivo Bs",
  cortesia: "Sin pago",
};

export const METODOS_EN_BS = new Set(["pago_movil", "transferencia", "efectivo_bs"]);

export const ETIQUETA_CANAL: Record<string, string> = {
  web: "Compra web",
  manual: "Venta manual",
  taquilla: "Taquilla",
  patrocinio: "Patrocinio",
  cortesia: "Cortesía",
};

export function formatoBs(monto: number): string {
  return `Bs ${monto.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatoUsd(monto: number): string {
  return `$${monto.toFixed(2)}`;
}

// Un bolívar ESTIMADO no es un bolívar cobrado, y mezclarlos cuesta plata.
//
// Lo que ya se pagó tiene un monto en Bs real guardado: lo que la persona
// transfirió ese día, a la tasa de ese día. Ese número no cambia nunca.
//
// Lo que falta por pagar NO tiene monto en Bs. Solo se puede estimar a la tasa
// de hoy, y en noviembre la tasa va a ser otra. Por eso todo monto estimado
// sale con "≈" y con la advertencia de que se recalcula el día del pago: si a
// alguien se le dice "debes Bs 3.240" y paga eso tres semanas después, paga de
// menos, y el reclamo le llega a 6.18.
//
// La deuda siempre es en dólares. El bolívar es una ayuda para transferir.
export function formatoBsAprox(monto: number): string {
  return `≈ ${formatoBs(monto)}`;
}

/** Lo que se le dice a la gente al lado de un monto estimado en bolívares. */
export const NOTA_TASA = "tasa BCV euro de hoy · el monto en Bs se recalcula el día que pagues";

/** Para las pantallas internas, donde el equipo ya sabe de qué va. */
export const NOTA_TASA_CORTA = "estimado a la tasa BCV euro de hoy";

/** Cuando no hay tasa: nunca un número inventado, siempre esta frase. */
export const SIN_TASA = "tasa del día no disponible";

/**
 * Lee un monto en bolívares tal como lo escribe una persona en Venezuela:
 * "12.500", "12.500,00", "12500,5", "12500.50". Devuelve null si no se
 * entiende.
 *
 * Antes se hacía `Number(texto.replace(",", "."))`, y "12.500" (doce mil
 * quinientos) se guardaba como 12,5 — tres órdenes de magnitud de error, en
 * silencio, en el número con el que se cuadra el banco.
 *
 * Regla: si hay coma Y punto, el ÚLTIMO de los dos es el separador decimal y
 * el otro es de miles. Si solo hay uno, es decimal salvo que esté seguido de
 * exactamente tres dígitos y no sea el único grupo ("12.500" → miles;
 * "12.5" → decimal; "0.500" → decimal, porque "0" no es un grupo de miles).
 */
export function parsearMontoBs(texto: string): number | null {
  const t = texto.trim().replace(/\s|Bs\.?/gi, "");
  if (!t) return null;
  if (!/^[0-9.,]+$/.test(t)) return null;

  const ultimaComa = t.lastIndexOf(",");
  const ultimoPunto = t.lastIndexOf(".");
  let entero: string;
  let decimal = "";

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    const sep = Math.max(ultimaComa, ultimoPunto);
    entero = t.slice(0, sep).replace(/[.,]/g, "");
    decimal = t.slice(sep + 1);
  } else if (ultimaComa >= 0 || ultimoPunto >= 0) {
    const sep = Math.max(ultimaComa, ultimoPunto);
    const antes = t.slice(0, sep);
    const despues = t.slice(sep + 1);
    const otrosSeparadores = (t.match(/[.,]/g) ?? []).length - 1;
    const pareceMiles = despues.length === 3 && antes !== "0" && antes.length > 0;
    if (otrosSeparadores > 0 || pareceMiles) {
      entero = t.replace(/[.,]/g, "");
    } else {
      entero = antes.replace(/[.,]/g, "");
      decimal = despues;
    }
  } else {
    entero = t;
  }

  if (!/^\d+$/.test(entero) || (decimal && !/^\d{1,3}$/.test(decimal))) return null;
  const n = Number(`${entero}.${decimal || "0"}`);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
