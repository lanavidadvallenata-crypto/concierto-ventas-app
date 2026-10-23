import Link from "next/link";
import type { PerfilActual } from "@/lib/perfil";
import type { Config, ResumenPlanes } from "@/lib/abona618";
import { convertirABs } from "@/lib/tasa";
import { NOTA_TASA_CORTA, SIN_TASA, formatoBs, formatoBsAprox } from "@/lib/formato";
import Nav from "@/components/Nav";
import AutoRefresh from "./AutoRefresh";
import VentasChart, { type DiaVenta } from "./VentasChart";
import PanelPlanes from "./PanelPlanes";
import { urbanist } from "./fuente";

// Lo que se VE del Dashboard, separado de lo que se CALCULA (page.tsx).
//
// Rediseño "noche" de 6.18 (Anita, 23 oct): la página lee exactamente los
// mismos números que antes; aquí solo cambia cómo se muestran. Separarlo así
// tiene dos ventajas: el diff del rediseño no toca ninguna cuenta, y la vista
// se puede probar con datos de ejemplo sin base de datos.

export type ZonaDashboard = {
  id: string;
  etiqueta: string;
  aforo: number;
  ocupadas: number;
  pagadas: number;
  enCuotas: number;
  porVerificar: number;
  pagadoUsd: number;
};

export type DatosDashboard = {
  perfil: PerfilActual;
  /** Fecha de hoy en Venezuela, AAAA-MM-DD: solo para la cuenta regresiva. */
  hoy: string;
  tasaEurVes: number | null;
  recaudado: {
    ingresoTotal: number;
    ingresoPendiente: number;
    pagosPorVerificar: number;
    cuotasCobradas: number;
    enBanco: number;
    metaIngresos: number;
    vendidosTotal: number;
    aforoTotalEntradas: number;
    pctVendido: number;
    ocupadasTotal: number;
  };
  zonas: ZonaDashboard[];
  preventa: { vip: number; general: number; cupoVip: number; cupoGeneral: number };
  canales: { id: string; etiqueta: string; cantidad: number; monto: number; sinCobro: boolean }[];
  metodos: { id: string; etiqueta: string; cantidad: number; monto: number; bs: number; pct: number }[];
  dias: DiaVenta[];
  planes: ResumenPlanes;
  config: Config;
};

