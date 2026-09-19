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
};

export const METODOS_EN_BS = new Set(["pago_movil", "transferencia"]);

export function formatoBs(monto: number): string {
  return `Bs ${monto.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatoUsd(monto: number): string {
  return `$${monto.toFixed(2)}`;
}
