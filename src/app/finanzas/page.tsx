import { redirect } from "next/navigation";
import { getPerfilActual } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import PendientesList from "./PendientesList";

export default async function FinanzasPage() {
  const perfil = await getPerfilActual();
  if (!perfil) redirect("/login");

  if (perfil.rol !== "finanzas" && perfil.rol !== "admin") {
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

  // Consulta simple, sin relaciones embebidas: tickets tiene 3 FKs distintas hacia
  // perfiles (vendido_por, verificado_por, qr_usado_por), lo que hacía ambiguo el
  // embed de Supabase y devolvía error silencioso (0 resultados). Se resuelve
  // trayendo cada pieza por separado y uniéndolas en memoria.
  const { data: pendientes, error: ticketsError } = await service
    .from("tickets")
    .select("id, comprador_nombre, comprador_telefono, tipo, precio, moneda, metodo_pago, referencia_pago, vendido_por, silla_id, created_at")
    .eq("estado_pago", "pendiente")
    .order("created_at", { ascending: true });

  if (ticketsError) {
    console.error("Error cargando pagos pendientes:", ticketsError);
  }

  const tickets = pendientes ?? [];

  const vendedorIds = [...new Set(tickets.map((t) => t.vendido_por).filter(Boolean))];
  const sillaIds = [...new Set(tickets.map((t) => t.silla_id).filter(Boolean))];

  const [{ data: vendedores }, { data: sillas }] = await Promise.all([
    vendedorIds.length
      ? service.from("perfiles").select("id, nombre").in("id", vendedorIds)
      : Promise.resolve({ data: [] as { id: string; nombre: string }[] }),
    sillaIds.length
      ? service.from("sillas_vip").select("id, numero, mesa_id").in("id", sillaIds)
      : Promise.resolve({ data: [] as { id: string; numero: number; mesa_id: string }[] }),
  ]);

  const mesaIds = [...new Set((sillas ?? []).map((s) => s.mesa_id).filter(Boolean))];
  const { data: mesas } = mesaIds.length
    ? await service.from("mesas_vip").select("id, numero, fila").in("id", mesaIds)
    : { data: [] as { id: string; numero: number; fila: string }[] };

  const vendedorPorId = new Map((vendedores ?? []).map((v) => [v.id, v.nombre]));
  const mesaPorId = new Map((mesas ?? []).map((m) => [m.id, m]));
  const sillaPorId = new Map((sillas ?? []).map((s) => [s.id, s]));

  const lista = tickets.map((t) => {
    const silla = t.silla_id ? sillaPorId.get(t.silla_id) : null;
    const mesa = silla ? mesaPorId.get(silla.mesa_id) : null;
    return {
      id: t.id as string,
      compradorNombre: t.comprador_nombre as string,
      compradorTelefono: t.comprador_telefono as string,
      tipo: t.tipo as "vip" | "general",
      precio: t.precio as number,
      moneda: t.moneda as string,
      metodoPago: t.metodo_pago as string,
      referenciaPago: t.referencia_pago as string | null,
      vendedorNombre: (t.vendido_por && vendedorPorId.get(t.vendido_por)) ?? "—",
      asiento: silla && mesa ? `Fila ${mesa.fila} · Mesa ${mesa.numero} · Silla ${silla.numero}` : null,
    };
  });

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Verificación de pagos</h1>
          <p className="text-sm text-neutral-500">{lista.length} pendientes</p>
        </div>
        <PendientesList tickets={lista} miId={perfil.id} />
      </main>
    </>
  );
}
