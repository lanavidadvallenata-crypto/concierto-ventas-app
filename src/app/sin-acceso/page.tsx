import { redirect } from "next/navigation";
import { resolverPerfil } from "@/lib/perfil";
import { cerrarSesion } from "@/app/actions";
import { WHATSAPP_SOPORTE_VISIBLE } from "@/lib/contacto";

// Sesión válida de Supabase Auth pero sin perfil activo en el sistema
// (cuenta desactivada desde /admin, o creada fuera de /admin). Fuera de las
// rutas protegidas del middleware a propósito, para que no haya bucle.
export default async function SinAccesoPage() {
  const r = await resolverPerfil();
  if (r.estado === "ok") redirect("/ventas");
  if (r.estado === "sin_sesion") redirect("/login");

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm bg-white border border-neutral-200 rounded-xl p-6 shadow-sm flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Esta cuenta no tiene acceso</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Tu inicio de sesión es válido, pero la cuenta está desactivada o todavía no tiene un rol asignado en el
            sistema. Pídele a Anita que la active desde Admin.
          </p>
          <p className="text-xs text-neutral-400 mt-2">Soporte: {WHATSAPP_SOPORTE_VISIBLE}</p>
        </div>
        <form action={cerrarSesion}>
          <button type="submit" className="w-full h-11 bg-neutral-900 text-white rounded-md text-sm font-medium">
            Cerrar sesión
          </button>
        </form>
      </div>
    </main>
  );
}
