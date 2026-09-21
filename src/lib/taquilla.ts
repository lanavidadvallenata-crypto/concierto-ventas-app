import type { SupabaseClient } from "@supabase/supabase-js";

// Hoy (hora Venezuela) es el día del evento o después. La taquilla verifica
// ventas sin segunda persona (el vendedor tiene el dinero en la mano), así
// que solo se habilita ese día; admin puede usarla antes para probar.
export async function taquillaAbierta(service: SupabaseClient): Promise<boolean> {
  const { data: evento } = await service.from("eventos").select("fecha").limit(1).maybeSingle();
  if (!evento?.fecha) return false;
  const hoyCaracas = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Caracas" });
  return hoyCaracas >= (evento.fecha as string);
}
