import { redirect } from "next/navigation";
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
  const r = await resolverPerfil();
  return r.estado === "ok" ? r.perfil : null;
}

export type ResolucionPerfil =
  | { estado: "ok"; perfil: PerfilActual }
  | { estado: "sin_sesion" }
  // Hay sesión de Supabase Auth pero la cuenta no tiene perfil o está
  // desactivada. Las páginas mandan a /sin-acceso (NO a /login: el
  // middleware ve la sesión y devolvería a /ventas → bucle infinito de
  // redirecciones, y la persona ni siquiera podría cerrar sesión).
  | { estado: "sin_acceso" };

export async function resolverPerfil(): Promise<ResolucionPerfil> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { estado: "sin_sesion" };

  const service = createServiceClient();

  const { data: perfil } = await service
    .from("perfiles")
    .select("id, nombre, rol, activo")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil || !perfil.activo) return { estado: "sin_acceso" };

  return {
    estado: "ok",
    perfil: { id: perfil.id, email: user.email ?? "", nombre: perfil.nombre, rol: perfil.rol as Rol },
  };
}

// Para las páginas protegidas: devuelve el perfil o redirige a donde toca.
// Nunca vuelve con null.
export async function requerirPerfil(): Promise<PerfilActual> {
  const r = await resolverPerfil();
  if (r.estado === "ok") return r.perfil;
  redirect(r.estado === "sin_sesion" ? "/login" : "/sin-acceso");
}
