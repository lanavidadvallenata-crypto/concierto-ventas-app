import { requerirPerfil } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import MarcoNoche, { EncabezadoNoche } from "@/components/noche/MarcoNoche";
import AutoRefresh from "@/app/dashboard/AutoRefresh";
import { leerConfig, listaDeCobranza } from "@/lib/abona618";
import { hoyEnVenezuela } from "@/lib/cuotas";
import { obtenerTasaActual } from "@/lib/tasa";
import CobranzaList from "./CobranzaList";

export const dynamic = "force-dynamic";

export default async function CobranzaPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const perfil = await requerirPerfil();
  const { q } = await searchParams;

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

  const service = createServiceClient();
  const hoy = hoyEnVenezuela();
  const [lista, config, tasaEurVes] = await Promise.all([
    listaDeCobranza(service, { hoy }),
    leerConfig(service),
    obtenerTasaActual(service),
  ]);

  // Quién anotó cada pago: la lista guarda el id, la pantalla muestra el
  // nombre. Si no, nadie sabe a quién preguntarle por una referencia rara.
  const ids = [...new Set([...lista.porVerificar, ...lista.vencenHoy, ...lista.proximas, ...lista.enGracia, ...lista.paraAnular, ...lista.masAdelante]
    .map((c) => c.reportadoPor)
    .filter(Boolean))] as string[];
  const { data: perfiles } = ids.length
    ? await service.from("perfiles").select("id, nombre").in("id", ids)
    : { data: [] as { id: string; nombre: string }[] };
  const nombrePorId = Object.fromEntries((perfiles ?? []).map((p) => [p.id, p.nombre]));

  // Tema "noche" de 6.18 (24 oct): solo cambia cómo se ve. La lista, los
  // botones y las reglas de cobro son los mismos.
  return (
    <MarcoNoche perfil={perfil}>
      <EncabezadoNoche compacto seccion="Cobranza" titulo="Cobranza de cuotas." derecha={<AutoRefresh intervaloMs={60000} tema="noche" />} />
      <CobranzaList
        lista={lista}
        hoy={hoy}
        miRol={perfil.rol}
        nombrePorId={nombrePorId}
        moduloActivo={config.activo}
        configError={Boolean(config.error)}
        topeVip={config.topeVip}
        tasaEurVes={tasaEurVes}
        busquedaInicial={typeof q === "string" ? q.slice(0, 80) : ""}
      />
    </MarcoNoche>
  );
}
