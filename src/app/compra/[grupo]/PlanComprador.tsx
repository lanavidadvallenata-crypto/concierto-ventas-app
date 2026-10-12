"use client";

import { useState, useTransition } from "react";
import { reportarMiPago } from "./actions";
import { CONDICIONES, fechaCorta, fechaLarga } from "@/lib/cuotas";
import { convertirABs } from "@/lib/tasa";
import { NOTA_TASA, SIN_TASA, formatoBs, formatoBsAprox } from "@/lib/formato";

// Lo que ve el comprador en plan cuando abre su compra. Hasta ahora esta
// página solo sabía de entradas con QR, y a quien está pagando en cuotas le
// decía "están en verificación de pago", que es falso: no están en
// verificación, le faltan pagos. El correo de cada cuota manda aquí con el
// botón "Ver mi plan y los datos de pago", así que esto es lo que tiene que
// encontrar.

export type CuotaVista = {
  id: string;
  etiqueta: string;
  monto: number;
  venceEl: string;
  pagada: boolean;
  reportada: boolean;
  /** Los bolívares que de verdad entraron por esta cuota, si se pagó en Bs.
   *  Es un dato histórico y no se recalcula: es lo que la persona transfirió
   *  ese día, a la tasa de ese día. */
  montoBsPagado: number | null;
};

const METODOS = [
  { valor: "pago_movil", etiqueta: "Pago móvil", enBs: true },
  { valor: "transferencia", etiqueta: "Transferencia", enBs: true },
  { valor: "zelle", etiqueta: "Zelle", enBs: false },
  { valor: "binance", etiqueta: "Binance", enBs: false },
] as const;

const usd = (n: number) => `$${n.toFixed(2)}`;

