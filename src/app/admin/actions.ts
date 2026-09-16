"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { Rol } from "@/lib/perfil";

type Resultado = { ok: true } | { ok: false; error: string };

const ROLES_VALIDOS: Rol[] = ["ventas", "finanzas", "admin", "acceso"];

async function requiereAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { userId: null, error: "Tu sesión expiró — vuelve a entrar." };

  const service = createServiceClient();
  const { data: perfil } = await service.from("perfiles").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.activo || perfil.rol !== "admin") {
    return { userId: null, error: "No tienes permiso para administrar cuentas." };
  }
  return { userId: user.id, error: null };
}

export async function crearCuenta(datos: {
  nombre: string;
  correo: string;
  contrasena: string;
  rol: string;
}): Promise<Resultado> {
  const { userId, error } = await requiereAdmin();
  if (!userId) return { ok: false, error: error! };

  const nombre = datos.nombre.trim();
  const correo = datos.correo.trim().toLowerCase();
  const rol = datos.rol as Rol;

  if (!nombre) return { ok: false, error: "Falta el nombre." };
  if (!correo) return { ok: false, error: "Falta el correo." };
  if (datos.contrasena.length < 8) return { ok: false, error: "La contraseña debe tener al menos 8 caracteres." };
  if (!ROLES_VALIDOS.includes(rol)) return { ok: false, error: "Rol inválido." };

  const service = createServiceClient();

  // email_confirm: true — no depende de que llegue un correo de confirmación
  // (Resend está configurado para los correos de compra, no para auth de Supabase).
  const { data: creado, error: errorCrear } = await service.auth.admin.createUser({
    email: correo,
    password: datos.contrasena,
    email_confirm: true,
  });

  if (errorCrear || !creado.user) {
    const yaExiste = errorCrear?.message?.toLowerCase().includes("already") ?? false;
    return {
      ok: false,
      error: yaExiste ? "Ya existe una cuenta con ese correo." : `No se pudo crear la cuenta: ${errorCrear?.message ?? "error desconocido"}`,
    };
  }

  const { error: errorPerfil } = await service
    .from("perfiles")
    .insert({ id: creado.user.id, nombre, rol, activo: true });

  if (errorPerfil) {
    // La cuenta de auth ya se creó — no la dejamos huérfana sin perfil.
    await service.auth.admin.deleteUser(creado.user.id);
    return { ok: false, error: "No se pudo guardar el perfil — la cuenta no se creó." };
  }

  revalidatePath("/admin");
  return { ok: true };
}

export async function cambiarRol(perfilId: string, nuevoRol: string): Promise<Resultado> {
  const { userId, error } = await requiereAdmin();
  if (!userId) return { ok: false, error: error! };

  if (perfilId === userId) {
    return { ok: false, error: "No puedes cambiar tu propio rol desde aquí." };
  }

  const rol = nuevoRol as Rol;
  if (!ROLES_VALIDOS.includes(rol)) return { ok: false, error: "Rol inválido." };

  const { error: errorUpdate } = await createServiceClient()
    .from("perfiles")
    .update({ rol })
    .eq("id", perfilId);

  if (errorUpdate) return { ok: false, error: "No se pudo actualizar el rol." };

  revalidatePath("/admin");
  return { ok: true };
}

export async function cambiarActivo(perfilId: string, activo: boolean): Promise<Resultado> {
  const { userId, error } = await requiereAdmin();
  if (!userId) return { ok: false, error: error! };

  if (perfilId === userId) {
    return { ok: false, error: "No puedes desactivar tu propia cuenta." };
  }

  const { error: errorUpdate } = await createServiceClient()
    .from("perfiles")
    .update({ activo })
    .eq("id", perfilId);

  if (errorUpdate) return { ok: false, error: "No se pudo actualizar la cuenta." };

  revalidatePath("/admin");
  return { ok: true };
}
