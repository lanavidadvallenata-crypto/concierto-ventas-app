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
