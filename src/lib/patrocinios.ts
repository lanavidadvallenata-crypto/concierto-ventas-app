// Paquetes de patrocinio (media kit oficial). Las entradas incluidas se
// emiten como tickets de cortesía: ocupan aforo real para que la tienda no
// venda dos veces la misma silla ni pase del cupo general.
export type Paquete = "aliado" | "oficial";

export const PAQUETES: {
  id: Paquete;
  nombre: string;
  monto: number;
  tipo: "vip" | "general";
  entradas: number;
  incluye: string;
}[] = [
  { id: "aliado", nombre: "Plan Aliado", monto: 500, tipo: "general", entradas: 4, incluye: "4 entradas generales de cortesía" },
  { id: "oficial", nombre: "Patrocinador Oficial", monto: 1000, tipo: "vip", entradas: 3, incluye: "3 entradas VIP con silla numerada" },
];

export function buscarPaquete(id: Paquete) {
  const p = PAQUETES.find((x) => x.id === id);
  if (!p) throw new Error(`Paquete desconocido: ${id}`);
  return p;
}
