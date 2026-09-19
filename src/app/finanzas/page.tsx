import { redirect } from "next/navigation";
import { getPerfilActual } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import { obtenerTasaActual } from "@/lib/tasa";
import Nav from "@/components/Nav";
import PendientesList, { type CompraPendiente } from "./PendientesList";
import TasaCambio from "./TasaCambio";
import BuscarComprador from "./BuscarComprador";
import AutoRefresh from "@/app/dashboard/AutoRefresh";

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

  // Consulta simple, sin relaciones embebidas (ver src/lib/asiento.ts).
  const { data: pendientes, error: ticketsError } = await service
    .from("tickets")
    .select("id, grupo_id, comprador_nombre, comprador_telefono, comprador_email, tipo, precio, precio_bs, tasa_aplicada, etapa, canal, metodo_pago, referencia_pago, vendido_por, silla_id, created_at")
    .eq("estado_pago", "pendiente")
    .order("created_at", { ascending: true });

  if (ticketsError) {
    console.error("Error cargando pagos pendientes:", ticketsError);
  }

  const tickets = pendientes ?? [];
  const tasaActual = await obtenerTasaActual(service);

  const vendedorIds = [...new Set(tickets.map((t) => t.vendido_por).filter(Boolean))] as string[];
  const sillaIds = [...new Set(tickets.map((t) => t.silla_id).filter(Boolean))] as string[];

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

  // Agrupar por compra (grupo_id). Tickets viejos sin grupo: cada uno es su compra.
  const compras = new Map<string, CompraPendiente>();
  for (const t of tickets) {
    const gid = (t.grupo_id as string | null) ?? (t.id as string);
    const silla = t.silla_id ? sillaPorId.get(t.silla_id) : null;
    const mesa = silla ? mesaPorId.get(silla.mesa_id) : null;
    const asiento = silla && mesa ? `${mesa.fila}${mesa.numero}·S${silla.numero}` : null;
    const precio = Number(t.precio);
    const precioBs = t.precio_bs == null ? null : Number(t.precio_bs);
    const existente = compras.get(gid);
    if (existente) {
      existente.cantidad += 1;
      existente.total = Math.round((existente.total + precio) * 100) / 100;
      existente.totalBs = existente.totalBs != null && precioBs != null ? Math.round((existente.totalBs + precioBs) * 100) / 100 : existente.totalBs;
      if (asiento) existente.asientos.push(asiento);
      if (t.etapa === "preventa") existente.enPreventa += 1;
      continue;
    }
    compras.set(gid, {
      id: t.id as string,
      grupoId: gid,
      compradorNombre: t.comprador_nombre as string,
      compradorTelefono: t.comprador_telefono as string,
      compradorEmail: (t.comprador_email as string | null) ?? null,
      tipo: t.tipo as "vip" | "general",
      cantidad: 1,
      total: precio,
      totalBs: precioBs,
      tasaAplicada: t.tasa_aplicada == null ? null : Number(t.tasa_aplicada),
      enPreventa: t.etapa === "preventa" ? 1 : 0,
      canal: (t.canal as string) ?? (t.vendido_por ? "manual" : "web"),
      metodoPago: t.metodo_pago as string,
      referenciaPago: (t.referencia_pago as string | null) ?? null,
      vendidoPor: (t.vendido_por as string | null) ?? null,
      vendedorNombre: t.vendido_por ? (vendedorPorId.get(t.vendido_por) ?? "—") : null,
      asientos: asiento ? [asiento] : [],
      creadoEn: t.created_at as string,
    });
  }

  const lista = [...compras.values()];
  const totalPendienteUsd = lista.reduce((s, c) => s + c.total, 0);
  const entradasPendientes = lista.reduce((s, c) => s + c.cantidad, 0);

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Verificación de pagos</h1>
            <p className="text-sm text-neutral-500">
              {lista.length === 0
                ? "Sin pagos pendientes"
                : `${lista.length} compra${lista.length === 1 ? "" : "s"} · ${entradasPendientes} entrada${entradasPendientes === 1 ? "" : "s"} · $${totalPendienteUsd.toFixed(2)} por verificar`}
            </p>
          </div>
          <AutoRefresh intervaloMs={30000} />
        </div>

        <PendientesList compras={lista} miId={perfil.id} miRol={perfil.rol} tasaEurVes={tasaActual} />

        <BuscarComprador />

        <TasaCambio tasaActual={tasaActual} />
      </main>
    </>
  );
}
