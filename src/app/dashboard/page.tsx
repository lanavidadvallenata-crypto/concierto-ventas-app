import { requerirPerfil } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import { calcularTotal } from "@/lib/precios";
import Nav from "@/components/Nav";
import VentasChart, { type DiaVenta } from "./VentasChart";
import AutoRefresh from "./AutoRefresh";
import Link from "next/link";
import { seleccionarTodo } from "@/lib/db";
import { ETAPAS } from "@/lib/precios";
import { leerConfig, resumenPlanes } from "@/lib/abona618";
import { obtenerTasaActual, convertirABs } from "@/lib/tasa";
import { NOTA_TASA_CORTA, SIN_TASA, formatoBs, formatoBsAprox } from "@/lib/formato";
import PanelPlanes from "./PanelPlanes";

// Sin `revalidate`: esta página lee la sesión (cookies) y por eso Next la
// trata como dinámica siempre — el "revalidate = 10" de antes no hacía nada y
// confundía. El refresco real lo hace <AutoRefresh /> cada 20 s en el cliente.

const METODO_ETIQUETA: Record<string, string> = {
  pago_movil: "Pago móvil",
  transferencia: "Transferencia",
  zelle: "Zelle",
  binance: "Binance",
  efectivo_usd: "Efectivo $",
  efectivo_bs: "Efectivo Bs",
};

const METODOS_ORDEN = ["transferencia", "zelle", "binance", "pago_movil", "efectivo_usd", "efectivo_bs"] as const;

const CANAL_ETIQUETA: Record<string, string> = { web: "Web", manual: "Manual", taquilla: "Taquilla", patrocinio: "Patrocinios", cortesia: "Cortesías" };

