// Motivos de cortesía. Lista cerrada a propósito: si cada quien escribe el
// motivo a mano, al cerrar cuentas no se puede agrupar nada.
export const MOTIVOS = [
  { id: "canje", nombre: "Canje", ayuda: "Entradas a cambio de algo que no es dinero: contenido, difusión, servicios." },
  { id: "sorteo", nombre: "Sorteo", ayuda: "Premio de un sorteo o concurso." },
  { id: "prensa", nombre: "Prensa", ayuda: "Medios, periodistas, cobertura." },
  { id: "staff", nombre: "Staff", ayuda: "Equipo, producción, proveedores." },
  { id: "invitacion", nombre: "Invitación", ayuda: "Invitados de la productora o de los artistas." },
  { id: "otro", nombre: "Otro", ayuda: "Cualquier otro caso — explícalo en el detalle." },
] as const;

export type Motivo = (typeof MOTIVOS)[number]["id"];

export function nombreMotivo(id: string): string {
  return MOTIVOS.find((m) => m.id === id)?.nombre ?? id;
}
