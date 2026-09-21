import { requerirPerfil, type Rol } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import PerfilesList from "./PerfilesList";
import CrearCuentaForm from "./CrearCuentaForm";

export default async function AdminPage() {
  const perfil = await requerirPerfil();

  if (perfil.rol !== "admin") {
    return (
      <>
        <Nav perfil={perfil} />
        <main className="max-w-3xl mx-auto w-full px-4 py-6">
          <p className="text-sm text-neutral-500">No tienes permiso para ver esta sección.</p>
        </main>
      </>
    );
  }

  const service = createServiceClient();

  const [{ data: perfiles }, { data: usuariosAuth }] = await Promise.all([
    service.from("perfiles").select("id, nombre, rol, activo, created_at").order("created_at", { ascending: false }),
    service.auth.admin.listUsers({ perPage: 200 }),
  ]);

  const emailPorId = new Map((usuariosAuth?.users ?? []).map((u) => [u.id, u.email ?? "(sin correo)"]));

  const filas = (perfiles ?? []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    rol: p.rol as Rol,
    activo: p.activo,
    email: emailPorId.get(p.id) ?? "(cuenta eliminada)",
  }));

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold">Cuentas y roles</h1>
          <p className="text-sm text-neutral-500">
            Crea cuentas para tu equipo (ventas, finanzas, acceso en la puerta) y asígnales el rol correcto — sin
            tocar Supabase.
          </p>
        </div>
        <CrearCuentaForm />
        <PerfilesList perfiles={filas} miId={perfil.id} />
      </main>
    </>
  );
}