export default function PlanComprador({
  grupoId,
  total,
  pagado,
  saldo,
  cuotas,
  fechaTope,
  instrucciones,
  tasaEurVes,
}: {
  grupoId: string;
  total: number;
  pagado: number;
  saldo: number;
  cuotas: CuotaVista[];
  fechaTope: string;
  instrucciones: Record<string, string>;
  /** Tasa BCV del euro de hoy. null = no se pudo leer; entonces no se muestra
   *  ningún monto en bolívares, nunca uno inventado. */
  tasaEurVes: number | null;
}) {
  const [, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [verCondiciones, setVerCondiciones] = useState(false);
  const [metodo, setMetodo] = useState<string>("pago_movil");
  const [referencia, setReferencia] = useState("");
  const [montoBs, setMontoBs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const proxima = cuotas.find((c) => !c.pagada && !c.reportada) ?? null;
  const enBs = METODOS.find((m) => m.valor === metodo)?.enBs ?? false;
  const avance = total > 0 ? Math.min(100, Math.round((pagado / total) * 100)) : 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.12em] text-[#898477]">Tu plan de pago</p>
        <p className="text-[#3D0507] font-bold text-lg leading-tight mt-0.5">
          {saldo > 0 ? `Te faltan ${usd(saldo)}` : "¡Completaste tu pago!"}
        </p>
        <p className="text-sm text-neutral-600">
          Llevas {usd(pagado)} de {usd(total)}
        </p>
        {saldo > 0 && (
          <p className="text-xs text-neutral-500 mt-0.5">
            {tasaEurVes ? `${formatoBsAprox(convertirABs(saldo, tasaEurVes))} · ${NOTA_TASA}` : `${SIN_TASA} — pregúntanos por WhatsApp cuántos bolívares transferir.`}
          </p>
        )}
      </div>

      <div className="h-2 rounded-full bg-[#F1ECE2] overflow-hidden" aria-hidden="true">
        <div className="h-full rounded-full bg-[#3F0A62] transition-all" style={{ width: `${avance}%` }} />
      </div>

      <ul className="flex flex-col gap-2">
        {cuotas.map((c) => (
          <li key={c.id} className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="font-medium text-neutral-800">{c.etiqueta}</span>
              <span className="block text-xs text-neutral-500">
                {c.pagada
                  ? "Pagada y verificada"
                  : c.reportada
                    ? "Avisaste que pagaste · estamos verificando en el banco"
                    : `Vence el ${fechaCorta(c.venceEl)}`}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className={`font-semibold tabular-nums ${c.pagada ? "text-green-800" : "text-neutral-900"}`}>
                {usd(c.monto)}
              </span>
              <span className="block text-[11px] text-neutral-500 tabular-nums">
                {c.pagada && c.montoBsPagado != null
                  ? formatoBs(c.montoBsPagado)
                  : c.pagada
                    ? "pagada en divisas"
                    : tasaEurVes
                      ? formatoBsAprox(convertirABs(c.monto, tasaEurVes))
                      : ""}
              </span>
              <span className="block text-xs">
                {c.pagada ? <span className="text-green-700">✓ listo</span> : c.reportada ? <span className="text-amber-700">en revisión</span> : <span className="text-neutral-400">por pagar</span>}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {saldo > 0 && (
        <>
          <div className="rounded-xl bg-[#F1ECE2] p-3 text-sm text-neutral-800">
            <p className="font-semibold mb-1">Tu QR llega cuando completes el total</p>
            <p className="text-[13px] leading-relaxed text-neutral-700">
              Tu entrada está apartada a tu nombre y el precio congelado.{" "}
              <strong>Cada pago tiene su fecha.</strong> Si no pagas en la fecha de cualquiera de
              ellos{proxima ? <> — la próxima es el <strong>{fechaLarga(proxima.venceEl)}</strong></> : null}, se
              anula toda la compra, tu entrada vuelve a la venta y lo abonado no se devuelve. Te escribimos antes de
              cada fecha.
            </p>
          </div>

          {proxima && (
            <div className="rounded-xl border-2 border-[#3F0A62]/30 p-3 flex flex-col gap-2.5">
              <p className="text-sm">
                <strong>Tu próximo pago:</strong> {usd(proxima.monto)} · vence el {fechaCorta(proxima.venceEl)}
                <span className="block text-xs text-neutral-600 mt-0.5">
                  Págalo ese día. Si no nos llega, se anula la compra y tu entrada vuelve a la venta.
                </span>
              </p>

              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-[#3F0A62] min-h-11 flex items-center">
                  Ver los datos para pagar
                </summary>
                <div className="mt-2 flex flex-col gap-3">
                  {METODOS.map((m) => (
                    <div key={m.valor} className="rounded-lg bg-neutral-50 border border-neutral-200 p-3">
                      <p className="font-semibold text-[13px] mb-1">{m.etiqueta}</p>
                      <p className="text-[13px] whitespace-pre-line text-neutral-700 leading-relaxed">
                        {instrucciones[m.valor]}
                      </p>
                    </div>
                  ))}
                </div>
              </details>

              {aviso && (
                <p
                  className={`text-sm rounded-lg px-3 py-2 ${
                    aviso.ok ? "bg-green-50 text-green-900 border border-green-200" : "bg-red-50 text-red-900 border border-red-200"
                  }`}
                >
                  {aviso.texto}
                </p>
              )}

              {!abierto ? (
                <button
                  type="button"
                  onClick={() => setAbierto(true)}
                  className="min-h-11 rounded-xl bg-[#3F0A62] text-white font-semibold text-sm"
                >
                  Ya pagué — avisar
                </button>
              ) : (
                <form
                  className="flex flex-col gap-2.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setAviso(null);
                    setEnviando(true);
                    startTransition(async () => {
                      const res = await reportarMiPago({
                        grupoId,
                        cuotaId: proxima.id,
                        metodoPago: metodo,
                        referenciaPago: referencia,
                        ...(enBs && montoBs ? { montoBs: Number(montoBs.replace(",", ".")) } : {}),
                      });
                      setEnviando(false);
                      if (!res.ok) {
                        setAviso({ ok: false, texto: res.error });
                        return;
                      }
                      setAbierto(false);
                      setReferencia("");
                      setMontoBs("");
                      setAviso({ ok: true, texto: res.aviso });
                    });
                  }}
                >
                  <label className="block">
                    <span className="text-xs font-medium text-neutral-700">¿Cómo pagaste?</span>
                    <select
                      value={metodo}
                      onChange={(e) => setMetodo(e.target.value)}
                      className="mt-1 w-full min-h-11 rounded-lg border border-neutral-300 px-2 text-sm bg-white"
                    >
                      {METODOS.map((m) => (
                        <option key={m.valor} value={m.valor}>
                          {m.etiqueta}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-medium text-neutral-700">
                      {enBs ? "Referencia del pago" : metodo === "zelle" ? "Correo desde el que enviaste" : "Tu usuario de Binance"}
                    </span>
                    <input
                      value={referencia}
                      onChange={(e) => setReferencia(e.target.value)}
                      inputMode={enBs ? "numeric" : "text"}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      className="mt-1 w-full min-h-11 rounded-lg border border-neutral-300 px-2 text-sm font-mono"
                      required
                    />
                  </label>

                  {enBs && (
                    <label className="block">
                      <span className="text-xs font-medium text-neutral-700">Monto exacto en bolívares</span>
                      <input
                        value={montoBs}
                        onChange={(e) => setMontoBs(e.target.value)}
                        inputMode="decimal"
                        className="mt-1 w-full min-h-11 rounded-lg border border-neutral-300 px-2 text-sm"
                        required
                      />
                    </label>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAbierto(false)}
                      className="min-h-11 rounded-xl border border-neutral-300 text-neutral-700 font-semibold text-sm"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={enviando}
                      className="min-h-11 rounded-xl bg-[#3F0A62] text-white font-semibold text-sm disabled:opacity-50"
                    >
                      {enviando ? "Enviando…" : "Enviar aviso"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {!proxima && (
            <p className="text-sm rounded-xl bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2">
              Ya nos avisaste de todos tus pagos. Los estamos verificando en el banco y te escribimos apenas estén
              confirmados.
            </p>
          )}
        </>
      )}

      <div>
        <button
          type="button"
          onClick={() => setVerCondiciones((v) => !v)}
          className="text-xs text-[#3F0A62] font-semibold underline underline-offset-2 min-h-11 flex items-center"
        >
          {verCondiciones ? "Ocultar las condiciones" : "Ver las condiciones de mi plan"}
        </button>
        {verCondiciones && (
          <ol className="list-decimal pl-5 flex flex-col gap-1.5 text-xs text-neutral-700 leading-relaxed mt-1">
            {CONDICIONES.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        )}
        <p className="text-[11px] text-[#898477] mt-1">Fecha tope para completar: {fechaCorta(fechaTope)}.</p>
      </div>
    </div>
  );
}
