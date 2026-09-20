import { redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { disponibilidadEtapas } from "@/lib/precios";
import { ProductoraHome } from "./ProductoraHome";

// El dato del evento (nombre/fecha/venue) no cambia entre visitas — cachearlo
// unos segundos evita que cada visitante anónimo del home dispare su propia
// consulta a Supabase en el momento de más tráfico del sitio.
const obtenerEventoCacheado = unstable_cache(
  async () => {
    const service = createServiceClient();
    const { data: evento } = await service
      .from("eventos")
      .select("nombre, fecha, venue, ciudad")
      .limit(1)
      .single();
    // "Desde $X": precio base de la etapa vigente para General (preventa
    // mientras quede cupo). Se cachea junto con el evento.
    const disp = await disponibilidadEtapas(service, "general");
    const vigente = disp.find((d) => d.restante === null || d.restante > 0);
    const desdeBase = vigente ? Math.round((vigente.totalUnitario / 1.1) * 100) / 100 : null;
    return { evento: evento ?? null, desdeBase };
  },
  ["home-evento-v2"],
  { revalidate: 30 }
);

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Equipo interno con sesión activa: directo a la herramienta de ventas.
  if (user) redirect("/ventas");

  // Público general (dominio o subdominio de la productora): home de marca,
  // no la pantalla de login del equipo — antes cualquier visitante caía en /login.
  const { evento, desdeBase } = await obtenerEventoCacheado();

  return <ProductoraHome evento={evento} desdePreventa={desdeBase} />;
}
