"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatoUsd } from "@/lib/formato";

// Un día del gráfico. Además del total se guarda el desglose por tipo y el
// ingreso, que es lo que Anita necesita leer al tocar un día: saber que un
// día bueno lo fue por VIP o por General cambia la decisión del día siguiente.
export type DiaVenta = { fecha: string; total: number; vip: number; preferencial: number; general: number; usd: number };

// Rediseño del 23 oct (referencia que pasó Anita): línea con área, ejes con
// valores y fechas, globo sobre el día elegido y el resumen de la semana
// arriba. Tres decisiones para que sea más claro y no solo más bonito:
//
// 1. Los días SIN venta salen en 0. Antes el gráfico solo traía los días con
//    ventas, así que 10 oct quedaba pegado al 13 oct como si fueran seguidos.
//    En una línea de tiempo eso miente: ahora son 14 días de calendario.
// 2. La curva es "monótona": suaviza sin inventar picos ni bajar de 0 entre
//    dos días. Una curva común exagera y dibuja ventas que no existieron.
// 3. Se ve en entradas o en dólares, porque un día de 4 VIP y uno de 4
//    generales no son el mismo día.

const DIAS = 14;
const ALTO = 200;
const M = { arriba: 16, derecha: 14, abajo: 28, izquierda: 44 };

type Metrica = "entradas" | "usd";

function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Los últimos 14 días de calendario terminando hoy, con 0 donde no hubo venta. */
function calendario(dias: DiaVenta[], hoy: string): DiaVenta[] {
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));
  return Array.from({ length: DIAS }, (_, i) => {
    const fecha = sumarDias(hoy, i - (DIAS - 1));
    return porFecha.get(fecha) ?? { fecha, total: 0, vip: 0, preferencial: 0, general: 0, usd: 0 };
  });
}

/** Tope "redondo" del eje y y su paso, para 4 líneas guía. */
function escala(max: number, metrica: Metrica): { tope: number; paso: number } {
  if (max <= 0) return { tope: 4, paso: 1 };
  const bruto = max / 4;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const factores = metrica === "usd" ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  let paso = (factores.find((f) => f * pot >= bruto) ?? 10) * pot;
  if (metrica === "entradas") paso = Math.max(1, Math.round(paso));
  return { tope: paso * 4, paso };
}

/** Curva monótona (Fritsch–Carlson): pasa por cada punto, sin sobrepasarlos. */
function curva(p: { x: number; y: number }[]): string {
  const n = p.length;
  if (n === 0) return "";
  if (n === 1) return `M${p[0].x},${p[0].y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = p[i + 1].x - p[i].x;
    m[i] = (p[i + 1].y - p[i].y) / dx[i];
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${p[0].x},${p[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = p[i].x + dx[i] / 3;
    const c1y = p[i].y + (t[i] * dx[i]) / 3;
    const c2x = p[i + 1].x - dx[i] / 3;
    const c2y = p[i + 1].y - (t[i + 1] * dx[i]) / 3;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p[i + 1].x},${p[i + 1].y}`;
  }
  return d;
}

const fechaCorta = (f: string) =>
  new Date(`${f}T12:00:00`).toLocaleDateString("es-VE", { day: "numeric", month: "short" }).replace(".", "");
