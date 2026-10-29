import Link from "next/link";
import { TARJETA } from "@/components/noche/MarcoNoche";
import type { Tipo } from "@/lib/precios";
import {
  duracionCorta,
  etiquetaCanal,
  mayorFuga,
  pasosDelEmbudo,
  PERIODOS,
  type Periodo,
  type ResumenEmbudo,
  type Ritmo,
} from "@/lib/embudo";

// Vistas del embudo (Anita, 29 oct). Pensadas para el teléfono: números
// grandes, etiquetas de dos palabras, cada vista en una pantalla. Solo pintan:
// los números llegan calculados desde page.tsx y resumen_embudo.

export type DatosEmbudo = {
  periodo: Periodo;
  zona: Tipo | null;
  /** null = falta correr supabase/medicion_embudo_29oct.sql. */
  resumen: ResumenEmbudo | null;
  ritmo: Ritmo;
  comprasHoy: number;
  porHora: number[];
  verificacionMin: number | null;
  verificacionMuestra: number;
  pendienteMasViejoMin: number | null;
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
// Mismo formato que el resto del Dashboard ($9,252 · 2.9%).
const dec = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const pctTxt = (n: number | null) => (n == null ? "—" : `${dec(n)}%`);
const hora12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------
type Tono = "ok" | "ambar" | "rojo" | null;

export function Kpi({ valor, etiqueta, pie, tono = null }: { valor: string; etiqueta: string; pie?: string; tono?: Tono }) {
  const marco =
    tono === "rojo" ? "border-red-400/40 bg-red-500/10" : tono === "ambar" ? "border-amber-300/35 bg-amber-400/10" : "border-white/10 bg-white/[0.04]";
  const color = tono === "rojo" ? "text-red-200" : tono === "ambar" ? "text-amber-200" : tono === "ok" ? "text-emerald-200" : "text-noche-tenue";
  return (
    <div className={`rounded-2xl border px-3.5 py-3 flex flex-col gap-0.5 min-w-0 ${marco}`}>
      <span className="font-titular font-extrabold text-[26px] leading-none text-white tabular-nums truncate">{valor}</span>
      <span className="text-xs font-medium text-noche-suave truncate">{etiqueta}</span>
      {pie && <span className={`text-[11px] truncate ${color}`}>{pie}</span>}
    </div>
  );
}

function Chip({ tono, children }: { tono: "ok" | "ambar"; children: string }) {
  return (
    <span
      className={`text-[11px] font-bold uppercase tracking-[0.08em] rounded-full px-2 py-0.5 border ${
        tono === "ok" ? "text-emerald-200 bg-emerald-500/10 border-emerald-400/30" : "text-amber-200 bg-amber-400/10 border-amber-300/35"
      }`}
    >
      {children}
    </span>
  );
}

const enlace = (v: string, p: Periodo, z: Tipo | null) => `/dashboard?v=${v}&p=${p}${z ? `&z=${z}` : ""}`;

function Filtros({ e, vista, conZona }: { e: DatosEmbudo; vista: string; conZona: boolean }) {
  const zonas: { id: Tipo | null; etiqueta: string }[] = [
    { id: null, etiqueta: "Todas" },
    { id: "vip", etiqueta: "VIP" },
    { id: "preferencial", etiqueta: "Pref." },
    { id: "general", etiqueta: "General" },
  ];
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <nav aria-label="Período" className="flex rounded-full border border-white/10 bg-white/[0.04] p-0.5">
        {PERIODOS.map((p) => (
          <Link
            key={p.id}
            href={enlace(vista, p.id, e.zona)}
            aria-current={e.periodo === p.id ? "page" : undefined}
            className={`h-8 px-3 rounded-full text-xs font-semibold inline-flex items-center ${
              e.periodo === p.id ? "bg-violeta-hondo text-white" : "text-noche-suave"
            }`}
          >
            {p.etiqueta}
          </Link>
        ))}
      </nav>
      {conZona && (
        <nav aria-label="Zona" className="flex gap-1">
          {zonas.map((z) => (
            <Link
              key={z.etiqueta}
              href={enlace(vista, e.periodo, z.id)}
              aria-current={e.zona === z.id ? "page" : undefined}
              className={`h-8 px-2.5 rounded-full text-xs font-medium inline-flex items-center border ${
                e.zona === z.id ? "bg-white/15 border-white/30 text-white" : "border-white/10 text-noche-tenue"
              }`}
            >
              {z.etiqueta}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

function SinMedicion({ puedeActivar }: { puedeActivar: boolean }) {
  return (
    <p className="text-sm rounded-2xl border border-amber-300/35 bg-amber-400/10 px-4 py-3 text-amber-100">
      Medición sin activar. {puedeActivar ? "Corre medicion_embudo_29oct.sql en Supabase." : "Avísale a Anita."}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Vista "Hoy": lo que pasa ahora, el ritmo y la hora pico.
// ---------------------------------------------------------------------------
export function VistaHoy({ e, porVerificar }: { e: DatosEmbudo; porVerificar: number }) {
  const r = e.resumen;
  const viejo = e.pendienteMasViejoMin;
  const tonoVerif: Tono = porVerificar > 0 && viejo != null ? (viejo > 12 * 60 ? "rojo" : viejo > 3 * 60 ? "ambar" : null) : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi valor={r ? fmt(r.vivo.activos5min) : "—"} etiqueta="En la web" pie="últimos 5 min" />
        <Kpi valor={r ? fmt(r.vivo.enPago) : "—"} etiqueta="Pagando ahora" pie="con entradas apartadas" />
        <Kpi valor={fmt(e.comprasHoy)} etiqueta="Compras hoy" pie="web y equipo" />
        <Kpi
          valor={fmt(porVerificar)}
          etiqueta="Por verificar"
          pie={porVerificar > 0 && viejo != null ? `más viejo: ${duracionCorta(viejo)}` : "al día"}
          tono={tonoVerif ?? (porVerificar === 0 ? "ok" : null)}
        />
      </div>
      <TarjetaRitmo r={e.ritmo} />
      <MiniHoras horas={e.porHora} />
    </>
  );
}

function TarjetaRitmo({ r }: { r: Ritmo }) {
  const avance = r.necesario > 0 ? Math.min(100, (r.real / r.necesario) * 100) : 100;
  return (
    <section className={`${TARJETA} p-4 flex flex-col gap-2.5`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-noche-tenue">Ritmo · 7 días</h2>
        <Chip tono={r.vaBien ? "ok" : "ambar"}>{r.vaBien ? "Alcanza" : "Bajo"}</Chip>
      </div>
      <p className="tabular-nums flex items-baseline gap-1.5 flex-wrap">
        <span className="font-titular font-extrabold text-[34px] leading-none text-white">{dec(r.real)}</span>
        <span className="text-sm text-noche-suave">/día</span>
        <span className="text-sm text-noche-tenue">de {dec(r.necesario)} necesarias</span>
      </p>
      <div className="h-2 rounded-full bg-white/[0.08] overflow-hidden" role="img" aria-label={`${Math.round(avance)} % del ritmo necesario`}>
        <div className={`h-full rounded-full ${r.vaBien ? "bg-emerald-400" : "bg-amber-400"}`} style={{ width: `max(3px, ${avance}%)` }} />
      </div>
      <p className="text-xs text-noche-suave tabular-nums">
        Al 4 dic: <strong className="text-white">{r.proyeccionPct}%</strong> del aforo · {r.diasRestantes} días
      </p>
    </section>
  );
}

function MiniHoras({ horas }: { horas: number[] }) {
  const max = Math.max(...horas);
  const total = horas.reduce((s, n) => s + n, 0);
  const pico = max > 0 && total >= 10 ? horas.indexOf(max) : null;
  return (
    <section className={`${TARJETA} p-4 flex flex-col gap-2`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-noche-tenue">Hora de compra · 14 días</h2>
        {pico != null && (
          <span className="text-sm text-noche-suave">
            pico <strong className="text-white">{hora12(pico)}</strong>
          </span>
        )}
      </div>
      <div className="flex items-end gap-[3px] h-16" role="img" aria-label={`Compras por hora. Pico: ${pico != null ? hora12(pico) : "sin datos"}`}>
        {horas.map((n, h) => (
          <div key={h} className="flex-1 h-full flex flex-col justify-end">
            <div
              className={`w-full rounded-t-[2px] ${h === pico ? "bg-lila" : "bg-violeta/70"}`}
              style={{ height: max > 0 && n > 0 ? `max(2px, ${(n / max) * 100}%)` : "1px", opacity: n > 0 ? 1 : 0.25 }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-noche-tenue tabular-nums">
        {[0, 6, 12, 18, 23].map((h) => (
          <span key={h}>{hora12(h)}</span>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Vista "Embudo"
// ---------------------------------------------------------------------------
const CORTO: Record<string, string> = {
  visitantes: "Visitas",
  tienda: "Vieron tienda",
  continuar: "Continuar",
  pago: "En el pago",
  reporto: "Reportó",
  confirmado: "Confirmado",
};

export function VistaEmbudo({ e, puedeActivar }: { e: DatosEmbudo; puedeActivar: boolean }) {
  const r = e.resumen;
  return (
    <>
      <Filtros e={e} vista="embudo" conZona />
      {!r ? (
        <SinMedicion puedeActivar={puedeActivar} />
      ) : r.pasos.visitantes === 0 ? (
        <p className="text-sm text-noche-suave rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3">Sin visitas medidas en este período.</p>
      ) : (
        <Embudo r={r} zona={e.zona} />
      )}
    </>
  );
}

function Embudo({ r, zona }: { r: ResumenEmbudo; zona: Tipo | null }) {
  const pasos = pasosDelEmbudo(r);
  const fuga = mayorFuga(pasos);
  const total = Math.max(1, r.pasos.visitantes);
  return (
    <>
      <section className={`${TARJETA} p-4 flex flex-col gap-3`}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="tabular-nums">
            <span className="font-titular font-extrabold text-[34px] leading-none text-white">{pctTxt(pasos[pasos.length - 1].delTotal)}</span>
          </p>
          <span className="text-xs text-noche-tenue text-right leading-snug">de las visitas
            <br />termina pagando</span>
        </div>
        <ol className="flex flex-col gap-1.5">
          {pasos.map((p, i) => {
            const esFuga = fuga?.hasta.id === p.id;
            return (
              <li key={p.id} className="grid grid-cols-[92px_1fr_52px] items-center gap-2.5 h-8">
                <span className={`text-[13px] truncate ${esFuga ? "text-amber-200 font-semibold" : "text-noche-suave"}`}>{CORTO[p.id]}</span>
                <div className="h-6 rounded-md bg-white/[0.05] overflow-hidden">
                  <div
                    className={`h-full rounded-md ${i === pasos.length - 1 ? "bg-emerald-400/90" : esFuga ? "bg-amber-400/90" : "bg-violeta"}`}
                    style={{ width: p.n > 0 ? `max(3px, ${(p.n / total) * 100}%)` : "0%" }}
                  />
                </div>
                <span className="text-right leading-none">
                  <span className="block text-[15px] font-semibold tabular-nums text-white">{fmt(p.n)}</span>
                  {i > 0 && (
                    <span className={`block text-[10px] tabular-nums mt-0.5 ${esFuga ? "text-amber-200 font-semibold" : "text-noche-tenue"}`}>
                      {pctTxt(p.delAnterior)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        {fuga && (
          <p className="text-xs text-amber-200">
            Mayor fuga: {CORTO[fuga.desde.id]} → {CORTO[fuga.hasta.id]} (−{fmt(fuga.perdidos)})
          </p>
        )}
        {zona && <p className="text-[11px] text-noche-tenue">Visitas y tienda: toda la web.</p>}
      </section>

      <div className="grid grid-cols-2 gap-2.5">
        <Kpi valor={fmt(r.fugas.expiraron)} etiqueta="Se les acabó el tiempo" tono={r.fugas.expiraron > 0 ? "ambar" : null} />
        <Kpi valor={fmt(r.fugas.whatsapp)} etiqueta="Abrieron WhatsApp" />
        <Kpi valor={`${fmt(r.comprasWeb.enCuotas)}/${fmt(r.comprasWeb.reportadas)}`} etiqueta="Compras en cuotas" />
        <Kpi valor={`$${fmt(r.comprasWeb.valorConfirmado)}`} etiqueta="Confirmado (web)" tono="ok" />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Vista "Canales": de dónde viene la plata de la web.
// ---------------------------------------------------------------------------
export function VistaCanales({ e, puedeActivar }: { e: DatosEmbudo; puedeActivar: boolean }) {
  const r = e.resumen;
  const filas = r ? r.canales.filter((c) => c.visitantes > 0 || c.compras > 0) : [];
  const maxValor = Math.max(1, ...filas.map((c) => c.valorConfirmado));
  return (
    <>
      <Filtros e={e} vista="canales" conZona={false} />
      {!r ? (
        <SinMedicion puedeActivar={puedeActivar} />
      ) : (
        <section className={`${TARJETA} p-4 flex flex-col gap-1`}>
          <div className="grid grid-cols-[1fr_52px_44px_64px] gap-2 text-[10px] uppercase tracking-[0.1em] text-noche-tenue pb-1.5 border-b border-white/10">
            <span>Canal</span>
            <span className="text-right">Visitas</span>
            <span className="text-right">Ventas</span>
            <span className="text-right">$ conf.</span>
          </div>
          {filas.length === 0 ? (
            <p className="text-sm text-noche-suave py-3">Sin visitas en este período.</p>
          ) : (
            filas.map((c) => (
              <div key={c.canal} className="grid grid-cols-[1fr_52px_44px_64px] gap-2 items-center py-2 border-b border-white/[0.05] last:border-0">
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium truncate">{etiquetaCanal(c.canal)}</span>
                  <span className="block h-1 mt-1 rounded-full bg-white/[0.06] overflow-hidden">
                    <span className="block h-full bg-violeta rounded-full" style={{ width: `${(c.valorConfirmado / maxValor) * 100}%` }} />
                  </span>
                </span>
                <span className="text-right text-[13px] tabular-nums text-noche-suave">{fmt(c.visitantes)}</span>
                <span className="text-right text-[13px] tabular-nums text-noche-suave">{fmt(c.compras)}</span>
                <span className="text-right text-[13px] tabular-nums font-semibold text-white">${fmt(c.valorConfirmado)}</span>
              </div>
            ))
          )}
        </section>
      )}

      {r && r.campanas.length > 0 && (
        <section className={`${TARJETA} p-4 flex flex-col gap-1`}>
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-noche-tenue pb-1">Campañas</h2>
          {r.campanas.map((c) => (
            <div key={`${c.canal}-${c.campana}`} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[13px] truncate min-w-0">{c.campana}</span>
              <span className="text-[13px] tabular-nums shrink-0">
                <span className="text-noche-tenue">{fmt(c.compras)} · </span>
                <span className="font-semibold text-white">${fmt(c.valorConfirmado)}</span>
              </span>
            </div>
          ))}
        </section>
      )}

      <EnlacesRastreo />
    </>
  );
}

// Enlaces con UTM: sin ellos casi todo cae en "Directo".
const ENLACES: { donde: string; url: string }[] = [
  { donde: "Bio de Instagram", url: "lanavidadvallenata.com/comprar?utm_source=instagram&utm_medium=bio" },
  { donde: "Historias", url: "lanavidadvallenata.com/comprar?utm_source=instagram&utm_medium=historia" },
  { donde: "ManyChat", url: "lanavidadvallenata.com/comprar?utm_source=manychat&utm_medium=dm" },
  { donde: "Anuncios Meta", url: "lanavidadvallenata.com/comprar?utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}" },
  { donde: "WhatsApp", url: "lanavidadvallenata.com/comprar?utm_source=whatsapp&utm_medium=mensaje" },
  { donde: "TikTok", url: "lanavidadvallenata.com/comprar?utm_source=tiktok&utm_medium=bio" },
];

function EnlacesRastreo() {
  return (
    <details className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <summary className="text-sm font-medium cursor-pointer select-none text-lila-claro">Enlaces con rastreo</summary>
      <ul className="mt-3 flex flex-col gap-2.5">
        {ENLACES.map((l) => (
          <li key={l.donde} className="flex flex-col gap-1">
            <span className="text-xs text-noche-suave">{l.donde}</span>
            <code className="text-[11px] text-white bg-black/30 rounded-md px-2 py-1.5 break-all select-all">{l.url}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}
