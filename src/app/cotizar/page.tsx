import { requerirPerfil } from "@/lib/perfil";
import Nav from "@/components/Nav";
import Cotizador from "./Cotizador";

export const dynamic = "force-dynamic";

export default async function CotizarPage() {
  const perfil = await requerirPerfil();

  if (perfil.rol !== "ventas" && perfil.rol !== "finanzas" && perfil.rol !== "admin") {
    return (
      <>
        <Nav perfil={perfil} />
        <main className="max-w-3xl mx-auto w-full px-4 py-6">
          <p className="text-sm text-neutral-500">No tienes permiso para ver esta sección.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-3xl mx-auto w-full px-4 py-5">
        <Cotizador />
      </main>
    </>
  );
}
