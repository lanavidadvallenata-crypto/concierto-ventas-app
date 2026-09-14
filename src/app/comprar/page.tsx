import { createServiceClient } from "@/lib/supabase/server";
import { obtenerMapaVip } from "@/lib/mapa-vip";
import { obtenerTasaActual } from "@/lib/tasa";
import CheckoutForm from "./CheckoutForm";
import { HeroEvento, SobreElEvento, PreciosExplicados, ComoComprar, PreguntasFrecuentes } from "./SeccionesVenta";

export default async function ComprarPage() {
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
    .select("nombre, fecha, venue, ciudad, aforo_general_total")
    .limit(1)
    .single();

  const cupoGeneralRestante = (evento?.aforo_general_total ?? 4500) - (generalVendidos ?? 0);

  return (
    <main className="max-w-lg mx-auto w-full px-4 py-8 flex flex-col gap-8">
      <HeroEvento
        nombre={evento?.nombre ?? "La Navidad Vallenata"}
        fecha={evento?.fecha ?? null}
        venue={evento?.venue ?? "Hangar Grano de Oro"}
        ciudad={evento?.ciudad ?? "Maracaibo"}
      />

      <SobreElEvento />
      <PreciosExplicados />
      <ComoComprar />

      <div id="comprar" className="scroll-mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-3">Elige tu entrada</h2>
        <CheckoutForm
          mesas={mesas}
          sillasVipDisponibles={sillasVipDisponibles}
          cupoGeneralRestante={cupoGeneralRestante}
          tasaEurVes={tasaEurVes}
        />
      </div>

      <PreguntasFrecuentes />
    </main>
  );
}
