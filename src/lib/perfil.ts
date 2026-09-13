import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";

export type Rol = "ventas" | "finanzas" | "admin" | "acceso";

export type PerfilActual = {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
};

// Trae el perfil del usuario logueado. Si es su primer ingreso y todavía no
// tiene fila en `perfiles`, se la crea con rol 'ventas' por defecto —
// no hay pantalla de registro propia todavía (las cuentas las crea Anita
// directo en Supabase Authentication), así que esto evita bloquear el primer login.
// Para subir a alguien a finanzas/admin/acceso: UPDATE public.perfiles SET rol = '...' WHERE id = '<uuid>';
export async function getPerfilActual(): Promise<PerfilActual | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createServiceClient();

  const { data: perfil } = await service
    .from("perfiles")
    .select("id, nombre, rol")
    .eq("id", user.id)
    .maybeSingle();

  if (perfil) {
    return { id: perfil.id, email: user.email ?? "", nombre: perfil.nombre, rol: perfil.rol as Rol };
  }

  const nombre = user.email?.split("@")[0] ?? "Usuario";
  const { data: nuevo, error } = await service
    .from("perfiles")
    .insert({ id: user.id, nombre, rol: "ventas" })
    .select("id, nombre, rol")
    .single();

  if (error || !nuevo) return null;

  return { id: nuevo.id, email: user.email ?? "", nombre: nuevo.nombre, rol: nuevo.rol as Rol };
}
