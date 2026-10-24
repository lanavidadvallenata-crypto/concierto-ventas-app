"use client";

import { useRef, useState } from "react";
import { cotizar } from "./actions";
import { mensajeCotizacion, type Cotizacion, type LineaCotizada } from "@/lib/cotizador";
import { MAX_POR_COMPRA, type Tipo } from "@/lib/precios";
import { fechaCorta } from "@/lib/cuotas";
import { formatoBs, formatoUsd } from "@/lib/formato";

// Pantalla de la vendedora: elige cuántas de cada una y ve al instante cuánto
// paga el cliente hoy y en cada fecha. Mismas cuentas que la web (ver
// src/lib/cotizador.ts). No aparta nada: es solo para cotizar.

const FILAS: { tipo: Tipo; nombre: string; detalle: string }[] = [
  { tipo: "vip", nombre: "VIP", detalle: "mesa de 10, primeras filas" },
  { tipo: "preferencial", nombre: "Preferencial", detalle: "mesa de 8, detrás del VIP" },
  { tipo: "general", nombre: "General", detalle: "de pie, sin asiento" },
];

const SIN_PLAN: Record<string, string> = {
  apagado: "El pago en cuotas está apagado.",
  tope_vip: "Se acabaron los cupos VIP en cuotas.",
  sin_margen: "Ya no hay cuotas para nadie desde el 14 de noviembre.",
  taquilla: "En taquilla no hay cuotas.",
  error: "No se pudo leer el plan de cuotas: vuelve a intentar en un momento.",
};

function nombreLinea(l: LineaCotizada) {
  const n = l.cantidad;
  if (l.tipo === "vip") return `${n} VIP`;
  if (l.tipo === "preferencial") return `${n} Preferencial${n === 1 ? "" : "es"}`;
  return `${n} General${n === 1 ? "" : "es"}`;
}

