import { createServiceClient } from "@/lib/supabase/server";
import { obtenerMapaVip } from "@/lib/mapa-vip";
import { obtenerTasaActual } from "@/lib/tasa";
import { disponibilidadEtapas } from "@/lib/precios";
import CheckoutForm from "./CheckoutForm";
import { HeroEvento, SobreElEvento, PreciosExplicados, ComoComprar, PreguntasFrecuentes } from "./SeccionesVenta";

// Sin esto, cada visita a esta página (la de más tráfico de todo el sitio el
// día de venta) dispara ~6 consultas a Supabase sin ninguna caché de por medio
// — con miles de personas entrando a la misma hora, eso multiplica la carga
// real sobre la base de datos por el número de visitantes. Con un caché corto
// de 5s absorbemos ese pico casi por completo; confirmarCheckoutPublico y
// actualizarTasaManual ya llaman revalidatePath("/comprar") para refrescar al
// instante después de cada compra o cambio de tasa real, así que la frescura
// de los datos importantes no se resiente.
export const revalidate = 5;

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

  const [dispVip, dispGeneral] = await Promise.all([
    disponibilidadEtapas(service, "vip"),
    disponibilidadEtapas(service, "general"),
  ]);
  const preVip = dispVip.find((d) => d.etapa === "preventa");
  const preGeneral = dispGeneral.find((d) => d.etapa === "preventa");
  const preventa =
    preVip && preGeneral
      ? {
          vip: preVip.restante ?? 0,
          general: preGeneral.restante ?? 0,
          precioVip: preVip.totalUnitario,
          precioGeneral: preGeneral.totalUnitario,
        }
      : null;

  return (
    <main className="max-w-lg mx-auto w-full px-4 py-8 flex flex-col gap-8">
      <HeroEvento
        nombre={evento?.nombre ?? "La Navidad Vallenata"}
        fecha={evento?.fecha ?? null}
        venue={evento?.venue ?? "Hangar Grano de Oro"}
        ciudad={evento?.ciudad ?? "Maracaibo"}
      />

      <SobreElEvento />
      <PreciosExplicados preventa={preventa} />
      <ComoComprar />

      <div id="comprar" className="scroll-mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-3">Elige tu entrada</h2>
        <CheckoutForm
          mesas={mesas}
          sillasVipDisponibles={sillasVipDisponibles}
          cupoGeneralRestante={cupoGeneralRestante}
          tasaEurVes={tasaEurVes}
          preventa={preventa}
        />
      </div>

      <PreguntasFrecuentes />
    </main>
  );
}