export default async function DashboardPage() {
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

  type TicketResumen = { tipo: string; precio: number | string; metodo_pago: string; estado_pago: string; created_at: string; canal: string | null; etapa: string | null; grupo_id: string | null; precio_bs: number | string | null };

  // La configuración va primero porque el resumen de planes necesita el tope
  // vigente: si alguien lo subió de 100, la tarjeta tiene que medir contra el
  // número de verdad y no contra la constante del código.
  const config = await leerConfig(service);
  const [{ data: tickets, error: ticketsError }, { data: evento }, { data: mesas }, planes, tasaEurVes] = await Promise.all([
    seleccionarTodo<TicketResumen>(service, "tickets", "tipo, precio, metodo_pago, estado_pago, created_at, canal, etapa, grupo_id, precio_bs"),
    service.from("eventos").select("aforo_general_total").limit(1).single(),
    // El aforo con asiento se cuenta por zona (VIP y Preferencial comparten
    // tablas y se distinguen por mesas_vip.zona).
    service.from("mesas_vip").select("zona, sillas_total"),
    resumenPlanes(service, config),
    obtenerTasaActual(service),
  ]);
  if (ticketsError) console.error("Error cargando tickets para el dashboard:", ticketsError);

  const todos = tickets ?? [];
  const cupoPreventa = ETAPAS.find((e) => e.id === "preventa")?.cupo ?? { vip: 0, general: 0 };
  const verificados = todos.filter((t) => t.estado_pago === "verificado");
  const pendientes = todos.filter((t) => t.estado_pago === "pendiente");

  const vipVerificados = verificados.filter((t) => t.tipo === "vip");
  const preferencialVerificados = verificados.filter((t) => t.tipo === "preferencial");
  const generalVerificados = verificados.filter((t) => t.tipo === "general");

  const ingresoTotal = verificados.reduce((s, t) => s + Number(t.precio), 0);

  // Las compras con plan en curso NO van en "esperando verificación". De una
  // compra de $140 en cuotas entraron $56 y los tickets siguen en `pendiente`
  // hasta el último pago: sumar los $140 aquí infla lo que Finanzas cree que
  // tiene por revisar, y la plata que de verdad entró no aparecía en ninguna
  // parte. Esa va en la tarjeta de Abona618, y el total real de los dos
  // caminos es `enBanco`.
  const gruposConPlan = new Set(planes.gruposEnCurso);
  const pendientesSueltos = pendientes.filter((t) => !t.grupo_id || !gruposConPlan.has(String(t.grupo_id)));
  const ingresoPendiente = pendientesSueltos.reduce((s, t) => s + Number(t.precio), 0);
  const enBanco = Math.round((ingresoTotal + planes.enCurso.cobradoUsd) * 100) / 100;
  const ingresoVip = vipVerificados.reduce((s, t) => s + Number(t.precio), 0);
  const ingresoPreferencial = preferencialVerificados.reduce((s, t) => s + Number(t.precio), 0);
  const ingresoGeneral = generalVerificados.reduce((s, t) => s + Number(t.precio), 0);

  const aforoGeneral = evento?.aforo_general_total ?? 4500;
  const sillasPorZona = (zona: string) =>
    (mesas ?? []).filter((m) => ((m.zona as string | null) ?? "vip") === zona).reduce((s, m) => s + Number(m.sillas_total ?? 0), 0);
  const aforoVip = mesas ? sillasPorZona("vip") : 300;
  const aforoPreferencial = mesas ? sillasPorZona("preferencial") : 0;
  const hayPreferencial = aforoPreferencial > 0 || preferencialVerificados.length > 0;
  const metaIngresos =
    aforoVip * calcularTotal("vip").total +
    aforoPreferencial * calcularTotal("preferencial").total +
    aforoGeneral * calcularTotal("general").total;

  // Por método se suman los bolívares REALES de cada ticket (`precio_bs`): lo
  // que de verdad entró ese día, a la tasa de ese día. Convertir el total de
  // hoy daría un número más redondo y falso — la plata entró a lo largo de
  // semanas con tasas distintas.
  const porMetodo = new Map<string, { cantidad: number; monto: number; bs: number }>();
  for (const t of verificados) {
    const actual = porMetodo.get(t.metodo_pago) ?? { cantidad: 0, monto: 0, bs: 0 };
    actual.cantidad += 1;
    actual.monto += Number(t.precio);
    if (t.precio_bs != null) actual.bs += Number(t.precio_bs);
    porMetodo.set(t.metodo_pago, actual);
  }
  const maxMonto = Math.max(1, ...[...porMetodo.values()].map((v) => v.monto));

  const porCanal = new Map<string, { cantidad: number; monto: number }>();
  for (const t of verificados) {
    const c = (t.canal as string) ?? "web";
    const actual = porCanal.get(c) ?? { cantidad: 0, monto: 0 };
    actual.cantidad += 1;
    actual.monto += Number(t.precio);
    porCanal.set(c, actual);
  }
  const preventaVendida = todos.filter((t) => t.etapa === "preventa" && t.estado_pago !== "rechazado");
  const preventaVip = preventaVendida.filter((t) => t.tipo === "vip").length;
  const preventaGeneral = preventaVendida.filter((t) => t.tipo === "general").length;

  // Por día, con desglose por tipo e ingreso: al tocar una barra el gráfico
  // dice si ese día lo hizo VIP o General, no solo cuántas entradas salieron.
  const porDia = new Map<string, DiaVenta>();
  for (const t of verificados) {
    const dia = new Date(t.created_at).toLocaleDateString("sv-SE", { timeZone: "America/Caracas" });
    const actual = porDia.get(dia) ?? { fecha: dia, total: 0, vip: 0, preferencial: 0, general: 0, usd: 0 };
    actual.total += 1;
    if (t.tipo === "vip") actual.vip += 1;
    else if (t.tipo === "preferencial") actual.preferencial += 1;
    else actual.general += 1;
    actual.usd = Math.round((actual.usd + Number(t.precio)) * 100) / 100;
    porDia.set(dia, actual);
  }
  const dias = [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-14);

  // Ocupación por zona (Anita, 17 oct: "dice 3 Preferencial vendidos y van
  // muchas más"). "Vendidos" contaba solo lo pagado al 100 %; las compras en
  // cuotas siguen en `pendiente` hasta el último pago y no aparecían, aunque
  // sus sillas ya están tomadas. Ahora el número grande es lo OCUPADO y abajo
  // se separa qué está pagado, qué va en cuotas y qué espera a Finanzas.
  const ocupacion = (tipo: string) => {
    const pagadas = verificados.filter((t) => t.tipo === tipo).length;
    const enCuotas = pendientes.filter((t) => t.tipo === tipo && t.grupo_id && gruposConPlan.has(String(t.grupo_id))).length;
    const porVerificar = pendientesSueltos.filter((t) => t.tipo === tipo).length;
    return { pagadas, enCuotas, porVerificar, ocupadas: pagadas + enCuotas + porVerificar };
  };
  const ocVip = ocupacion("vip");
  const ocPreferencial = ocupacion("preferencial");
  const ocGeneral = ocupacion("general");
  const desglose = (o: { pagadas: number; enCuotas: number; porVerificar: number }) =>
    [`${o.pagadas} pagada${o.pagadas === 1 ? "" : "s"}`, o.enCuotas ? `${o.enCuotas} en cuotas` : "", o.porVerificar ? `${o.porVerificar} por verificar` : ""]
      .filter(Boolean)
      .join(" · ");

  const vendidosTotal = verificados.length;
  const aforoTotalEntradas = aforoVip + aforoPreferencial + aforoGeneral;
  const pctVendido = aforoTotalEntradas > 0 ? Math.round((vendidosTotal / aforoTotalEntradas) * 1000) / 10 : 0;

  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  // Un Bs estimado a la tasa de hoy. Si no hay tasa no se inventa nada: la
  // línea simplemente no sale.
  const bsAprox = (usd: number) => (tasaEurVes ? formatoBsAprox(convertirABs(usd, tasaEurVes)) : null);

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Dashboard de ventas</h1>
            <p className="text-sm text-neutral-500">La Navidad Vallenata · 4 dic 2026</p>
          </div>
          <AutoRefresh />
        </div>

        <div className="bg-white border border-neutral-200 rounded-xl p-5">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs text-neutral-500">Recaudado (verificado)</p>
              <p className="text-4xl font-semibold text-marca-secundario">${fmt(ingresoTotal)}</p>
              {bsAprox(ingresoTotal) && <p className="text-sm text-neutral-600 -mt-0.5 tabular-nums">{bsAprox(ingresoTotal)}</p>}
              <p className="text-xs text-neutral-400 mt-1">Meta a aforo completo: ${fmt(metaIngresos)}</p>
              {planes.enCurso.cobradoUsd > 0 && (
                <p className="text-xs text-neutral-500 mt-1">
                  +${fmt(planes.enCurso.cobradoUsd)} de cuotas ya cobradas · <span className="font-medium text-neutral-700">${fmt(enBanco)} en banco</span>
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-neutral-500">{vendidosTotal} pagadas de {aforoTotalEntradas} entradas</p>
              <p className="text-2xl font-semibold">{pctVendido}%</p>
              <p className="text-[11px] text-neutral-400">
                {ocVip.ocupadas + ocPreferencial.ocupadas + ocGeneral.ocupadas} ocupadas contando cuotas
              </p>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div className="h-full rounded-full bg-marca-secundario" style={{ width: `${Math.min(pctVendido, 100)}%` }} />
          </div>
          {ingresoPendiente > 0 && (
            <p className="text-xs text-amber-600 mt-2">
              +${fmt(ingresoPendiente)} {bsAprox(ingresoPendiente) ? `(${bsAprox(ingresoPendiente)}) ` : ""}en {pendientesSueltos.length} pago{pendientesSueltos.length === 1 ? "" : "s"} esperando verificación
              {(perfil.rol === "finanzas" || perfil.rol === "admin") && (
                <>
                  {" · "}
                  <Link href="/finanzas" className="underline underline-offset-2 font-medium">ir a Finanzas</Link>
                </>
              )}
            </p>
          )}
        </div>

        <PanelPlanes
          resumen={planes}
          config={config}
          tasaEurVes={tasaEurVes}
          puedeCobrar={perfil.rol === "ventas" || perfil.rol === "finanzas" || perfil.rol === "admin"}
        />

        <div className={`grid gap-3 ${hayPreferencial ? "grid-cols-3" : "grid-cols-2"}`}>
          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <p className="text-xs text-neutral-500">VIP ocupadas</p>
            <p className="text-2xl font-semibold">
              {ocVip.ocupadas} <span className="text-sm font-normal text-neutral-400">/ {aforoVip}</span>
            </p>
            <p className="text-xs text-neutral-600 mt-1">{desglose(ocVip)}</p>
            <p className="text-xs text-neutral-400 mt-1 tabular-nums">Pagado ${fmt(ingresoVip)}{bsAprox(ingresoVip) ? ` · ${bsAprox(ingresoVip)}` : ""}</p>
          </div>
          {hayPreferencial && (
            <div className="bg-white border border-neutral-200 rounded-xl p-4">
              <p className="text-xs text-neutral-500">Preferencial ocupadas</p>
              <p className="text-2xl font-semibold">
                {ocPreferencial.ocupadas} <span className="text-sm font-normal text-neutral-400">/ {aforoPreferencial}</span>
              </p>
              <p className="text-xs text-neutral-600 mt-1">{desglose(ocPreferencial)}</p>
              <p className="text-xs text-neutral-400 mt-1 tabular-nums">Pagado ${fmt(ingresoPreferencial)}{bsAprox(ingresoPreferencial) ? ` · ${bsAprox(ingresoPreferencial)}` : ""}</p>
            </div>
          )}
          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <p className="text-xs text-neutral-500">General ocupadas</p>
            <p className="text-2xl font-semibold">
              {ocGeneral.ocupadas} <span className="text-sm font-normal text-neutral-400">/ {aforoGeneral}</span>
            </p>
            <p className="text-xs text-neutral-600 mt-1">{desglose(ocGeneral)}</p>
            <p className="text-xs text-neutral-400 mt-1 tabular-nums">Pagado ${fmt(ingresoGeneral)}{bsAprox(ingresoGeneral) ? ` · ${bsAprox(ingresoGeneral)}` : ""}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <p className="text-xs text-neutral-500">Preventa ({cupoPreventa.vip} VIP · {cupoPreventa.general} General)</p>
            <p className="text-2xl font-semibold">
              {preventaVip} <span className="text-sm font-normal text-neutral-400">/ {cupoPreventa.vip} VIP</span>
            </p>
            <p className="text-sm font-semibold">
              {preventaGeneral} <span className="text-xs font-normal text-neutral-400">/ {cupoPreventa.general} General</span>
            </p>
            <p className="text-[11px] text-neutral-400 mt-1">Incluye pendientes de verificar</p>
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <p className="text-xs text-neutral-500">Por canal (verificado)</p>
            {["web", "manual", "taquilla", "patrocinio", "cortesia"].map((c) => {
              const d = porCanal.get(c) ?? { cantidad: 0, monto: 0 };
              return (
                <div key={c} className="flex items-center justify-between text-sm">
                  <span className="text-neutral-600">{CANAL_ETIQUETA[c]}</span>
                  <span className="tabular-nums">
                    {d.cantidad} · {c === "patrocinio" || c === "cortesia" ? "sin cobro" : `$${fmt(d.monto)}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-[11px] text-neutral-500 -mt-3">
          {tasaEurVes
            ? `Los montos con ≈ están ${NOTA_TASA_CORTA} (Bs ${tasaEurVes.toLocaleString("es-VE", { maximumFractionDigits: 2 })} por $1) y cambian cada día. Los bolívares por método de pago son los que entraron de verdad.`
            : `${SIN_TASA} — todo sale en dólares hasta que vuelva.`}
        </p>

        <div className="bg-white border border-neutral-200 rounded-xl p-5">
          <p className="text-sm font-semibold mb-3">Ritmo de ventas (últimos días)</p>
          <VentasChart dias={dias} />
        </div>

        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-200">
            <p className="text-sm font-semibold">Por método de pago</p>
          </div>
          <div className="divide-y divide-neutral-100">
            {METODOS_ORDEN.map((m) => {
              const d = porMetodo.get(m) ?? { cantidad: 0, monto: 0, bs: 0 };
              const pct = Math.round((d.monto / maxMonto) * 100);
              return (
                <div key={m} className="px-4 py-3">
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span>{METODO_ETIQUETA[m]}</span>
                    <span className="text-neutral-500 tabular-nums">
                      {d.cantidad} · ${fmt(d.monto)}
                      {d.bs > 0 && <span className="text-neutral-400"> · {formatoBs(d.bs)}</span>}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                    <div className="h-full rounded-full bg-marca-secundario" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </>
  );
}
