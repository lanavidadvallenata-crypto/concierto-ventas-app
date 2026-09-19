"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verificarPago, rechazarPago } from "./actions";
import { convertirABs } from "@/lib/tasa";
import { ETIQUETA_CANAL, ETIQUETA_METODO, METODOS_EN_BS, formatoBs, formatoUsd, haceCuanto, horaCaracas } from "@/lib/formato";

export type CompraPendiente = {
  id: string; // id de un ticket del grupo (cualquiera sirve para las acciones)
  grupoId: string;
  compradorNombre: string;
  compradorTelefono: string;
  compradorEmail: string | null;
  tipo: "vip" | "general";
  cantidad: number;
  total: number;
  totalBs: number | null; // monto exacto que se le indicó al comprador (si pagó en Bs)
  tasaAplicada: number | null;
  enPreventa: number;
  canal: string;
  metodoPago: string;
  referenciaPago: string | null;
  vendidoPor: string | null;
  vendedorNombre: string | null;
  asientos: string[];
  creadoEn: string;
};

type Aviso = { tipo: "ok" | "error"; texto: string };

export default function PendientesList({
  compras,
  miId,
  miRol,
  tasaEurVes,
}: {
  compras: CompraPendiente[];
  miId: string;
  miRol: string;
  tasaEurVes: number | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [procesando, setProcesando] = useState<string | null>(null);
  const [confirmandoRechazo, setConfirmandoRechazo] = useState<string | null>(null);
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());
  const [avisoGlobal, setAvisoGlobal] = useState<Aviso | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [ahora, setAhora] = useState(() => Date.now());
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const visibles = compras.filter((c) => !ocultos.has(c.grupoId));

  function ejecutar(c: CompraPendiente, accion: "verificar" | "rechazar") {
    setAvisoGlobal(null);
    setErrores((prev) => {
      const copia = { ...prev };
      delete copia[c.grupoId];
      return copia;
    });
    setProcesando(c.grupoId);
    startTransition(async () => {
      const res = accion === "verificar" ? await verificarPago(c.id) : await rechazarPago(c.id);
      setProcesando(null);
      setConfirmandoRechazo(null);
      if (!res.ok) {
        setErrores((prev) => ({ ...prev, [c.grupoId]: res.error }));
        return;
      }
      setOcultos((prev) => new Set(prev).add(c.grupoId));
      const n = c.cantidad;
      if (accion === "verificar") {
        setAvisoGlobal(
          res.aviso
            ? { tipo: "error", texto: res.aviso }
            : {
                tipo: "ok",
                texto: `Pago de ${c.compradorNombre} verificado (${n} entrada${n === 1 ? "" : "s"}). ${n === 1 ? "QR enviado" : `${n} QR enviados`} a ${c.compradorEmail ?? "su correo"}.`,
              }
        );
      } else {
        setAvisoGlobal(
          res.aviso
            ? { tipo: "error", texto: res.aviso }
            : {
                tipo: "ok",
                texto: `Pago de ${c.compradorNombre} rechazado${c.tipo === "vip" ? " — sus sillas volvieron a estar disponibles" : ""}. Le llegó un correo con botón de WhatsApp para mandar el comprobante.`,
              }
        );
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
      // Sin permiso de portapapeles: no pasa nada.
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

      {visibles.map((c) => {
        const esMio = c.vendidoPor === miId;
        const bloqueado = esMio && miRol !== "admin";
        const enProceso = procesando === c.grupoId;
        const enBs = METODOS_EN_BS.has(c.metodoPago);
        // Monto en Bs: el fijado al comprar; si el ticket es viejo y no lo tiene, estimado a la tasa de hoy.
        const montoBs = enBs ? (c.totalBs ?? (tasaEurVes ? convertirABs(c.total, tasaEurVes) : null)) : null;
        const bsEstimado = enBs && c.totalBs == null;
        const error = errores[c.grupoId];
        const canal =
          c.canal === "web" ? ETIQUETA_CANAL.web : esMio ? "Vendido por ti" : `Vendido por ${c.vendedorNombre ?? "—"}`;

        return (
          <div key={c.grupoId} className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-base leading-tight truncate">{c.compradorNombre}</p>
                <p className="text-sm text-neutral-600 mt-0.5">
                  <span className={c.tipo === "vip" ? "font-medium text-marca-secundario" : ""}>
                    {c.cantidad} × {c.tipo === "vip" ? "VIP" : "General"}
                  </span>
                  {c.asientos.length > 0 && <span className="text-neutral-500"> · {c.asientos.join(", ")}</span>}
                  {c.enPreventa > 0 && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide bg-evento-acento/10 text-evento-acento rounded-full px-2 py-0.5">
                      {c.enPreventa === c.cantidad ? "preventa" : `${c.enPreventa} en preventa`}
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-semibold tabular-nums leading-tight">{formatoUsd(c.total)}</p>
                {enBs && (
                  <p className="text-xs text-neutral-600 tabular-nums">
                    {montoBs !== null ? `${bsEstimado ? "≈ " : ""}${formatoBs(montoBs)}` : "tasa no disponible"}
                    {c.tasaAplicada != null && <span className="text-neutral-400"> · tasa {c.tasaAplicada.toLocaleString("es-VE")}</span>}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-neutral-400 w-20 shrink-0 text-xs uppercase tracking-wide">Método</span>
                <span className="truncate">{ETIQUETA_METODO[c.metodoPago] ?? c.metodoPago}{enBs ? " (Bs)" : " (USD)"}</span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-neutral-400 w-20 shrink-0 text-xs uppercase tracking-wide">Referencia</span>
                {c.referenciaPago ? (
                  <button
                    type="button"
                    onClick={() => copiar(c.referenciaPago!, c.grupoId)}
                    title="Copiar referencia"
                    className="font-mono text-sm bg-neutral-100 hover:bg-neutral-200 rounded px-2 py-0.5 truncate max-w-full text-left"
                  >
                    {copiado === c.grupoId ? "✓ copiada" : c.referenciaPago}
                  </button>
                ) : (
                  <span className="text-red-600 font-medium">sin referencia</span>
                )}
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-neutral-400 w-20 shrink-0 text-xs uppercase tracking-wide">Registro</span>
                <span className="truncate" title={horaCaracas(c.creadoEn)}>
                  {haceCuanto(c.creadoEn, ahora)} · {horaCaracas(c.creadoEn)}
                </span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-neutral-400 w-20 shrink-0 text-xs uppercase tracking-wide">Canal</span>
                <span className="truncate">{canal}</span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-neutral-400 w-20 shrink-0 text-xs uppercase tracking-wide">Teléfono</span>
                <a href={`https://wa.me/${c.compradorTelefono.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="truncate underline decoration-neutral-300 underline-offset-2">
                  {c.compradorTelefono}
                </a>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-neutral-400 w-20 shrink-0 text-xs uppercase tracking-wide">Correo</span>
                <span className="truncate">{c.compradorEmail ?? <span className="text-red-600 font-medium">sin correo</span>}</span>
              </div>
            </div>

            {bloqueado && (
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
                onClick={() => ejecutar(c, "verificar")}
                disabled={enProceso || bloqueado}
                className="flex-[2] h-11 bg-green-700 hover:bg-green-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {enProceso ? "Procesando…" : c.cantidad > 1 ? `Verificar y enviar ${c.cantidad} QR` : "Verificar y enviar QR"}
              </button>
              {confirmandoRechazo === c.grupoId ? (
                <button
                  type="button"
                  onClick={() => ejecutar(c, "rechazar")}
                  disabled={enProceso}
                  className="flex-1 h-11 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                >
                  {enProceso ? "…" : "Confirmar rechazo"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmandoRechazo(c.grupoId)}
                  disabled={enProceso}
                  className="flex-1 h-11 border border-red-300 text-red-700 hover:bg-red-50 rounded-lg text-sm font-semibold disabled:opacity-50"
                >
                  Rechazar
                </button>
              )}
            </div>
            {confirmandoRechazo === c.grupoId && !enProceso && (
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
