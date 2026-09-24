import { ETIQUETA_CANAL, ETIQUETA_METODO, formatoBs, formatoUsd, haceCuanto, horaCaracas } from "@/lib/formato";

// Auditoría solo para admin: qué compras se aprobaron, quién las aprobó y
// cuándo. El dato vive en tickets.verificado_por / verificado_en desde el
// principio; esta pantalla es lo único nuevo — no cambia ningún flujo.
export type FilaAprobada = {
  grupoId: string;
  compradorNombre: string;
  compradorEmail: string | null;
  tipo: "vip" | "general";
  cantidad: number;
  total: number;
  totalBs: number | null;
  metodoPago: string;
  referenciaPago: string | null;
  canal: string;
  aprobadoPor: string | null;
  aprobadoEn: string | null;
  creadoEn: string;
};

// En taquilla y patrocinios el pago se da por confirmado al registrar: no hubo
// un segundo par de ojos, y eso debe quedar claro en la auditoría.
const CANALES_AUTOVERIFICADOS = new Set(["taquilla", "patrocinio"]);

function demora(creadoEn: string, aprobadoEn: string | null): string | null {
  if (!aprobadoEn) return null;
  const ms = new Date(aprobadoEn).getTime() - new Date(creadoEn).getTime();
  if (ms < 0) return null;
  const min = Math.round(ms / 60_000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  if (h < 24) return resto ? `${h} h ${resto} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 día" : `${d} días`;
}

export default function AprobadasList({ filas }: { filas: FilaAprobada[] }) {
  if (filas.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Aprobadas recientemente</h2>
        <p className="text-sm text-neutral-500 rounded-xl border border-neutral-200 bg-white p-4">
          Todavía no hay pagos aprobados.
        </p>
      </section>
    );
  }

  const totalUsd = filas.reduce((s, f) => s + f.total, 0);
  const totalEntradas = filas.reduce((s, f) => s + f.cantidad, 0);

  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="font-semibold">Aprobadas recientemente</h2>
        <p className="text-sm text-neutral-500">
          Últimas {filas.length} compra{filas.length === 1 ? "" : "s"} verificadas · {totalEntradas} entrada
          {totalEntradas === 1 ? "" : "s"} · ${totalUsd.toFixed(2)}. Solo tú ves esta sección.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100 overflow-hidden">
        {filas.map((f) => {
          const auto = CANALES_AUTOVERIFICADOS.has(f.canal);
          const espera = auto ? null : demora(f.creadoEn, f.aprobadoEn);
          return (
            <div key={f.grupoId} className="px-4 py-3 flex flex-col gap-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{f.compradorNombre}</p>
                  {f.compradorEmail && (
                    <p className="text-xs text-neutral-400 truncate">{f.compradorEmail}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-sm tabular-nums">{formatoUsd(f.total)}</p>
                  {f.totalBs != null && (
                    <p className="text-xs text-neutral-400 tabular-nums">{formatoBs(f.totalBs)}</p>
                  )}
                </div>
              </div>

              <p className="text-xs text-neutral-500">
                {f.cantidad} {f.tipo === "vip" ? "VIP" : "General"} · {ETIQUETA_METODO[f.metodoPago] ?? f.metodoPago}
                {f.referenciaPago ? ` · ref. ${f.referenciaPago}` : ""} · {ETIQUETA_CANAL[f.canal] ?? f.canal}
              </p>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
                    auto ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-800"
                  }`}
                >
                  {auto
                    ? `Automático al registrar${f.aprobadoPor ? ` · ${f.aprobadoPor}` : ""}`
                    : `Aprobó ${f.aprobadoPor ?? "—"}`}
                </span>
                {f.aprobadoEn && (
                  <span className="text-neutral-400">
                    {horaCaracas(f.aprobadoEn)} · {haceCuanto(f.aprobadoEn)}
                  </span>
                )}
                {espera && <span className="text-neutral-400">esperó {espera}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