export default function Cotizador() {
  const [pedido, setPedido] = useState<Record<Tipo, number>>({ vip: 0, preferencial: 0, general: 0 });
  const [cot, setCot] = useState<Cotizacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const turno = useRef(0);

  const hayAlgo = pedido.vip + pedido.preferencial + pedido.general > 0;

  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recotiza solo, medio segundo después del último toque. El turno evita que
  // una respuesta vieja pise a una más nueva si llegan en otro orden.
  function pedirCotizacion(p: Record<Tipo, number>) {
    if (espera.current) clearTimeout(espera.current);
    const mio = ++turno.current;
    setCopiado(false);
    if (p.vip + p.preferencial + p.general === 0) {
      setCot(null);
      setError(null);
      setCargando(false);
      return;
    }
    setCargando(true);
    espera.current = setTimeout(async () => {
      const res = await cotizar(p);
      if (mio !== turno.current) return;
      setCargando(false);
      if (res.ok) {
        setCot(res.cotizacion);
        setError(null);
      } else {
        setCot(null);
        setError(res.error);
      }
    }, 450);
  }

  function cambiar(tipo: Tipo, delta: number) {
    const nuevo = { ...pedido, [tipo]: Math.min(MAX_POR_COMPRA[tipo], Math.max(0, pedido[tipo] + delta)) };
    setPedido(nuevo);
    pedirCotizacion(nuevo);
  }

  const mensaje = cot ? mensajeCotizacion(cot) : "";

  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensaje);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">Cotizar cuotas</h1>
        <p className="text-xs text-neutral-500">
          Lo que la web le cobraría hoy al cliente, con las fechas de hoy. Solo cotiza: no aparta sillas ni crea compras.
        </p>
      </header>

      <section className="bg-white border border-neutral-200 rounded-xl divide-y divide-neutral-100">
        {FILAS.map((f) => (
          <div key={f.tipo} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{f.nombre}</p>
              <p className="text-xs text-neutral-500">
                {f.detalle} · máx. {MAX_POR_COMPRA[f.tipo]}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => cambiar(f.tipo, -1)}
                disabled={pedido[f.tipo] === 0}
                aria-label={`Quitar una ${f.nombre}`}
                className="h-11 w-11 rounded-lg border border-neutral-300 text-lg font-semibold disabled:opacity-30"
              >
                −
              </button>
              <span className="w-8 text-center text-base font-semibold tabular-nums">{pedido[f.tipo]}</span>
              <button
                type="button"
                onClick={() => cambiar(f.tipo, 1)}
                disabled={pedido[f.tipo] >= MAX_POR_COMPRA[f.tipo]}
                aria-label={`Agregar una ${f.nombre}`}
                className="h-11 w-11 rounded-lg border border-neutral-300 text-lg font-semibold disabled:opacity-30"
              >
                +
              </button>
            </div>
          </div>
        ))}
      </section>

      {!hayAlgo && <p className="text-sm text-neutral-500 text-center py-4">Elige las entradas que quiere el cliente.</p>}
      {cargando && hayAlgo && !cot && <p className="text-sm text-neutral-500 text-center py-4">Calculando…</p>}
      {error && <p className="text-sm rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</p>}

      {cot && (
        <div className={`space-y-4 ${cargando ? "opacity-60" : ""}`}>
          {/* Lo que el cliente paga, sumado por fecha: es lo primero que pregunta. */}
          <section className="rounded-xl border border-marca-secundario/30 bg-white px-4 py-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">El cliente paga</p>
            <div className="divide-y divide-neutral-100">
              {cot.porFecha.map((p) => (
                <div key={p.venceEl} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className={`text-sm ${p.esHoy ? "font-semibold" : ""}`}>{p.esHoy ? "Hoy" : `El ${fechaCorta(p.venceEl)}`}</span>
                  <span className="text-right">
                    <span className={`tabular-nums ${p.esHoy ? "text-lg font-semibold" : "text-sm font-semibold"}`}>{formatoUsd(p.usd)}</span>
                    {p.esHoy && p.bs != null && (
                      <span className="block text-xs text-neutral-500 tabular-nums">{formatoBs(p.bs)} a la tasa BCV de hoy</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-neutral-500">
              Total {formatoUsd(cot.totalUsd)}. Los pagos de después se hacen en bolívares a la tasa de ese día.
            </p>
          </section>

          {cot.lineas.length > 1 && (
            <p className="text-sm rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
              <strong>Son {cot.lineas.length} compras separadas</strong>, una por tipo de entrada (la web vende un tipo por compra). Hoy
              son {cot.lineas.length} pagos:{" "}
              {cot.lineas.map((l) => formatoUsd(l.plan ? l.plan.inicial : l.total)).join(" y ")}, cada uno con su referencia.
            </p>
          )}

          {cot.lineas.map((l) => (
            <section key={l.tipo} className="bg-white border border-neutral-200 rounded-xl px-4 py-3 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold">
                  {nombreLinea(l)} · {formatoUsd(l.total)}
                </p>
                {l.disponibles != null && (
                  <p className={`text-xs ${l.disponibles < l.cantidad ? "text-red-700 font-semibold" : "text-neutral-500"}`}>
                    {l.disponibles < l.cantidad ? `Solo quedan ${l.disponibles}` : `Quedan ${l.disponibles}`}
                  </p>
                )}
              </div>

              {l.plan ? (
                <>
                  <p className="text-xs text-neutral-600">
                    En la web: elegir <strong>&ldquo;En {l.plan.cuotas.length} pagos&rdquo;</strong>.
                  </p>
                  <div className="rounded-lg border border-neutral-100 divide-y divide-neutral-100">
                    {l.plan.cuotas.map((q) => (
                      <div key={q.orden} className="flex justify-between gap-3 px-3 py-1.5 text-sm">
                        <span>
                          {q.etiqueta}
                          <span className="text-neutral-500"> · {q.esInicial ? "hoy" : fechaCorta(q.venceEl)}</span>
                        </span>
                        <span className="tabular-nums font-medium">{formatoUsd(q.monto)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  {SIN_PLAN[l.sinPlan ?? "error"]} Se paga completo: <strong>{formatoUsd(l.total)}</strong>.
                </p>
              )}
            </section>
          ))}

          {cot.lineas.some((l) => l.plan) && (
            <p className="text-xs text-neutral-600 rounded-lg bg-neutral-100 px-3 py-2">
              Las cuotas se compran <strong>solo en lanavidadvallenata.com</strong>. Nunca por Ventas: ahí todo queda de contado y los QR
              salen sin haber pagado completo.
            </p>
          )}

          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Mensaje para el cliente</p>
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] leading-relaxed font-sans">
              {mensaje}
            </pre>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={copiar}
                className="h-11 px-4 rounded-lg bg-neutral-900 text-white text-sm font-semibold"
              >
                {copiado ? "¡Copiado!" : "Copiar mensaje"}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="h-11 px-4 rounded-lg bg-[#25D366] text-white text-sm font-semibold inline-flex items-center"
              >
                Enviar por WhatsApp
              </a>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
