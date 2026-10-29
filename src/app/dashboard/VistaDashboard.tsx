import Link from "next/link";
import type { PerfilActual } from "@/lib/perfil";
import type { Config, ResumenPlanes } from "@/lib/abona618";
import { convertirABs } from "@/lib/tasa";
import { NOTA_TASA_CORTA, SIN_TASA, formatoBs, formatoBsAprox } from "@/lib/formato";
import MarcoNoche, { EncabezadoNoche, TARJETA } from "@/components/noche/MarcoNoche";
import AutoRefresh from "./AutoRefresh";
import VentasChart, { type DiaVenta } from "./VentasChart";
import PanelPlanes from "./PanelPlanes";
import Pestanas from "./Pestanas";
import { Kpi, VistaCanales, VistaEmbudo, VistaHoy, type DatosEmbudo } from "./PanelEmbudo";
import { duracionCorta, type Ritmo } from "@/lib/embudo";

export type { DatosEmbudo };

// Lo que se VE del Dashboard, separado de lo que se CALCULA (page.tsx).
//
// 29 oct (Anita: "demasiado texto, el choricero pa abajo"): arriba solo el
// recaudado y el avance; todo lo demás va en cinco pestañas que caben cada una
// en una pantalla del teléfono — Hoy, Embudo, Canales, Zonas y Caja.

export type ZonaDashboard = {
  id: string;
  etiqueta: string;
  aforo: number;
  ocupadas: number;
  pagadas: number;
  enCuotas: number;
  porVerificar: number;
  pagadoUsd: number;
  ritmo: Ritmo;
};

