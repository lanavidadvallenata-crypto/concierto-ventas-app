type Dia = [string, number];

export default function VentasChart({ dias }: { dias: Dia[] }) {
  if (dias.length === 0) {
    return <p className="text-sm text-neutral-400">Todavía no hay ventas verificadas para graficar.</p>;
  }

  const max = Math.max(...dias.map(([, c]) => c), 1);
  const altoBarras = 110;
  const padTop = 18;
  const padBottom = 18;
  const anchoBarra = 22;
  const gap = 14;
  const anchoTotal = dias.length * (anchoBarra + gap);
  const alturaTotal = padTop + altoBarras + padBottom;
  const baseY = padTop + altoBarras;
  const maxIdx = dias.reduce((best, cur, i, arr) => (cur[1] > arr[best][1] ? i : best), 0);

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(anchoTotal, 280)} height={alturaTotal} role="img" aria-label="Tickets verificados por día">
        <line
          x1={0}
          y1={baseY}
          x2={anchoTotal}
          y2={baseY}
          stroke="var(--marca-neutro-2)"
          strokeOpacity={0.3}
          strokeWidth={1}
        />
        {dias.map(([fecha, cantidad], i) => {
          const h = Math.max(2, (cantidad / max) * (altoBarras - 4));
          const x = i * (anchoBarra + gap);
          const y = baseY - h;
          const fechaObj = new Date(fecha + "T12:00:00");
          const dia = fechaObj.getDate();
          const etiquetaCompleta = fechaObj.toLocaleDateString("es-VE", { day: "numeric", month: "short" });
          return (
            <g key={fecha}>
              <title>
                {etiquetaCompleta}: {cantidad} ticket{cantidad === 1 ? "" : "s"}
              </title>
              <rect x={x} y={y} width={anchoBarra} height={h} rx={4} className="fill-marca-secundario" />
              {i === maxIdx && (
                <text x={x + anchoBarra / 2} y={y - 6} textAnchor="middle" className="fill-neutral-600" fontSize={11} fontWeight={600}>
                  {cantidad}
                </text>
              )}
              <text x={x + anchoBarra / 2} y={baseY + 14} textAnchor="middle" className="fill-neutral-400" fontSize={10}>
                {dia}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