// "Jue, 22 oct": solo la primera letra en mayúscula (la clase CSS
// `capitalize` ponía "Oct" también).
const fechaLarga = (f: string) => {
  const t = new Date(`${f}T12:00:00`).toLocaleDateString("es-VE", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
};
const usdCorto = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k` : `$${Math.round(n)}`;
const usdEntero = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function VentasChart({ dias, hoy }: { dias: DiaVenta[]; hoy: string }) {
  const serie = calendario(dias, hoy);
  const [metrica, setMetrica] = useState<Metrica>("entradas");
  // Arranca en el último día con ventas: a primera hora "hoy" casi siempre
  // está en 0 y el globo no diría nada útil. Hoy igual se ve en la línea.
  // (Bucle a mano y no findLastIndex: ese no existe en iPhones con iOS < 15.4.)
  let ultimoConVenta = -1;
  for (let i = serie.length - 1; i >= 0; i--) {
    if (serie[i].total > 0) {
      ultimoConVenta = i;
      break;
    }
  }
  const [sel, setSel] = useState<number>(ultimoConVenta >= 0 ? ultimoConVenta : DIAS - 1);

  // El ancho real de la tarjeta: el gráfico se dibuja a esa medida, así que
  // en el teléfono entran los 14 días sin deslizar de lado.
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(340);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setAncho(Math.max(260, Math.round(el.getBoundingClientRect().width)));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const idDegradado = `area-${useId().replace(/:/g, "")}`;
  const valor = (d: DiaVenta) => (metrica === "usd" ? d.usd : d.total);
  const etiquetaValor = (n: number) =>
    metrica === "usd" ? usdEntero(n) : `${n} entrada${n === 1 ? "" : "s"}`;

  // Resumen de arriba: últimos 7 días contra los 7 anteriores.
  const suma = (xs: DiaVenta[]) => xs.reduce((s, d) => s + valor(d), 0);
  const semana = suma(serie.slice(7));
  const anterior = suma(serie.slice(0, 7));
  const cambio = anterior > 0 ? Math.round(((semana - anterior) / anterior) * 100) : null;

  const { tope, paso } = escala(Math.max(...serie.map(valor)), metrica);
  const anchoUtil = ancho - M.izquierda - M.derecha;
  const altoUtil = ALTO - M.arriba - M.abajo;
  const base = M.arriba + altoUtil;
  const x = (i: number) => M.izquierda + (anchoUtil * i) / (DIAS - 1);
  const y = (v: number) => base - (altoUtil * v) / tope;
  const puntos = serie.map((d, i) => ({ x: x(i), y: y(valor(d)) }));
  const linea = curva(puntos);
  const area = `${linea} L${x(DIAS - 1)},${base} L${x(0)},${base} Z`;

  const activo = serie[sel];
  const pa = puntos[sel];
  const textoGlobo = etiquetaValor(valor(activo));
  const anchoGlobo = Math.max(92, textoGlobo.length * 7.4 + 22);
  const altoGlobo = 42;
  const globoX = Math.min(Math.max(pa.x - anchoGlobo / 2, M.izquierda - 6), ancho - anchoGlobo - 2);
  const globoArriba = pa.y - altoGlobo - 12 >= 0;
  const globoY = globoArriba ? pa.y - altoGlobo - 12 : pa.y + 12;

  function elegirPorX(clienteX: number, svg: SVGSVGElement) {
    const r = svg.getBoundingClientRect();
    const px = ((clienteX - r.left) / r.width) * ancho;
    const i = Math.round(((px - M.izquierda) / anchoUtil) * (DIAS - 1));
    setSel(Math.min(DIAS - 1, Math.max(0, i)));
  }

  const resumenAccesible =
    `Últimos 7 días: ${etiquetaValor(semana)}` +
    (cambio !== null ? `, ${cambio >= 0 ? "sube" : "baja"} ${Math.abs(cambio)} % contra los 7 días anteriores` : "") +
    `. Día elegido: ${fechaLarga(activo.fecha)}, ${etiquetaValor(valor(activo))}.`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="h-8 w-8 rounded-lg bg-violeta-hondo/35 border border-lila/25 grid place-items-center text-lila-claro">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 17l5-5 4 4 8-8" />
              <path d="M15 8h5v5" />
            </svg>
          </span>
          <h2 className="text-[15px] font-semibold whitespace-nowrap">Ritmo de ventas</h2>
        </div>
        {/* "$" y no "Dólares": con la palabra completa el título se partía en
            dos líneas en el teléfono. */}
        <div role="group" aria-label="Ver en" className="flex shrink-0 rounded-xl border border-white/12 bg-white/[0.04] p-0.5 text-xs font-semibold">
          {(["entradas", "usd"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metrica === m}
              aria-label={m === "usd" ? "Dólares" : "Entradas"}
              onClick={() => setMetrica(m)}
              className={`h-9 min-w-10 px-3 rounded-[10px] ${metrica === m ? "bg-violeta-hondo/60 text-white" : "text-noche-suave hover:text-noche-texto"}`}
            >
              {m === "usd" ? "$" : "Entradas"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <span className="font-titular font-extrabold text-[30px] leading-none text-white tabular-nums">
            {metrica === "usd" ? usdEntero(semana) : semana}
          </span>
          {metrica === "entradas" && <span className="text-sm text-noche-suave">entradas</span>}
          {cambio !== null && (
            <span
              className={`text-xs font-semibold rounded-full px-2 py-0.5 border tabular-nums ${
                cambio >= 0 ? "text-emerald-200 bg-emerald-400/10 border-emerald-300/25" : "text-amber-200 bg-amber-400/10 border-amber-300/25"
              }`}
            >
              {cambio >= 0 ? "↑" : "↓"} {Math.abs(cambio)} %
            </span>
          )}
        </div>
        <p className="text-xs text-noche-tenue mt-1.5">Últimos 7 días · comparado con los 7 anteriores</p>
      </div>

      <div ref={caja} className="w-full">
        <svg
          width={ancho}
          height={ALTO}
          viewBox={`0 0 ${ancho} ${ALTO}`}
          role="img"
          aria-label={resumenAccesible}
          tabIndex={0}
          className="block touch-pan-y select-none focus:outline-2 focus:outline-lila focus:outline-offset-4 rounded-md"
          onPointerDown={(e) => elegirPorX(e.clientX, e.currentTarget)}
          onPointerMove={(e) => {
            if (e.pointerType === "mouse" || e.buttons > 0) elegirPorX(e.clientX, e.currentTarget);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setSel((s) => Math.max(0, s - 1));
            if (e.key === "ArrowRight") setSel((s) => Math.min(DIAS - 1, s + 1));
          }}
        >
          <defs>
            <linearGradient id={idDegradado} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9B5DE0" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#9B5DE0" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Líneas guía y valores del eje */}
          {[0, 1, 2, 3, 4].map((k) => {
            const v = paso * k;
            const yy = y(v);
            return (
              <g key={k}>
                <line x1={M.izquierda} y1={yy} x2={ancho - M.derecha} y2={yy} stroke="#F1ECE2" strokeOpacity={k === 0 ? 0.16 : 0.07} strokeWidth={1} />
                <text x={M.izquierda - 8} y={yy + 4} textAnchor="end" fontSize={11} className="fill-noche-tenue tabular-nums">
                  {metrica === "usd" ? usdCorto(v) : v}
                </text>
              </g>
            );
          })}

          {/* Fechas: cada 3 días y siempre el último */}
          {serie.map((d, i) =>
            i % 3 === (DIAS - 1) % 3 ? (
              <text
                key={d.fecha}
                x={x(i)}
                y={ALTO - 8}
                textAnchor={i === DIAS - 1 ? "end" : "middle"}
                fontSize={11}
                className={i === sel ? "fill-noche-texto" : "fill-noche-tenue"}
                fontWeight={i === sel ? 700 : 400}
              >
                {i === DIAS - 1 ? "hoy" : fechaCorta(d.fecha)}
              </text>
            ) : null
          )}

          <path d={area} fill={`url(#${idDegradado})`} />
          <path
            d={linea}
            fill="none"
            stroke="#C9A6F2"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ filter: "drop-shadow(0 0 6px rgba(155,93,224,0.75))" }}
          />
          {puntos.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={2} fill="#C9A6F2" opacity={i === sel ? 0 : 0.6} />
          ))}

          {/* Día elegido: guía vertical, punto con brillo y globo */}
          <line x1={pa.x} y1={pa.y} x2={pa.x} y2={base} stroke="#E4D2FA" strokeOpacity={0.45} strokeDasharray="3 4" />
          <circle cx={pa.x} cy={pa.y} r={10} fill="#9B5DE0" opacity={0.3} />
          <circle cx={pa.x} cy={pa.y} r={5} fill="#F1ECE2" stroke="#9B5DE0" strokeWidth={2} />
          <g transform={`translate(${globoX},${globoY})`}>
            <rect width={anchoGlobo} height={altoGlobo} rx={10} fill="#1d1430" stroke="#C9A6F2" strokeOpacity={0.35} />
            <text x={11} y={16} fontSize={11} className="fill-noche-tenue">
              {fechaLarga(activo.fecha)}
            </text>
            <text x={11} y={33} fontSize={13.5} fontWeight={700} className="fill-noche-texto tabular-nums">
              {textoGlobo}
            </text>
          </g>
        </svg>
      </div>

      <div className="rounded-xl bg-white/[0.05] border border-white/10 px-3 py-2.5">
        <p className="text-sm tabular-nums">
          <span className="font-semibold">{fechaLarga(activo.fecha)}</span>
          <span className="text-noche-suave">
            {" · "}
            {activo.total} entrada{activo.total === 1 ? "" : "s"}
            {activo.total > 0 && (
              <>
                {" ("}
                {[activo.general && `${activo.general} General`, activo.preferencial && `${activo.preferencial} Preferencial`, activo.vip && `${activo.vip} VIP`]
                  .filter(Boolean)
                  .join(" · ")}
                {")"}
              </>
            )}
            {" · "}
            {formatoUsd(activo.usd)}
          </span>
        </p>
        <p className="text-xs text-noche-tenue mt-0.5">Toca o desliza el dedo sobre el gráfico para ver cada día.</p>
      </div>
    </div>
  );
}