export type DatosDashboard = {
  perfil: PerfilActual;
  /** Fecha de hoy en Venezuela, AAAA-MM-DD: solo para la cuenta regresiva. */
  hoy: string;
  tasaEurVes: number | null;
  /** Pestaña con la que abre (?v=). */
  vistaInicial: string;
  /** Embudo, canales, ritmo y horas (29 oct). */
  embudo: DatosEmbudo;
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
const dec = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

function diasParaEvento(hoy: string): number | null {
  const dias = Math.round((Date.parse(`${FECHA_EVENTO}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(dias) && dias >= 0 ? dias : null;
}

// Ancho de un tramo de barra. Un tramo que existe nunca queda invisible:
// 13 en cuotas sobre 4.500 generales es 0,3 % y sin el mínimo de 2 px no se
// vería que hay algo ahí.
const tramo = (n: number, de: number) => (de > 0 && n > 0 ? `max(2px, ${Math.min(100, (n / de) * 100)}%)` : "0%");

// "En cuotas" va rayado y no en otro tono de morado: dos morados de igual
// brillo se confunden con sol o con daltonismo (auditoría del 23 oct).
const RAYADO = "bg-[repeating-linear-gradient(135deg,#9b5de0_0_2px,transparent_2px_5px)]";

export default function VistaDashboard(d: DatosDashboard) {
  const r = d.recaudado;
  const bsAprox = (usd: number) => (d.tasaEurVes ? formatoBsAprox(convertirABs(usd, d.tasaEurVes)) : null);
  const dias = diasParaEvento(d.hoy);
  const verFinanzas = d.perfil.rol === "finanzas" || d.perfil.rol === "admin";
  const esAdmin = d.perfil.rol === "admin";
  const viejo = d.embudo.pendienteMasViejoMin;
  const verificacionAtrasada = r.pagosPorVerificar > 0 && viejo != null && viejo > 3 * 60;

  return (
    <MarcoNoche perfil={d.perfil}>
      <EncabezadoNoche compacto seccion="Dashboard" titulo="Navidad Vallenata." derecha={<AutoRefresh tema="noche" intervaloMs={15000} />} />

      {/* Lo único fijo arriba: cuánto entró y cuánto falta. */}
      <section className="rounded-[22px] border border-lila/30 bg-[linear-gradient(160deg,rgba(123,44,191,0.32),rgba(241,236,226,0.035)_62%)] shadow-[0_18px_44px_rgba(0,0,0,0.35)] p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-noche-suave">Recaudado</p>
            <p className="font-titular font-extrabold text-[40px] leading-none mt-1 text-white tabular-nums">${fmt(r.ingresoTotal)}</p>
          </div>
          {dias != null && (
            <div className="shrink-0 text-right">
              <p className="font-titular font-extrabold text-[28px] leading-none text-white tabular-nums">{dias}</p>
              <p className="text-[11px] text-noche-tenue">días al evento</p>
            </div>
          )}
        </div>
        <div>
          <div className="h-2 rounded-full bg-white/[0.08] overflow-hidden">
            <div className="h-full rounded-full bg-violeta shadow-[0_0_12px_rgba(155,93,224,0.8)]" style={{ width: tramo(r.vendidosTotal, r.aforoTotalEntradas) }} />
          </div>
          <p className="flex justify-between gap-3 text-xs text-noche-suave tabular-nums mt-1.5">
            <span>
              {fmt(r.vendidosTotal)} pagadas · {fmt(r.ocupadasTotal)} ocupadas
            </span>
            <span className="text-noche-texto font-semibold">
              {r.pctVendido}% de {fmt(r.aforoTotalEntradas)}
            </span>
          </p>
        </div>
      </section>

      <Pestanas
        inicial={d.vistaInicial}
        pestanas={[
          { id: "hoy", etiqueta: "Ahora", alerta: verificacionAtrasada, contenido: <VistaHoy e={d.embudo} porVerificar={r.pagosPorVerificar} /> },
          { id: "embudo", etiqueta: "Embudo", contenido: <VistaEmbudo e={d.embudo} puedeActivar={esAdmin} /> },
          { id: "canales", etiqueta: "Canales", contenido: <VistaCanales e={d.embudo} puedeActivar={esAdmin} /> },
          {
            id: "zonas",
            etiqueta: "Zonas",
            contenido: (
              <>
                <Zonas zonas={d.zonas} />
                <section className={`${TARJETA} p-4`}>
                  <VentasChart dias={d.dias} hoy={d.hoy} />
                </section>
              </>
            ),
          },
          {
            id: "caja",
            etiqueta: "Caja",
            alerta: verificacionAtrasada,
            contenido: (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <Kpi valor={`$${fmt(r.enBanco)}`} etiqueta="Total en banco" pie={bsAprox(r.enBanco) ?? undefined} tono="ok" />
                  <Kpi valor={`$${fmt(r.cuotasCobradas)}`} etiqueta="Cuotas cobradas" pie="ya en el banco" />
                  <Kpi
                    valor={`$${fmt(r.ingresoPendiente)}`}
                    etiqueta={`Por verificar (${r.pagosPorVerificar})`}
                    pie={viejo != null && r.pagosPorVerificar > 0 ? `más viejo: ${duracionCorta(viejo)}` : "al día"}
                    tono={verificacionAtrasada ? "ambar" : null}
                  />
                  <Kpi
                    valor={d.embudo.verificacionMin != null ? duracionCorta(d.embudo.verificacionMin) : "—"}
                    etiqueta="Tarda en verificarse"
                    pie={d.embudo.verificacionMuestra ? `mediana de ${d.embudo.verificacionMuestra}, 14 días` : "contado"}
                  />
                </div>
                {verFinanzas && r.pagosPorVerificar > 0 && (
                  <Link
                    href="/finanzas"
                    className="h-11 rounded-xl bg-violeta-hondo text-white text-sm font-semibold inline-flex items-center justify-center"
                  >
                    Ir a Finanzas a verificar
                  </Link>
                )}
                <PanelPlanes
                  resumen={d.planes}
                  config={d.config}
                  tasaEurVes={d.tasaEurVes}
                  puedeCobrar={d.perfil.rol === "ventas" || d.perfil.rol === "finanzas" || d.perfil.rol === "admin"}
                />
                <Filas
                  titulo="Por método de pago"
                  filas={d.metodos
                    .filter((m) => m.cantidad > 0)
                    .map((m) => ({
                      id: m.id,
                      etiqueta: m.etiqueta,
                      n: m.cantidad,
                      valor: `$${fmt(m.monto)}`,
                      sub: m.bs > 0 ? formatoBs(m.bs) : null,
                      pct: m.pct,
                    }))}
                />
                <Filas
                  titulo="Por tipo de venta"
                  filas={d.canales
                    .filter((c) => c.cantidad > 0)
                    .map((c) => ({ id: c.id, etiqueta: c.etiqueta, n: c.cantidad, valor: c.sinCobro ? "sin cobro" : `$${fmt(c.monto)}`, sub: null, pct: null }))}
                />
                <p className="text-[11px] leading-relaxed text-noche-tenue">
                  {d.tasaEurVes
                    ? `≈ ${NOTA_TASA_CORTA} (Bs ${d.tasaEurVes.toLocaleString("es-VE", { maximumFractionDigits: 2 })} por $1).`
                    : `${SIN_TASA}.`}
                </p>
              </>
            ),
          },
        ]}
      />
    </MarcoNoche>
  );
}

// ---------------------------------------------------------------------------
// Zonas: ocupación y ritmo, una fila compacta por zona.
// ---------------------------------------------------------------------------
function Zonas({ zonas }: { zonas: ZonaDashboard[] }) {
  return (
    <section className={`${TARJETA} p-4 flex flex-col gap-4`}>
      <ul className="flex items-center gap-3 text-[11px] text-noche-tenue">
        <li className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-violeta" />
          pagadas
        </li>
        <li className="flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-sm border border-violeta/70 ${RAYADO}`} />
          cuotas
        </li>
        <li className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />
          por verificar
        </li>
      </ul>
      {zonas.map((z) => (
        <div key={z.id} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">{z.etiqueta}</span>
            <span className="tabular-nums">
              <span className="font-titular font-extrabold text-[22px] leading-none text-white">{fmt(z.ocupadas)}</span>
              <span className="text-xs text-noche-tenue"> / {fmt(z.aforo)}</span>
            </span>
          </div>
          <div
            className="flex gap-[2px] h-2 rounded-full bg-white/[0.08] overflow-hidden"
            role="img"
            aria-label={`${z.etiqueta}: ${z.ocupadas} de ${z.aforo} ocupadas (${z.pagadas} pagadas, ${z.enCuotas} en cuotas, ${z.porVerificar} por verificar)`}
          >
            {z.pagadas > 0 && <div className="h-full shrink-0 bg-violeta" style={{ width: tramo(z.pagadas, z.aforo) }} />}
            {z.enCuotas > 0 && <div className={`h-full shrink-0 ${RAYADO}`} style={{ width: tramo(z.enCuotas, z.aforo) }} />}
            {z.porVerificar > 0 && <div className="h-full shrink-0 bg-amber-400" style={{ width: tramo(z.porVerificar, z.aforo) }} />}
          </div>
          <div className="flex items-center justify-between gap-3 text-xs tabular-nums">
            <span className="flex items-center gap-1.5 text-noche-suave">
              <span className={`w-2 h-2 rounded-full ${z.ritmo.vaBien ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden="true" />
              {dec(z.ritmo.real)}/día {z.ritmo.vaBien ? "· alcanza" : `· faltan ${dec(z.ritmo.necesario)}/día`}
            </span>
            <span className="text-noche-tenue">4 dic: {z.ritmo.proyeccionPct}%</span>
          </div>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lista compacta: una línea por fila, con barra opcional.
// ---------------------------------------------------------------------------
function Filas({
  titulo,
  filas,
}: {
  titulo: string;
  filas: { id: string; etiqueta: string; n: number; valor: string; sub: string | null; pct: number | null }[];
}) {
  if (filas.length === 0) return null;
  return (
    <section className={`${TARJETA} p-4 flex flex-col gap-1`}>
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-noche-tenue pb-1">{titulo}</h2>
      {filas.map((f) => (
        <div key={f.id} className="py-1.5 flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-noche-suave">
              {f.etiqueta} <span className="text-noche-tenue tabular-nums">· {fmt(f.n)}</span>
            </span>
            <span className="text-right tabular-nums">
              <span className="font-semibold text-white">{f.valor}</span>
              {f.sub && <span className="block text-[11px] text-noche-tenue">{f.sub}</span>}
            </span>
          </div>
          {f.pct != null && (
            <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div className="h-full rounded-full bg-violeta" style={{ width: `${f.pct}%` }} />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
