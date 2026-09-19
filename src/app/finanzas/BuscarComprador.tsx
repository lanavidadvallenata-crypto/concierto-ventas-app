"use client";

import { useState } from "react";
import { buscarTickets, reenviarQR, type TicketBuscado } from "./actions";
import { ETIQUETA_METODO, formatoUsd, haceCuanto, horaCaracas } from "@/lib/formato";

const ESTADO: Record<TicketBuscado["estadoPago"], { texto: string; clase: string }> = {
  pendiente: { texto: "Pendiente", clase: "bg-amber-100 text-amber-800" },
  verificado: { texto: "Verificado", clase: "bg-green-100 text-green-800" },
  rechazado: { texto: "Rechazado", clase: "bg-red-100 text-red-800" },
};

// Para atender al comprador que escribe "pagué y no me llegó nada": buscar
// por nombre, correo, teléfono o referencia y ver en qué estado está, y
// reenviar el QR si ya fue verificado.
export default function BuscarComprador() {
  const [consulta, setConsulta] = useState("");
  const [cargando, setCargando] = useState(false);
  const [resultados, setResultados] = useState<TicketBuscado[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<Record<string, { tipo: "ok" | "error"; texto: string }>>({});

  async function onBuscar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAvisos({});
    setCargando(true);
    const res = await buscarTickets(consulta);
    setCargando(false);
    if (!res.ok) {
      setError(res.error);
      setResultados(null);
      return;
    }
    setResultados(res.tickets);
  }

  async function onReenviar(t: TicketBuscado) {
    setReenviando(t.id);
    const res = await reenviarQR(t.id);
    setReenviando(null);
    setAvisos((prev) => ({
      ...prev,
      [t.id]: res.ok ? { tipo: "ok", texto: res.aviso ?? "QR reenviado." } : { tipo: "error", texto: res.error },
    }));
  }

  return (
    <section className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold">Buscar comprador</p>
        <p className="text-xs text-neutral-500">
          Para cuando alguien escribe &ldquo;pagué y no me llegó nada&rdquo;: busca por nombre, correo, teléfono o referencia.
        </p>
      </div>
      <form onSubmit={onBuscar} className="flex gap-2">
        <input
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="Nombre, correo, teléfono o referencia"
          className="flex-1 h-11 border border-neutral-300 rounded-lg px-3 text-sm"
        />
        <button
          type="submit"
          disabled={cargando || consulta.trim().length < 3}
          className="h-11 px-4 bg-neutral-900 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
        >
          {cargando ? "Buscando…" : "Buscar"}
        </button>
      </form>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

      {resultados && resultados.length === 0 && (
        <p className="text-sm text-neutral-500">No hay ningún ticket que coincida. Si la persona dice que compró, pídele la captura del pago y la referencia.</p>
      )}

      {resultados && resultados.length > 0 && (
        <div className="flex flex-col divide-y divide-neutral-100 border-t border-neutral-100">
          {resultados.map((t) => {
            const estado = ESTADO[t.estadoPago];
            const aviso = avisos[t.id];
            return (
              <div key={t.id} className="py-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold truncate">{t.compradorNombre}</p>
                  <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 shrink-0 ${estado.clase}`}>{estado.texto}</span>
                </div>
                <p className="text-xs text-neutral-600">
                  {t.tipo === "vip" ? "VIP" : "General"} · {formatoUsd(t.precio)} · {ETIQUETA_METODO[t.metodoPago] ?? t.metodoPago}
                  {t.referenciaPago ? ` · ref. ${t.referenciaPago}` : ""}
                </p>
                <p className="text-xs text-neutral-500">
                  {t.compradorEmail ?? "sin correo"} · {t.compradorTelefono} · {haceCuanto(t.creadoEn)} ({horaCaracas(t.creadoEn)})
                </p>
                {t.estadoPago === "verificado" && (
                  <p className="text-xs text-neutral-500">
                    {t.qrUsado
                      ? "QR ya usado en la puerta."
                      : t.qrEnviadoEn
                      ? `QR enviado ${haceCuanto(t.qrEnviadoEn)}.`
                      : "QR generado pero el correo no se registró como enviado."}
                  </p>
                )}
                {t.estadoPago === "pendiente" && (
                  <p className="text-xs text-amber-700">Está arriba en la lista de pendientes — verifícalo desde ahí.</p>
                )}
                {t.estadoPago === "verificado" && !t.qrUsado && (
                  <button
                    type="button"
                    onClick={() => onReenviar(t)}
                    disabled={reenviando === t.id || !t.compradorEmail}
                    className="self-start mt-1 h-9 px-3 border border-neutral-300 rounded-lg text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {reenviando === t.id ? "Enviando…" : "Reenviar QR por correo"}
                  </button>
                )}
                {aviso && (
                  <p className={`text-xs rounded-md px-3 py-2 ${aviso.tipo === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
                    {aviso.texto}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
