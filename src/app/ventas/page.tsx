import { redirect } from "next/navigation";
import { getPerfilActual } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import { obtenerMapaVip } from "@/lib/mapa-vip";
import Nav from "@/components/Nav";
import VentaForm from "./VentaForm";

export default async function VentasPage() {
  const perfil = await getPerfilActual();
  if (!perfil) redirect("/login");

  const service = createServiceClient();

  const mesas = await obtenerMapaVip(service);
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
    .select("id, comprador_nombre, tipo, precio, estado_pago, created_at")
    .eq("vendido_por", perfil.id)
    .order("created_at", { ascending: false })
    .limit(8);

  const cupoGeneralRestante = (evento?.aforo_general_total ?? 4500) - (generalVendidos ?? 0);

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold">Registrar venta</h1>
          <p className="text-sm text-neutral-500">
            {sillasVipDisponibles} sillas VIP disponibles · {cupoGeneralRestante} cupos generales restantes
          </p>
        </div>

        <VentaForm mesas={mesas} cupoGeneralRestante={cupoGeneralRestante} />

        {misVentasHoy && misVentasHoy.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-neutral-600 mb-2">Tus últimas ventas</h2>
            <div className="flex flex-col gap-2">
              {misVentasHoy.map((t) => (
                <div key={t.id} className="flex items-center justify-between bg-white border border-neutral-200 rounded-md px-3 py-2 text-sm">
                  <span>{t.comprador_nombre} · {t.tipo}</span>
                  <span
                    className={
                      t.estado_pago === "verificado"
                        ? "text-green-700"
                        : t.estado_pago === "rechazado"
                        ? "text-red-600"
                        : "text-amber-600"
                    }
                  >
                    {t.estado_pago}
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