const FECHA_EVENTO = "2026-12-04";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function cuentaRegresiva(hoy: string): string | null {
  const dias = Math.round((Date.parse(`${FECHA_EVENTO}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(dias) || dias < 0) return null;
  if (dias === 0) return "hoy es el evento";
  return dias === 1 ? "falta 1 día" : `faltan ${dias} días`;
}

const desglose = (o: { pagadas: number; enCuotas: number; porVerificar: number }) =>
  [`${o.pagadas} pagada${o.pagadas === 1 ? "" : "s"}`, o.enCuotas ? `${o.enCuotas} en cuotas` : "", o.porVerificar ? `${o.porVerificar} por verificar` : ""]
    .filter(Boolean)
    .join(" · ");

// Ancho de un tramo de barra. Un tramo que existe nunca queda invisible:
// 13 en cuotas sobre 4.500 generales es 0,3 % y sin el mínimo de 2 px no se
// vería que hay algo ahí.
const tramo = (n: number, de: number) => (de > 0 && n > 0 ? `max(2px, ${Math.min(100, (n / de) * 100)}%)` : "0%");

const TARJETA = "rounded-[20px] bg-white/[0.04] border border-white/10";

export default function VistaDashboard(d: DatosDashboard) {
  const r = d.recaudado;
  const bsAprox = (usd: number) => (d.tasaEurVes ? formatoBsAprox(convertirABs(usd, d.tasaEurVes)) : null);
  const faltan = cuentaRegresiva(d.hoy);
  const verFinanzas = d.perfil.rol === "finanzas" || d.perfil.rol === "admin";
  const preventaAgotada = d.preventa.vip >= d.preventa.cupoVip && d.preventa.general >= d.preventa.cupoGeneral;

  return (
    <div className={`${urbanist.variable} tema-noche flex-1 flex flex-col bg-noche text-noche-texto [color-scheme:dark]`}>
      <Nav perfil={d.perfil} tema="noche" />

      <div className="relative flex-1 overflow-x-clip">
        {/* Fondo: la cuadrícula tenue, el resplandor morado y el círculo
            partido del logo de 6.18. Pura decoración. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[380px] overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(241,236,226,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(241,236,226,0.035)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_80%_70%_at_85%_0%,#000_25%,transparent_75%)]" />
          <div className="absolute -right-28 -top-44 w-[540px] h-[440px] bg-[radial-gradient(ellipse_50%_50%_at_50%_50%,rgba(123,44,191,0.42),rgba(63,10,98,0.18)_50%,transparent_72%)]" />
          <div className="absolute -right-[70px] -top-[110px] w-[220px] h-[220px] rounded-full border border-lila/20" />
          <div className="absolute right-[40px] -top-[110px] w-[110px] h-[220px] rounded-l-full bg-gradient-to-b from-violeta-hondo/35 to-marca-secundario/60" />
        </div>

        <main className="relative max-w-3xl mx-auto w-full px-4 pt-7 pb-12 flex flex-col gap-5">
          <header className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold tracking-[0.28em] uppercase text-noche-tenue">Dashboard de ventas</p>
              <AutoRefresh tema="noche" />
            </div>
            <h1 className="font-titular italic font-extrabold text-[40px] leading-[1.02] tracking-[-0.01em] text-noche-texto [text-wrap:balance]">
              Navidad Vallenata.
            </h1>
            <p className="text-sm text-noche-suave">
              Vie 4 dic · Hangar Grano de Oro, Maracaibo{faltan ? ` · ${faltan}` : ""}
            </p>
          </header>

          {/* Lo primero que se mira: cuánto entró de verdad. */}
          <section className="rounded-[22px] border border-lila/30 bg-[linear-gradient(160deg,rgba(123,44,191,0.32),rgba(241,236,226,0.035)_62%)] shadow-[0_24px_60px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.07)] p-5 flex flex-col gap-4">
            <div>
              <p className="text-xs font-medium text-noche-suave">Recaudado · pagos verificados</p>
              <p className="font-titular font-extrabold text-[52px] leading-none mt-2 text-white tabular-nums">${fmt(r.ingresoTotal)}</p>
              {bsAprox(r.ingresoTotal) && <p className="text-sm text-noche-suave mt-2 tabular-nums">{bsAprox(r.ingresoTotal)}</p>}
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-3 text-xs text-noche-suave tabular-nums">
                <span>
                  {fmt(r.vendidosTotal)} pagadas de {fmt(r.aforoTotalEntradas)} entradas
                </span>
                <span className="text-base font-semibold text-noche-texto">{r.pctVendido}%</span>
              </div>
              <div className="mt-2 h-2.5 rounded-full bg-white/[0.08] overflow-hidden">
                <div
                  className="h-full rounded-full bg-violeta shadow-[0_0_14px_rgba(155,93,224,0.8)]"
                  style={{ width: tramo(r.vendidosTotal, r.aforoTotalEntradas) }}
                />
              </div>
              <p className="text-[11px] text-noche-tenue mt-2 tabular-nums">
                {fmt(r.ocupadasTotal)} ocupadas contando cuotas · meta a aforo completo ${fmt(r.metaIngresos)}
              </p>
            </div>

            {r.cuotasCobradas > 0 && (
              <dl className="grid grid-cols-2 gap-3 pt-4 border-t border-white/10">
                <div>
                  <dt className="text-[11px] text-noche-tenue">Cuotas ya cobradas</dt>
                  <dd className="text-lg font-semibold tabular-nums">+${fmt(r.cuotasCobradas)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-noche-tenue">Total en banco</dt>
                  <dd className="text-lg font-semibold tabular-nums text-lila-claro">${fmt(r.enBanco)}</dd>
                </div>
              </dl>
            )}

            {r.ingresoPendiente > 0 && (
              <p className="text-xs text-amber-200 rounded-xl bg-amber-400/10 border border-amber-300/25 px-3 py-2.5">
                +${fmt(r.ingresoPendiente)} {bsAprox(r.ingresoPendiente) ? `(${bsAprox(r.ingresoPendiente)}) ` : ""}en {r.pagosPorVerificar} pago
                {r.pagosPorVerificar === 1 ? "" : "s"} esperando verificación
                {verFinanzas && (
                  <>
                    {" · "}
                    <Link href="/finanzas" className="underline underline-offset-2 font-semibold">
                      ir a Finanzas
                    </Link>
                  </>
                )}
              </p>
            )}
          </section>

          <PanelPlanes
            resumen={d.planes}
            config={d.config}
            tasaEurVes={d.tasaEurVes}
            puedeCobrar={d.perfil.rol === "ventas" || d.perfil.rol === "finanzas" || d.perfil.rol === "admin"}
          />

          <section className={`${TARJETA} p-5 flex flex-col gap-5`}>
            <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
              <h2 className="text-[15px] font-semibold">Ocupación por zona</h2>
              <ul className="flex items-center gap-3 text-[11px] text-noche-tenue">
                <li className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-violeta" />
                  pagadas
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-lila/50" />
                  en cuotas
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  por verificar
                </li>
              </ul>
            </div>

            {d.zonas.map((z) => (
              <div key={z.id} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold">{z.etiqueta}</span>
                  <span className="tabular-nums">
                    <span className="font-titular font-extrabold text-[26px] leading-none text-white">{z.ocupadas}</span>
                    <span className="text-sm text-noche-tenue"> / {fmt(z.aforo)}</span>
                  </span>
                </div>
                <div
                  className="flex h-2 rounded-full bg-white/[0.08] overflow-hidden"
                  role="img"
                  aria-label={`${z.etiqueta}: ${z.ocupadas} de ${z.aforo} ocupadas (${desglose(z)})`}
                >
                  <div className="h-full bg-violeta" style={{ width: tramo(z.pagadas, z.aforo) }} />
                  <div className="h-full bg-lila/50" style={{ width: tramo(z.enCuotas, z.aforo) }} />
                  <div className="h-full bg-amber-400" style={{ width: tramo(z.porVerificar, z.aforo) }} />
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-noche-suave">{desglose(z)}</span>
                  <span className="flex flex-col items-end text-right tabular-nums">
                    <span className="text-noche-suave">Pagado ${fmt(z.pagadoUsd)}</span>
                    {bsAprox(z.pagadoUsd) && <span className="text-[11px] text-noche-tenue">{bsAprox(z.pagadoUsd)}</span>}
                  </span>
                </div>
              </div>
            ))}
          </section>

          <section className={`${TARJETA} p-5`}>
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h2 className="text-[15px] font-semibold">Ritmo de ventas</h2>
              <span className="text-[11px] text-noche-tenue">verificadas por día</span>
            </div>
            <VentasChart dias={d.dias} />
          </section>

          <div className="grid gap-5 sm:grid-cols-2">
            <section className={`${TARJETA} p-5`}>
              <h2 className="text-[15px] font-semibold">
                Por canal <span className="text-xs font-normal text-noche-tenue">· verificado</span>
              </h2>
              <dl className="mt-2 flex flex-col divide-y divide-white/[0.06]">
                {d.canales.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <dt className="text-noche-suave">{c.etiqueta}</dt>
                    <dd className="tabular-nums">
                      {c.cantidad} <span className="text-noche-tenue">· {c.sinCobro ? "sin cobro" : `$${fmt(c.monto)}`}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className={`${TARJETA} p-5 flex flex-col gap-3`}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-semibold">Preventa</h2>
                {preventaAgotada && (
                  <span className="text-[10px] font-bold tracking-[0.12em] text-red-100 bg-[#CE0100]/30 border border-[#CE0100]/60 rounded-full px-2.5 py-0.5">
                    AGOTADA
                  </span>
                )}
              </div>
              {[
                { etiqueta: "VIP", n: d.preventa.vip, de: d.preventa.cupoVip },
                { etiqueta: "General", n: d.preventa.general, de: d.preventa.cupoGeneral },
              ].map((p) => (
                <div key={p.etiqueta} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-noche-suave">{p.etiqueta}</span>
                    <span className="tabular-nums font-semibold">
                      {p.n} <span className="font-normal text-noche-tenue">/ {p.de}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <div className="h-full rounded-full bg-violeta" style={{ width: tramo(p.n, p.de) }} />
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-noche-tenue">Incluye pendientes de verificar</p>
            </section>
          </div>

          <section className={`${TARJETA} overflow-hidden`}>
            <h2 className="px-5 pt-5 pb-2 text-[15px] font-semibold">Por método de pago</h2>
            <div className="divide-y divide-white/[0.06]">
              {d.metodos.map((m) => (
                <div key={m.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3 text-sm mb-2">
                    <span>{m.etiqueta}</span>
                    <span className="flex flex-col items-end text-right tabular-nums">
                      <span className="text-noche-suave">
                        {m.cantidad} · ${fmt(m.monto)}
                      </span>
                      {m.bs > 0 && <span className="text-xs text-noche-tenue">{formatoBs(m.bs)}</span>}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <div className="h-full rounded-full bg-violeta" style={{ width: `${m.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <p className="text-[11px] leading-relaxed text-noche-tenue">
            {d.tasaEurVes
              ? `Los montos con ≈ están ${NOTA_TASA_CORTA} (Bs ${d.tasaEurVes.toLocaleString("es-VE", { maximumFractionDigits: 2 })} por $1) y cambian cada día. Los bolívares por método de pago son los que entraron de verdad.`
              : `${SIN_TASA} — todo sale en dólares hasta que vuelva.`}
          </p>
        </main>
      </div>
    </div>
  );
}
