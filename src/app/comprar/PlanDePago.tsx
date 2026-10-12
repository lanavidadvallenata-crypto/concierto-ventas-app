"use client";

import { useState } from "react";
import { CONDICIONES, fechaCorta, type Plan } from "@/lib/cuotas";

/**
 * Abona618 en el checkout: elegir entre pagar todo o pagar en cuotas, ver el
 * calendario y aceptar las condiciones.
 *
 * Vive aparte del CheckoutForm por dos razones. Una, que ese archivo ya pasa
 * de 700 líneas y es el camino por donde entra todo el dinero: cuanto menos
 * se toque, mejor. Dos, que así se puede ver renderizado solo, que es como se
 * revisó antes de subirlo.
 *
 * Este componente no decide si el plan existe — eso lo decide el servidor y
 * llega resuelto. Con el módulo apagado nunca se monta.
 */
export default function PlanDePago({
  plan,
  total,
  enCuotas,
  onElegir,
  acepto,
  onAceptar,
}: {
  plan: Plan;
  total: number;
  enCuotas: boolean;
  onElegir: (v: boolean) => void;
  acepto: boolean;
  onAceptar: (v: boolean) => void;
}) {
  const [verCondiciones, setVerCondiciones] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">¿Cómo quieres pagar?</p>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onElegir(false)}
          aria-pressed={!enCuotas}
          className={`rounded-lg border-2 px-3 py-2.5 text-left ${
            !enCuotas ? "border-marca-secundario bg-marca-secundario/5" : "border-neutral-200 bg-white"
          }`}
        >
          <span className="block text-sm font-semibold">Todo ahora</span>
          <span className="block text-base font-bold tabular-nums">${total.toFixed(2)}</span>
          <span className="block text-xs text-neutral-500 leading-tight mt-0.5">Tu QR llega hoy mismo</span>
        </button>
        <button
          type="button"
          onClick={() => onElegir(true)}
          aria-pressed={enCuotas}
          className={`rounded-lg border-2 px-3 py-2.5 text-left ${
            enCuotas ? "border-marca-secundario bg-marca-secundario/5" : "border-neutral-200 bg-white"
          }`}
        >
          <span className="block text-sm font-semibold">En {plan.cuotas.length} pagos</span>
          <span className="block text-base font-bold tabular-nums">${plan.inicial.toFixed(2)}</span>
          <span className="block text-xs text-neutral-500 leading-tight mt-0.5">hoy, y el resto en fechas</span>
        </button>
      </div>

      {enCuotas && (
        <div className="rounded-lg border border-marca-secundario/30 bg-marca-secundario/5 p-3 flex flex-col gap-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-marca-secundario">Tu plan de pago</p>

          <ul className="flex flex-col gap-1.5 tabular-nums">
            {plan.cuotas.map((c) => (
              <li key={c.orden} className="flex items-start justify-between gap-3 text-sm">
                <span className="text-neutral-700 min-w-0">
                  {c.etiqueta}
                  <span className="text-neutral-500"> · {c.esInicial ? "hoy" : `hasta el ${fechaCorta(c.venceEl)}`}</span>
                  {!c.esInicial && (
                    <span className="block text-xs text-neutral-500">
                      con 2 días de plazo, hasta el {fechaCorta(c.graciaHasta)}
                    </span>
                  )}
                </span>
                <span className="font-semibold shrink-0">${c.monto.toFixed(2)}</span>
              </li>
            ))}
          </ul>

          <p className="text-xs text-neutral-700 leading-relaxed border-t border-marca-secundario/20 pt-2">
            Tu entrada queda apartada a tu nombre desde hoy y el precio se te congela.{" "}
            <strong>Tu QR llega cuando completes el total</strong>, no antes. Te escribimos antes de cada fecha y te
            acompañamos con el pago.
          </p>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={acepto}
              onChange={(e) => onAceptar(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#3F0A62]"
            />
            <span className="text-xs text-neutral-800 leading-relaxed">
              Acepto las condiciones del plan. <strong>Cada pago tiene su fecha y dos días de plazo</strong>; si se me
              pasa el plazo de cualquiera de ellos, se anula toda la compra en ese momento, mi entrada vuelve a la
              venta y lo abonado no se devuelve.{" "}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setVerCondiciones((v) => !v);
                }}
                className="underline underline-offset-2 text-marca-secundario font-semibold"
              >
                {verCondiciones ? "Ocultar" : "Leerlas completas"}
              </button>
            </span>
          </label>

          {verCondiciones && (
            <ol className="list-decimal pl-5 flex flex-col gap-1.5 text-xs text-neutral-700 leading-relaxed border-t border-marca-secundario/20 pt-2">
              {CONDICIONES.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
