import { redirect } from "next/navigation";
import { getPerfilActual } from "@/lib/perfil";
import Nav from "@/components/Nav";
import EntradaManual from "./EntradaManual";

export default async function AccesoPage() {
  const perfil = await getPerfilActual();
  if (!perfil) redirect("/login");

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-md mx-auto w-full px-4 py-6 flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Control de acceso</h1>
          <p className="text-sm text-neutral-500">
            Lo normal es abrir la cámara del teléfono y escanear el QR directo — abre esta misma validación sola.
            Usa esto solo si el código no escanea.
          </p>
        </div>
        <EntradaManual />
      </main>
    </>
  );
}
