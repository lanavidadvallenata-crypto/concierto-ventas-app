import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";

export type Rol = "ventas" | "finanzas" | "admin" | "acceso";

export type PerfilActual = {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
};

// Trae el perfil del usuario logueado.
//
// Antes, si una cuenta de Supabase Auth no tenía fila en `perfiles`, se le
// creaba una automáticamente con rol 'ventas'. Eso era cómodo al principio
// (las cuentas se creaban a mano en Supabase), pero hoy todas las cuentas del
// equipo se crean desde /admin, que ya inserta el perfil. Dejar el auto-alta
// abierto significaba que CUALQUIER cuenta que lograra autenticarse contra
// Supabase (por ejemplo, si el registro público de Supabase Auth quedara
// habilitado) entraba al sistema con rol de ventas: veía el dashboard con la
// recaudación, el mapa VIP y podía registrar ventas. Ahora: sin perfil, sin
// acceso — y el admin lo crea desde /admin en 20 segundos si hace falta.
export async function getPerfilActual(): Promise<PerfilActual | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createServiceClient();

  const { data: perfil } = await service
    .from("perfiles")
    .select("id, nombre, rol, activo")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil) return null;

  // Cuenta desactivada desde /admin (ej. staff que ya no trabaja el evento):
  // se trata igual que "no hay perfil" — cada página protegida ya sabe
  // redirigir a /login o mostrar "sin permiso" cuando esto devuelve null.
  if (!perfil.activo) return null;

  return { id: perfil.id, email: user.email ?? "", nombre: perfil.nombre, rol: perfil.rol as Rol };
}
