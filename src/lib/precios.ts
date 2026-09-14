export const PRECIO_BASE: Record<"vip" | "general", number> = { vip: 120, general: 30 };
export const FEE_RATE = 0.1;

export function calcularTotal(tipo: "vip" | "general") {
  const base = PRECIO_BASE[tipo];
  const fee = Math.round(base * FEE_RATE * 100) / 100;
  const total = Math.round((base + fee) * 100) / 100;
  return { base, fee, total };
}
