import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ProductoraHome } from "./ProductoraHome";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Equipo interno con sesión activa: directo a la herramienta de ventas.
  if (user) redirect("/ventas");

  // Público general (dominio o subdominio de la productora): home de marca,
  // no la pantalla de login del equipo — antes cualquier visitante caía en /login.
  const service = createServiceClient();
  const { data: evento } = await service
    .from("eventos")
    .select("nombre, fecha, venue, ciudad")
    .limit(1)
    .single();

  return <ProductoraHome evento={evento ?? null} />;
}
