import { requerirPerfil } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import { obtenerMapaVip } from "@/lib/mapa-vip";
import { obtenerTasaActual } from "@/lib/tasa";
import { ETIQUETA_METODO, METODOS_EN_BS, formatoBs, formatoUsd, horaCaracas } from "@/lib/formato";
import Nav from "@/components/Nav";
import TaquillaForm from "./TaquillaForm";
import { taquillaAbierta } from "@/lib/taquilla";

function inicioDelDiaCaracas(): string {
  // Medianoche de hoy en Venezuela (UTC-4), en ISO, para "tus ventas de hoy".
  const ahora = new Date();
  const caracas = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Caracas" }));
  caracas.setHours(0, 0, 0, 0);
  const desfase = ahora.getTime() - new Date(ahora.toLocaleString("en-US", { timeZone: "America/Caracas" })).getTime();
  return new Date(caracas.getTime() + desfase).toISOString();
}

export default async function TaquillaPage() {
  const perfil = await requerirPerfil();

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
  const abierta = await taquillaAbierta(service);
  if (!abierta && perfil.rol !== "admin") {
    return (
      <>
        <Nav perfil={perfil} />
        <main className="max-w-3xl mx-auto w-full px-4 py-6">
          <h1 className="text-lg font-semibold">Taquilla — boletos físicos</h1>
          <p className="text-sm text-neutral-600 mt-2">
            La taquilla se habilita el día del evento (4 de diciembre). Las ventas de taquilla quedan verificadas al instante sin
            pasar por Finanzas, por eso no está abierta antes. Mientras tanto, registra las ventas en <strong>Ventas</strong>.
          </p>
        </main>
      </>
    );
  }
  const mesas = await obtenerMapaVip(service);
  const tasaEurVes = await obtenerTasaActual(service);

  const { count: generalVendidos } = await service
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("tipo", "general")
    .neq("estado_pago", "rechazado");
  const { data: evento } = await service.from("eventos").select("aforo_general_total").limit(1).single();
  const cupoGeneralRestante = (evento?.aforo_general_total ?? 4500) - (generalVendidos ?? 0);
  const sillasVipDisponibles = mesas.reduce((t, m) => t + m.sillas.filter((s) => s.estado === "disponible").length, 0);

  // Tus ventas de hoy en taquilla (para cerrar caja).
  const { data: hoy } = await service
    .from("tickets")
    .select("id, grupo_id, tipo, precio, precio_bs, metodo_pago, referencia_pago, created_at")
    .eq("vendido_por", perfil.id)
    .eq("canal", "taquilla")
    .gte("created_at", inicioDelDiaCaracas())
    .order("created_at", { ascending: false });

  const ventasHoy = hoy ?? [];
  const porMetodo = new Map<string, { entradas: number; usd: number; bs: number }>();
  const grupos = new Map<string, { id: string; tipo: string; cantidad: number; total: number; totalBs: number | null; metodo: string; ref: string | null; hora: string }>();
  for (const t of ventasHoy) {
    const m = porMetodo.get(t.metodo_pago) ?? { entradas: 0, usd: 0, bs: 0 };
    m.entradas += 1;
    m.usd += Number(t.precio);
    m.bs += Number(t.precio_bs ?? 0);
    porMetodo.set(t.metodo_pago, m);

    const gid = (t.grupo_id as string | null) ?? (t.id as string);
    const g = grupos.get(gid);
    if (g) {
      g.cantidad += 1;
      g.total += Number(t.precio);
      if (g.totalBs != null) g.totalBs += Number(t.precio_bs ?? 0);
    } else {
      grupos.set(gid, {
        id: gid,
        tipo: t.tipo as string,
        cantidad: 1,
        total: Number(t.precio),
        totalBs: t.precio_bs == null ? null : Number(t.precio_bs),
        metodo: t.metodo_pago as string,
        ref: (t.referencia_pago as string | null) ?? null,
        hora: t.created_at as string,
      });
    }
  }
  const totalEntradasHoy = ventasHoy.length;
  const totalUsdHoy = ventasHoy.reduce((s, t) => s + Number(t.precio), 0);

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold">Taquilla — boletos físicos</h1>
          <p className="text-sm text-neutral-500">
            Venta en la puerta el día del evento. Queda verificada al instante, sin correo ni QR: el control es el boleto de papel.
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            {sillasVipDisponibles} sillas VIP disponibles · {cupoGeneralRestante} cupos generales
          </p>
        </div>

        <TaquillaForm mesas={mesas} cupoGeneralRestante={cupoGeneralRestante} tasaEurVes={tasaEurVes} />

        <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
            <p className="text-sm font-semibold">Tus ventas de hoy</p>
            <p className="text-sm text-neutral-600">
              {totalEntradasHoy} entrada{totalEntradasHoy === 1 ? "" : "s"} · {formatoUsd(totalUsdHoy)}
            </p>
          </div>
          {porMetodo.size > 0 && (
            <div className="px-4 py-3 border-b border-neutral-100 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
              {[...porMetodo.entries()].map(([metodo, m]) => (
                <div key={metodo} className="bg-neutral-50 rounded-md px-3 py-2">
                  <p className="text-xs text-neutral-500">{ETIQUETA_METODO[metodo] ?? metodo}</p>
                  <p className="font-semibold tabular-nums">
                    {METODOS_EN_BS.has(metodo) && m.bs > 0 ? formatoBs(m.bs) : formatoUsd(m.usd)}
                  </p>
                  <p className="text-[11px] text-neutral-400">
                    {m.entradas} entrada{m.entradas === 1 ? "" : "s"}
                    {METODOS_EN_BS.has(metodo) && m.bs > 0 ? ` · ${formatoUsd(m.usd)}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="divide-y divide-neutral-100">
            {grupos.size === 0 && <p className="px-4 py-6 text-sm text-neutral-400 text-center">Todavía no has vendido hoy.</p>}
            {[...grupos.values()].map((g) => (
              <div key={g.id} className="px-4 py-2.5 flex items-center justify-between text-sm gap-3">
                <span className="truncate">
                  {horaCaracas(g.hora).split(",").pop()?.trim()} · {g.cantidad} × {g.tipo === "vip" ? "VIP" : "General"} · {ETIQUETA_METODO[g.metodo] ?? g.metodo}
                  {g.ref ? <span className="text-neutral-400"> · {g.ref}</span> : null}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {g.totalBs != null && METODOS_EN_BS.has(g.metodo) ? formatoBs(g.totalBs) : formatoUsd(g.total)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
