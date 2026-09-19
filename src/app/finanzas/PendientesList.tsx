"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verificarPago, rechazarPago } from "./actions";
import { convertirABs } from "@/lib/tasa";
import { ETIQUETA_METODO, METODOS_EN_BS, formatoBs, formatoUsd, haceCuanto, horaCaracas } from "@/lib/formato";

type Ticket = {
  id: string;
  compradorNombre: string;
  compradorTelefono: string;
  compradorEmail: string | null;
  tipo: "vip" | "general";
  precio: number;
  metodoPago: string;
  referenciaPago: string | null;
  vendidoPor: string | null;
  vendedorNombre: string | null;
  asiento: string | null;
  creadoEn: string;
};

type Aviso = { tipo: "ok" | "error"; texto: string };

export default function PendientesList({
  tickets,
  miId,
  miRol,
  tasaEurVes,
}: {
  tickets: Ticket[];
  miId: string;
  miRol: string;
  tasaEurVes: number | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [procesando, setProcesando] = useState<string | null>(null);
  const [confirmandoRechazo, setConfirmandoRechazo] = useState<string | null>(null);
  // Tickets ya procesados en esta pantalla: se ocultan al instante (sin
  // esperar a que el servidor refresque la lista) para que no se pueda tocar
  // dos veces el mismo botón.
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());
  const [avisoGlobal, setAvisoGlobal] = useState<Aviso | null>(null);
  const [erroresPorTicket, setErroresPorTicket] = useState<Record<string, string>>({});
  const [ahora, setAhora] = useState(() => Date.now());
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const visibles = tickets.filter((t) => !ocultos.has(t.id));

  function ejecutar(t: Ticket, accion: "verificar" | "rechazar") {
    setAvisoGlobal(null);
    setErroresPorTicket((prev) => {
      const { [t.id]: _omitido, ...resto } = prev;
      void _omitido;
      return resto;
    });
    setProcesando(t.id);
    startTransition(async () => {
      const res = accion === "verificar" ? await verificarPago(t.id) : await rechazarPago(t.id);
      setProcesando(null);
      setConfirmandoRechazo(null);
      if (!res.ok) {
        setErroresPorTicket((prev) => ({ ...prev, [t.id]: res.error }));
        return;
      }
      setOcultos((prev) => new Set(prev).add(t.id));
      if (accion === "verificar") {
        setAvisoGlobal(
          res.aviso
            ? { tipo: "error", texto: res.aviso }
            : {
                tipo: "ok",
                texto: `Pago de ${t.compradorNombre} verificado. QR enviado a ${t.compradorEmail ?? "su correo"}.`,
              }
        );
      } else {
        setAvisoGlobal({ tipo: "ok", texto: `Pago de ${t.compradorNombre} rechazado${t.tipo === "vip" ? " — la silla volvió a estar disponible" : ""}.` });
      }
      router.refresh();
    });
  }

  async function copiar(texto: string, id: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(id);
      setTimeout(() => setCopiado(null), 1500);
    } catch {
      // Sin permiso de portapapeles (algunos navegadores en HTTP o webviews): no pasa nada.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {avisoGlobal && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm font-medium ${
            avisoGlobal.tipo === "ok"
              ? "bg-green-50 border-green-300 text-green-800"
              : "bg-amber-50 border-amber-300 text-amber-900"
          }`}
        >
          {avisoGlobal.texto}
        </div>
      )}

      {visibles.length === 0 && (
        <div className="bg-white border border-neutral-200 rounded-xl p-6 text-center">
          <p className="text-sm font-medium text-neutral-700">No hay pagos pendientes por verificar.</p>
          <p className="text-xs text-neutral-400 mt-1">Esta lista se actualiza sola cada 30 segundos.</p>
        </div>
      )}

      {visibles.map((t) => {
        const esMio = t.vendidoPor === miId;
        const bloqueadoPorControlCruzado = esMio && miRol !== "admin";
        const enProceso = procesando === t.id;
        const enBs = METODOS_EN_BS.has(t.metodoPago);
        const montoBs = enBs && tasaEurVes ? convertirABs(t.precio, tasaEurVes) : null;
        const error = erroresPorTicket[t.id];
        const canal = t.vendidoPor === null ? "Compra web" : esMio ? "Vendido por ti" : `Vendido por ${t.vendedorNombre}`;

        return (
          <div key={t.id} className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-base leading-tight truncate">{t.compradorNombre}</p>
                <p className="text-sm text-neutral-600 mt-0.5">
                  {t.tipo === "vip" ? (
                    <span className="font-medium text-marca-secundario">VIP · {t.asiento}</span>
                  ) : (
                    "Entrada General"
                  )}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-semibold tabular-nums leading-tight">{formatoUsd(t.precio)}</p>
                {enBs && (
                  <p className="text-xs text-neutral-500 tabular-nums">
                    {montoBs !== null ? `≈ ${formatoBs(montoBs)}` : "tasa no disponible"}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-neutral-400 w-20 shrink-0 text-xs uppercase tracking-wide">Método</span>
                <span className="truncate">{ETIQUETA_METODO[t.metodoPago] ?? t.metodoPago}{enBs ? " (Bs)" : " (USD)"}</span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-neutral-400 w-20 shrink-0 text-xs uppercase tracking-wide">Referencia</span>
                {t.referenciaPago ? (
                  <button
                    type="button"
                    onClick={() => copiar(t.referenciaPago!, t.id)}
                    title="Copiar referencia"
                    className="font-mono text-sm bg-neutral-100 hover:bg-neutral-200 rounded px-2 py-0.5 truncate max-w-full text-left"
                  >
                    {copiado === t.id ? "✓ copiada" : t.referenciaPago}
                  </button>
                ) : (
                  <span className="text-red-600 font-medium">sin referencia</span>
                )}
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-neutral-400 w-20 shrink-0 text-xs uppercase tracking-wide">Registro</span>
                <span className="truncate" title={horaCaracas(t.creadoEn)}>
                  {haceCuanto(t.creadoEn, ahora)} · {horaCaracas(t.creadoEn)}
                </span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-neutral-400 w-20 shrink-0 text-xs uppercase tracking-wide">Canal</span>
                <span className="truncate">{canal}</span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-neutral-400 w-20 shrink-0 text-xs uppercase tracking-wide">Teléfono</span>
                <a href={`https://wa.me/${t.compradorTelefono.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="truncate underline decoration-neutral-300 underline-offset-2">
                  {t.compradorTelefono}
                </a>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-neutral-400 w-20 shrink-0 text-xs uppercase tracking-wide">Correo</span>
                <span className="truncate">{t.compradorEmail ?? <span className="text-red-600 font-medium">sin correo</span>}</span>
              </div>
            </div>

            {bloqueadoPorControlCruzado && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Esta venta la registraste tú — por control cruzado la verifica otra persona de Finanzas o un admin.
              </p>
            )}
            {esMio && miRol === "admin" && (
              <p className="text-xs text-neutral-500">Venta registrada por ti. Como admin puedes verificarla.</p>
            )}

            {error && (
              <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-800">
                {error}
              </div>
            )}

            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => ejecutar(t, "verificar")}
                disabled={enProceso || bloqueadoPorControlCruzado}
                className="flex-[2] h-11 bg-green-700 hover:bg-green-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {enProceso ? "Procesando…" : "Verificar y enviar QR"}
              </button>
              {confirmandoRechazo === t.id ? (
                <button
                  type="button"
                  onClick={() => ejecutar(t, "rechazar")}
                  disabled={enProceso}
                  className="flex-1 h-11 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                >
                  {enProceso ? "…" : "Confirmar rechazo"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmandoRechazo(t.id)}
                  disabled={enProceso}
                  className="flex-1 h-11 border border-red-300 text-red-700 hover:bg-red-50 rounded-lg text-sm font-semibold disabled:opacity-50"
                >
                  Rechazar
                </button>
              )}
            </div>
            {confirmandoRechazo === t.id && !enProceso && (
              <button type="button" onClick={() => setConfirmandoRechazo(null)} className="text-xs text-neutral-500 self-end -mt-1">
                Cancelar
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
