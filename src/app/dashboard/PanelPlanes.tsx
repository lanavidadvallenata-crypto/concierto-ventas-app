import Link from "next/link";
import type { Config, ResumenPlanes } from "@/lib/abona618";
import { convertirABs } from "@/lib/tasa";
import { formatoBsAprox } from "@/lib/formato";

// La tarjeta de Abona618 en el dashboard. Responde cuatro preguntas y nada
// más: cuánta plata hay comprometida y cuánta ya entró, si hay cobros
// atrasados, cuántas VIP están apartadas contra el tope, y cuánto quedó de los
// planes que se cayeron.

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const bs = (usd: number, tasa: number | null) => (tasa ? formatoBsAprox(convertirABs(usd, tasa)) : null);

export default function PanelPlanes({
  resumen,
  config,
  puedeCobrar,
  tasaEurVes,
}: {
  resumen: ResumenPlanes;
  config: Config;
  puedeCobrar: boolean;
  /** Tasa BCV del euro de hoy. Todo lo de esta tarjeta es dinero que todavía
   *  no entró o que entró en fechas distintas, así que el bolívar aquí es
   *  SIEMPRE estimado y sale con ≈. */
  tasaEurVes: number | null;
}) {
  // Ni planes ni módulo encendido: no hay nada que decir y la tarjeta sería ruido.
  if (!resumen.hayPlanes && !resumen.error && !config.activo) return null;

  const pctCobrado =
    resumen.enCurso.valorUsd > 0
      ? Math.round((resumen.enCurso.cobradoUsd / resumen.enCurso.valorUsd) * 100)
      : 0;
  const pctTope = resumen.vip.tope > 0 ? Math.round((resumen.vip.enPlan / resumen.vip.tope) * 100) : 0;
  const topeEnAviso = resumen.vip.enPlan >= resumen.vip.aviso;
  const topeLleno = resumen.vip.enPlan >= resumen.vip.tope;

  return (
    <section className="rounded-[20px] bg-white/[0.04] border border-white/10 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-noche-texto">Abona618 · pago en cuotas</h2>
        <span
          className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border ${
            config.activo
              ? "bg-violeta-hondo/30 border-lila/35 text-lila-claro"
              : "bg-white/5 border-white/10 text-noche-tenue"
          }`}
        >
          {config.activo ? "ofreciéndose" : "apagado"}
        </span>
      </div>

      {resumen.error ? (
        <p className="text-sm text-red-300">
          No se pudieron leer los planes. Los números de esta tarjeta no son confiables — vuelve a
          cargar en un momento, y si sigue igual avísale a quien lleva el sistema.
        </p>
      ) : !resumen.hayPlanes ? (
        <p className="text-sm text-noche-suave">
          El módulo está encendido y todavía no hay ningún plan. El primero aparecerá aquí.
        </p>
      ) : (
        <>
          <div>
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div>
                <p className="text-xs text-noche-suave">Cobrado de los planes en curso</p>
                <p className="font-titular font-extrabold text-[34px] leading-none mt-1 text-white tabular-nums">
                  ${fmt(resumen.enCurso.cobradoUsd)}
                </p>
                {bs(resumen.enCurso.cobradoUsd, tasaEurVes) && (
                  <p className="text-xs text-noche-tenue tabular-nums mt-1">{bs(resumen.enCurso.cobradoUsd, tasaEurVes)}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs text-noche-tenue">de ${fmt(resumen.enCurso.valorUsd)} comprometido</p>
                <p className="text-sm font-semibold tabular-nums text-noche-texto">
                  por cobrar ${fmt(resumen.enCurso.porCobrarUsd)}
                </p>
                {bs(resumen.enCurso.porCobrarUsd, tasaEurVes) && (
                  <p className="text-xs text-noche-tenue tabular-nums">{bs(resumen.enCurso.porCobrarUsd, tasaEurVes)}</p>
                )}
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full rounded-full bg-violeta shadow-[0_0_12px_rgba(155,93,224,0.7)]"
                style={{ width: `${Math.min(pctCobrado, 100)}%` }}
              />
            </div>
            <p className="text-xs text-noche-tenue mt-2">
              {resumen.enCurso.compras} compra{resumen.enCurso.compras === 1 ? "" : "s"} ·{" "}
              {resumen.enCurso.entradas} entrada{resumen.enCurso.entradas === 1 ? "" : "s"} apartada
              {resumen.enCurso.entradas === 1 ? "" : "s"} que todavía no tienen QR
            </p>
          </div>

          {resumen.vencidoSinCobrarUsd > 0 && (
            <p className="text-sm text-red-300 rounded-xl bg-red-500/10 border border-red-400/25 px-3 py-2.5">
              ${fmt(resumen.vencidoSinCobrarUsd)}
              {bs(resumen.vencidoSinCobrarUsd, tasaEurVes) ? ` (${bs(resumen.vencidoSinCobrarUsd, tasaEurVes)})` : ""} atrasados:
              cuotas que ya vencieron y nadie ha confirmado.
              {puedeCobrar && (
                <>
                  {" "}
                  <Link href="/cobranza" className="underline underline-offset-2 font-medium">
                    ir a Cobranza
                  </Link>
                </>
              )}
            </p>
          )}

          {resumen.proximoUsd > 0 && (
            <p className="text-sm text-amber-200 rounded-xl bg-amber-400/10 border border-amber-300/25 px-3 py-2.5">
              ${fmt(resumen.proximoUsd)}
              {bs(resumen.proximoUsd, tasaEurVes) ? ` (${bs(resumen.proximoUsd, tasaEurVes)})` : ""} vencen esta semana.
              {puedeCobrar && (
                <>
                  {" "}
                  <Link href="/cobranza" className="underline underline-offset-2 font-medium">
                    ir a Cobranza
                  </Link>
                </>
              )}
            </p>
          )}

          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-noche-suave">VIP apartadas en plan</p>
              <p
                className={`text-sm font-semibold tabular-nums ${
                  topeLleno ? "text-red-300" : topeEnAviso ? "text-amber-200" : "text-noche-texto"
                }`}
              >
                {resumen.vip.enPlan} <span className="font-normal text-noche-tenue">/ {resumen.vip.tope}</span>
              </p>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  topeLleno ? "bg-red-400" : topeEnAviso ? "bg-amber-400" : "bg-violeta"
                }`}
                style={{ width: `${Math.min(pctTope, 100)}%` }}
              />
            </div>
            {topeLleno ? (
              <p className="text-xs text-red-300 mt-1.5">
                Tope lleno: el checkout ya no ofrece cuotas en VIP. Para extenderlo hay que subir el
                tope en la configuración.
              </p>
            ) : topeEnAviso ? (
              <p className="text-xs text-amber-200 mt-1.5">
                Quedan {resumen.vip.tope - resumen.vip.enPlan} cupos del tope. Es el momento de
                decidir si se extiende.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-white/10">
            <div className="pt-3">
              <p className="text-xs text-noche-suave">Completados</p>
              <p className="text-sm font-semibold tabular-nums text-noche-texto">
                {resumen.completados.compras} · ${fmt(resumen.completados.valorUsd)}
              </p>
              {resumen.completados.valorUsd > 0 && bs(resumen.completados.valorUsd, tasaEurVes) && (
                <p className="text-[11px] text-noche-tenue tabular-nums">{bs(resumen.completados.valorUsd, tasaEurVes)}</p>
              )}
              <p className="text-[11px] text-noche-tenue">ya suman en el recaudado de arriba</p>
            </div>
            <div className="pt-3">
              <p className="text-xs text-noche-suave">Caídos</p>
              <p className="text-sm font-semibold tabular-nums text-noche-texto">
                {resumen.caidos.vencidos + resumen.caidos.anulados} · ${fmt(resumen.caidos.abonadoUsd)}
              </p>
              {resumen.caidos.abonadoUsd > 0 && bs(resumen.caidos.abonadoUsd, tasaEurVes) && (
                <p className="text-[11px] text-noche-tenue tabular-nums">{bs(resumen.caidos.abonadoUsd, tasaEurVes)}</p>
              )}
              <p className="text-[11px] text-noche-tenue">
                {resumen.caidos.vencidos} por falta de pago · {resumen.caidos.anulados} anulados a mano
              </p>
              {resumen.caidos.vencidos + resumen.caidos.anulados > 0 && (
                <Link
                  href="/cobranza/caidos"
                  className="mt-2 h-10 px-3 inline-flex items-center rounded-lg border border-white/15 bg-white/[0.06] text-xs font-semibold text-noche-texto hover:bg-white/10"
                >
                  Ver detalle →
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
