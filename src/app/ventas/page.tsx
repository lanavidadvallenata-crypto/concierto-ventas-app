import { redirect } from "next/navigation";
import { getPerfilActual } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import { obtenerMapaVip } from "@/lib/mapa-vip";
import { obtenerTasaActual } from "@/lib/tasa";
import { disponibilidadEtapas } from "@/lib/precios";
import Nav from "@/components/Nav";
import VentaForm from "./VentaForm";

export default async function VentasPage() {
  const perfil = await getPerfilActual();
  if (!perfil) redirect("/login");

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

  const mesas = await obtenerMapaVip(service);
  const tasaEurVes = await obtenerTasaActual(service);
  const sillasVipDisponibles = mesas.reduce(
    (total, m) => total + m.sillas.filter((s) => s.estado === "disponible").length,
    0
  );

  const { count: generalVendidos } = await service
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("tipo", "general")
    .neq("estado_pago", "rechazado");

  const { data: evento } = await service
    .from("eventos")
    .select("aforo_general_total")
    .limit(1)
    .single();

  const { data: misVentasHoy } = await service
    .from("tickets")
    .select("id, grupo_id, comprador_nombre, tipo, precio, estado_pago, created_at")
    .eq("vendido_por", perfil.id)
    .eq("canal", "manual")
    .order("created_at", { ascending: false })
    .limit(40);

  const cupoGeneralRestante = (evento?.aforo_general_total ?? 4500) - (generalVendidos ?? 0);

  const [dispVip, dispGeneral] = await Promise.all([disponibilidadEtapas(service, "vip"), disponibilidadEtapas(service, "general")]);
  const preVip = dispVip.find((d) => d.etapa === "preventa");
  const preGeneral = dispGeneral.find((d) => d.etapa === "preventa");
  const preventa =
    preVip && preGeneral
      ? { vip: preVip.restante ?? 0, general: preGeneral.restante ?? 0, precioVip: preVip.totalUnitario, precioGeneral: preGeneral.totalUnitario }
      : null;

  // Agrupar "tus últimas ventas" por compra.
  const grupos = new Map<string, { id: string; nombre: string; tipo: string; cantidad: number; total: number; estado: string; creadoEn: string }>();
  for (const t of misVentasHoy ?? []) {
    const gid = (t.grupo_id as string | null) ?? (t.id as string);
    const g = grupos.get(gid);
    if (g) {
      g.cantidad += 1;
      g.total = Math.round((g.total + Number(t.precio)) * 100) / 100;
      if (t.estado_pago === "pendiente") g.estado = "pendiente";
    } else {
      grupos.set(gid, { id: gid, nombre: t.comprador_nombre as string, tipo: t.tipo as string, cantidad: 1, total: Number(t.precio), estado: t.estado_pago as string, creadoEn: t.created_at as string });
    }
  }
  const ultimasVentas = [...grupos.values()].slice(0, 8);

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold">Registrar venta</h1>
          <p className="text-sm text-neutral-500">
            {sillasVipDisponibles} sillas VIP disponibles · {cupoGeneralRestante} cupos generales restantes
            {preventa && (preventa.vip > 0 || preventa.general > 0) && (
              <>
                {" · "}
                <span className="text-evento-acento font-medium">
                  preventa: {preventa.vip} VIP / {preventa.general} General
                </span>
              </>
            )}
          </p>
        </div>

        <VentaForm mesas={mesas} cupoGeneralRestante={cupoGeneralRestante} tasaEurVes={tasaEurVes} preventa={preventa} />

        {ultimasVentas.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-neutral-600 mb-2">Tus últimas ventas</h2>
            <div className="flex flex-col gap-2">
              {ultimasVentas.map((g) => (
                <div key={g.id} className="flex items-center justify-between bg-white border border-neutral-200 rounded-md px-3 py-2 text-sm">
                  <span className="truncate">
                    {g.nombre} · {g.cantidad} × {g.tipo === "vip" ? "VIP" : "General"} · ${g.total.toFixed(2)}
                  </span>
                  <span
                    className={`shrink-0 ml-3 ${
                      g.estado === "verificado" ? "text-green-700" : g.estado === "rechazado" ? "text-red-600" : "text-amber-600"
                    }`}
                  >
                    {g.estado}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
