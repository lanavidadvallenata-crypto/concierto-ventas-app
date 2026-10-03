"use client";

import { useState } from "react";
import { formatoUsd } from "@/lib/formato";

// Un día del gráfico. Además del total se guarda el desglose por tipo y el
// ingreso, que es lo que Anita necesita leer al tocar una barra: saber que un
// día bueno lo fue por VIP o por General cambia la decisión del día siguiente.
export type DiaVenta = { fecha: string; total: number; vip: number; general: number; usd: number };

export default function VentasChart({ dias }: { dias: DiaVenta[] }) {
  // Arranca mostrando el día más reciente: el gráfico nunca se ve "vacío".
  const [sel, setSel] = useState<number>(Math.max(0, dias.length - 1));

  if (dias.length === 0) {
    return <p className="text-sm text-neutral-400">Todavía no hay ventas verificadas para graficar.</p>;
  }

  const max = Math.max(...dias.map((d) => d.total), 1);
  const altoBarras = 110;
  const padTop = 18;
  const padBottom = 18;
  const anchoBarra = 22;
  const gap = 14;
  const paso = anchoBarra + gap;
  const anchoTotal = dias.length * paso;
  const alturaTotal = padTop + altoBarras + padBottom;
  const baseY = padTop + altoBarras;

  const activo = dias[Math.min(sel, dias.length - 1)];
  const fechaLarga = new Date(activo.fecha + "T12:00:00").toLocaleDateString("es-VE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <svg
          width={Math.max(anchoTotal, 280)}
          height={alturaTotal}
          role="img"
          aria-label="Entradas verificadas por día"
        >
          <line x1={0} y1={baseY} x2={anchoTotal} y2={baseY} stroke="var(--marca-neutro-2)" strokeOpacity={0.3} strokeWidth={1} />
          {dias.map((d, i) => {
            const h = Math.max(2, (d.total / max) * (altoBarras - 4));
            const x = i * paso;
            const y = baseY - h;
            const dia = new Date(d.fecha + "T12:00:00").getDate();
            const esActivo = i === Math.min(sel, dias.length - 1);
            const resumen = `${new Date(d.fecha + "T12:00:00").toLocaleDateString("es-VE", {
              day: "numeric",
              month: "short",
            })}: ${d.general} General · ${d.vip} VIP · ${formatoUsd(d.usd)}`;
            return (
              <g key={d.fecha}>
                <title>{resumen}</title>
                <rect
                  x={x}
                  y={y}
                  width={anchoBarra}
                  height={h}
                  rx={4}
                  className={esActivo ? "fill-marca-principal" : "fill-marca-secundario"}
                  opacity={esActivo ? 1 : 0.75}
                />
                {/* Zona de toque ancha y de alto completo: en el teléfono una
                    barra de 2px de alto es imposible de acertar con el dedo. */}
                <rect
                  x={x - gap / 2}
                  y={padTop}
                  width={paso}
                  height={altoBarras + padBottom}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onClick={() => setSel(i)}
                >
                  <title>{resumen}</title>
                </rect>
                <text
                  x={x + anchoBarra / 2}
                  y={baseY + 14}
                  textAnchor="middle"
                  className={esActivo ? "fill-neutral-700" : "fill-neutral-400"}
                  fontSize={10}
                  fontWeight={esActivo ? 700 : 400}
                >
                  {dia}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2">
        <p className="text-xs text-neutral-500 capitalize">{fechaLarga}</p>
        <p className="text-sm font-semibold tabular-nums">
          {activo.total} entrada{activo.total === 1 ? "" : "s"}
          <span className="font-normal text-neutral-500">
            {" · "}
            {activo.general} General {" · "} {activo.vip} VIP {" · "} {formatoUsd(activo.usd)}
          </span>
        </p>
        <p className="text-[11px] text-neutral-400 mt-0.5">Toca cualquier barra para ver ese día.</p>
      </div>
    </div>
  );
}
