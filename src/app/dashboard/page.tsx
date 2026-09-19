import { redirect } from "next/navigation";
import { getPerfilActual } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import { calcularTotal } from "@/lib/precios";
import Nav from "@/components/Nav";
import VentasChart from "./VentasChart";
import AutoRefresh from "./AutoRefresh";
import Link from "next/link";

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

const CANAL_ETIQUETA: Record<string, string> = { web: "Web", manual: "Manual", taquilla: "Taquilla" };

export default async function DashboardPage() {
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

  const [{ data: tickets }, { data: evento }, { count: sillasVipTotal }] = await Promise.all([
    service.from("tickets").select("tipo, precio, metodo_pago, estado_pago, created_at, canal, etapa"),
    service.from("eventos").select("aforo_general_total").limit(1).single(),
    service.from("sillas_vip").select("id", { count: "exact", head: true }),
  ]);

  const todos = tickets ?? [];
  const verificados = todos.filter((t) => t.estado_pago === "verificado");
  const pendientes = todos.filter((t) => t.estado_pago === "pendiente");

  const vipVerificados = verificados.filter((t) => t.tipo === "vip");
  const generalVerificados = verificados.filter((t) => t.tipo === "general");

  const ingresoTotal = verificados.reduce((s, t) => s + Number(t.precio), 0);
  const ingresoPendiente = pendientes.reduce((s, t) => s + Number(t.precio), 0);
  const ingresoVip = vipVerificados.reduce((s, t) => s + Number(t.precio), 0);
  const ingresoGeneral = generalVerificados.reduce((s, t) => s + Number(t.precio), 0);

  const aforoGeneral = evento?.aforo_general_total ?? 4500;
  const aforoVip = sillasVipTotal ?? 300;
  const metaIngresos = aforoVip * calcularTotal("vip").total + aforoGeneral * calcularTotal("general").total;

  const porMetodo = new Map<string, { cantidad: number; monto: number }>();
  for (const t of verificados) {
    const actual = porMetodo.get(t.metodo_pago) ?? { cantidad: 0, monto: 0 };
    actual.cantidad += 1;
    actual.monto += Number(t.precio);
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

  const porDia = new Map<string, number>();
  for (const t of verificados) {
    const dia = new Date(t.created_at).toLocaleDateString("sv-SE", { timeZone: "America/Caracas" });
    porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
  }
  const dias = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14) as [string, number][];

  const vendidosTotal = verificados.length;
  const aforoTotalEntradas = aforoVip + aforoGeneral;
  const pctVendido = aforoTotalEntradas > 0 ? Math.round((vendidosTotal / aforoTotalEntradas) * 1000) / 10 : 0;

  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

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
              <p className="text-xs text-neutral-400 mt-1">Meta a aforo completo: ${fmt(metaIngresos)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-neutral-500">{vendidosTotal} de {aforoTotalEntradas} entradas</p>
              <p className="text-2xl font-semibold">{pctVendido}%</p>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div className="h-full rounded-full bg-marca-secundario" style={{ width: `${Math.min(pctVendido, 100)}%` }} />
          </div>
          {ingresoPendiente > 0 && (
            <p className="text-xs text-amber-600 mt-2">
              +${fmt(ingresoPendiente)} en {pendientes.length} pago{pendientes.length === 1 ? "" : "s"} esperando verificación
              {(perfil.rol === "finanzas" || perfil.rol === "admin") && (
                <>
                  {" · "}
                  <Link href="/finanzas" className="underline underline-offset-2 font-medium">ir a Finanzas</Link>
                </>
              )}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <p className="text-xs text-neutral-500">VIP vendidos</p>
            <p className="text-2xl font-semibold">
              {vipVerificados.length} <span className="text-sm font-normal text-neutral-400">/ {aforoVip}</span>
            </p>
            <p className="text-xs text-neutral-400 mt-1">${fmt(ingresoVip)}</p>
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <p className="text-xs text-neutral-500">General vendidos</p>
            <p className="text-2xl font-semibold">
              {generalVerificados.length} <span className="text-sm font-normal text-neutral-400">/ {aforoGeneral}</span>
            </p>
            <p className="text-xs text-neutral-400 mt-1">${fmt(ingresoGeneral)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <p className="text-xs text-neutral-500">Preventa (30 VIP · 50 General)</p>
            <p className="text-2xl font-semibold">
              {preventaVip} <span className="text-sm font-normal text-neutral-400">/ 30 VIP</span>
            </p>
            <p className="text-sm font-semibold">
              {preventaGeneral} <span className="text-xs font-normal text-neutral-400">/ 50 General</span>
            </p>
            <p className="text-[11px] text-neutral-400 mt-1">Incluye pendientes de verificar</p>
          </div>
          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <p className="text-xs text-neutral-500">Por canal (verificado)</p>
            {["web", "manual", "taquilla"].map((c) => {
              const d = porCanal.get(c) ?? { cantidad: 0, monto: 0 };
              return (
                <div key={c} className="flex items-center justify-between text-sm">
                  <span className="text-neutral-600">{CANAL_ETIQUETA[c]}</span>
                  <span className="tabular-nums">{d.cantidad} · ${fmt(d.monto)}</span>
                </div>
              );
            })}
          </div>
        </div>

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
              const d = porMetodo.get(m) ?? { cantidad: 0, monto: 0 };
              const pct = Math.round((d.monto / maxMonto) * 100);
              return (
                <div key={m} className="px-4 py-3">
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span>{METODO_ETIQUETA[m]}</span>
                    <span className="text-neutral-500">
                      {d.cantidad} · ${fmt(d.monto)}
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
