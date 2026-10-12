import Link from "next/link";
import type { Config, ResumenPlanes } from "@/lib/abona618";

// La tarjeta de Abona618 en el dashboard. Responde cuatro preguntas y nada
// más: cuánta plata hay comprometida y cuánta ya entró, si hay cobros
// atrasados, cuántas VIP están apartadas contra el tope, y cuánto quedó de los
// planes que se cayeron.

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export default function PanelPlanes({
  resumen,
  config,
  puedeCobrar,
}: {
  resumen: ResumenPlanes;
  config: Config;
  puedeCobrar: boolean;
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
    <div className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Abona618 · pago en cuotas</p>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full border ${
            config.activo
              ? "bg-marca-secundario/10 border-marca-secundario/30 text-marca-secundario"
              : "bg-neutral-100 border-neutral-200 text-neutral-500"
          }`}
        >
          {config.activo ? "ofreciéndose" : "apagado"}
        </span>
      </div>

      {resumen.error ? (
        <p className="text-sm text-red-600">
          No se pudieron leer los planes. Los números de esta tarjeta no son confiables — vuelve a
          cargar en un momento, y si sigue igual avísale a quien lleva el sistema.
        </p>
      ) : !resumen.hayPlanes ? (
        <p className="text-sm text-neutral-500">
          El módulo está encendido y todavía no hay ningún plan. El primero aparecerá aquí.
        </p>
      ) : (
        <>
          <div>
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs text-neutral-500">Cobrado de los planes en curso</p>
                <p className="text-3xl font-semibold text-marca-secundario">
                  ${fmt(resumen.enCurso.cobradoUsd)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-neutral-500">de ${fmt(resumen.enCurso.valorUsd)} comprometido</p>
                <p className="text-sm font-semibold tabular-nums">
                  por cobrar ${fmt(resumen.enCurso.porCobrarUsd)}
                </p>
              </div>
            </div>
            <div className="mt-2 h-2 rounded-full bg-neutral-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-marca-secundario"
                style={{ width: `${Math.min(pctCobrado, 100)}%` }}
              />
            </div>
            <p className="text-xs text-neutral-400 mt-1.5">
              {resumen.enCurso.compras} compra{resumen.enCurso.compras === 1 ? "" : "s"} ·{" "}
              {resumen.enCurso.entradas} entrada{resumen.enCurso.entradas === 1 ? "" : "s"} apartada
              {resumen.enCurso.entradas === 1 ? "" : "s"} que todavía no tienen QR
            </p>
          </div>

          {resumen.vencidoSinCobrarUsd > 0 && (
            <p className="text-sm text-red-600">
              ${fmt(resumen.vencidoSinCobrarUsd)} atrasados: cuotas que ya vencieron y nadie ha
              confirmado.
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
            <p className="text-sm text-amber-600">
              ${fmt(resumen.proximoUsd)} vencen esta semana.
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
              <p className="text-xs text-neutral-500">VIP apartadas en plan</p>
              <p
                className={`text-sm font-semibold tabular-nums ${
                  topeLleno ? "text-red-600" : topeEnAviso ? "text-amber-600" : ""
                }`}
              >
                {resumen.vip.enPlan} <span className="font-normal text-neutral-400">/ {resumen.vip.tope}</span>
              </p>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  topeLleno ? "bg-red-500" : topeEnAviso ? "bg-amber-500" : "bg-marca-secundario"
                }`}
                style={{ width: `${Math.min(pctTope, 100)}%` }}
              />
            </div>
            {topeLleno ? (
              <p className="text-xs text-red-600 mt-1.5">
                Tope lleno: el checkout ya no ofrece cuotas en VIP. Para extenderlo hay que subir el
                tope en la configuración.
              </p>
            ) : topeEnAviso ? (
              <p className="text-xs text-amber-600 mt-1.5">
                Quedan {resumen.vip.tope - resumen.vip.enPlan} cupos del tope. Es el momento de
                decidir si se extiende.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-neutral-100">
            <div className="pt-3">
              <p className="text-xs text-neutral-500">Completados</p>
              <p className="text-sm font-semibold tabular-nums">
                {resumen.completados.compras} · ${fmt(resumen.completados.valorUsd)}
              </p>
              <p className="text-[11px] text-neutral-400">ya suman en el recaudado de arriba</p>
            </div>
            <div className="pt-3">
              <p className="text-xs text-neutral-500">Caídos</p>
              <p className="text-sm font-semibold tabular-nums">
                {resumen.caidos.vencidos + resumen.caidos.anulados} · ${fmt(resumen.caidos.abonadoUsd)}
              </p>
              <p className="text-[11px] text-neutral-400">
                {resumen.caidos.vencidos} por falta de pago · {resumen.caidos.anulados} anulados a mano
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
