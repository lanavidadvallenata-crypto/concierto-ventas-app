import { createServiceClient } from "@/lib/supabase/server";
import { obtenerMapaVip } from "@/lib/mapa-vip";
import CheckoutForm from "./CheckoutForm";

export default async function ComprarPage() {
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
    .select("nombre, fecha, venue, ciudad, aforo_general_total")
    .limit(1)
    .single();

  const cupoGeneralRestante = (evento?.aforo_general_total ?? 4500) - (generalVendidos ?? 0);

  return (
    <main className="max-w-lg mx-auto w-full px-4 py-8 flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-xl font-bold">{evento?.nombre ?? "La Navidad Vallenata"}</h1>
        <p className="text-sm text-neutral-500">
          {evento?.venue ?? "Hangar Grano de Oro"} · {evento?.ciudad ?? "Maracaibo"}
        </p>
      </div>

      <CheckoutForm
        mesas={mesas}
        sillasVipDisponibles={sillasVipDisponibles}
        cupoGeneralRestante={cupoGeneralRestante}
      />
    </main>
  );
}
