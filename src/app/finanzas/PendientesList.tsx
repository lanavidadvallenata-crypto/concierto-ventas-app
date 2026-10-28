"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verificarPago, rechazarPago } from "./actions";
import { convertirABs } from "@/lib/tasa";
import { ETIQUETA_CANAL, ETIQUETA_METODO, METODOS_EN_BS, formatoBs, formatoUsd, haceCuanto, horaCaracas } from "@/lib/formato";
import { conAsiento, resumenCompra, type Tipo } from "@/lib/precios";

export type CompraPendiente = {
  id: string; // id de un ticket del grupo (cualquiera sirve para las acciones)
  grupoId: string;
  compradorNombre: string;
  compradorTelefono: string;
  compradorEmail: string | null;
  tipo: Tipo;
  /** El tipo de cada entrada: una compra mixta lleva varias zonas (28 oct). */
  tipos: Tipo[];
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
                texto: `Pago de ${c.compradorNombre} rechazado${conAsiento(c.tipo) ? " — sus sillas volvieron a estar disponibles" : ""}. Le llegó un correo con botón de WhatsApp para mandar el comprobante.`,
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

  // Tema "noche" de 6.18 (23 oct): misma tarjeta, mismos botones y mismas
  // reglas; solo cambia cómo se ve. Verificar sigue siendo el botón verde
  // grande y Rechazar pide confirmación, igual que antes.
  return (
    <div className="flex flex-col gap-3">
      {avisoGlobal && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            avisoGlobal.tipo === "ok"
              ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-200"
              : "bg-amber-400/10 border-amber-300/30 text-amber-100"
          }`}
        >
          {avisoGlobal.texto}
        </div>
      )}

      {visibles.length === 0 && (
        <div className="rounded-[20px] bg-white/[0.04] border border-white/10 p-6 text-center">
          <p className="text-sm font-medium text-noche-texto">No hay pagos pendientes por verificar.</p>
          <p className="text-xs text-noche-tenue mt-1">Esta lista se actualiza sola cada 30 segundos.</p>
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
          <article
            key={c.grupoId}
            className="rounded-[20px] border border-white/[0.11] bg-[linear-gradient(180deg,rgba(241,236,226,0.07),rgba(241,236,226,0.03))] shadow-[0_20px_50px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)] p-4 flex flex-col gap-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex flex-col gap-1.5">
                <h2 className="font-semibold text-[17px] leading-tight truncate text-noche-texto">{c.compradorNombre}</h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`text-xs font-semibold rounded-full px-2.5 py-0.5 ${
                      conAsiento(c.tipo) ? "bg-violeta-hondo/40 text-lila-claro" : "bg-white/[0.08] text-noche-texto"
                    }`}
                  >
                    {resumenCompra(c.tipos, " × ")}
                  </span>
                  {c.enPreventa > 0 && (
                    <span className="text-[11px] font-bold uppercase tracking-wide text-red-100 bg-[#CE0100]/30 border border-[#CE0100]/60 rounded-full px-2 py-0.5">
                      {c.enPreventa === c.cantidad ? "preventa" : `${c.enPreventa} en preventa`}
                    </span>
                  )}
                  {c.asientos.length > 0 && (
                    <span className="text-xs text-noche-suave border border-white/15 rounded-full px-2.5 py-0.5">
                      {c.asientos.join(" · ")}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-titular font-extrabold text-[26px] leading-none tabular-nums text-white">{formatoUsd(c.total)}</p>
                {enBs && (
                  <p className="text-xs text-noche-suave tabular-nums mt-1">
                    {montoBs !== null ? `${bsEstimado ? "≈ " : ""}${formatoBs(montoBs)}` : "tasa no disponible"}
                  </p>
                )}
                {enBs && c.tasaAplicada != null && (
                  <p className="text-xs text-noche-tenue tabular-nums">tasa {c.tasaAplicada.toLocaleString("es-VE")}</p>
                )}
              </div>
            </div>

            <div className="h-px bg-white/[0.08]" />

            {/* Referencia y correo van a lo ancho: son lo que se compara con
                el banco y no pueden salir cortados con "…". */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.12em] text-noche-tenue">Método</dt>
                <dd className="truncate">{ETIQUETA_METODO[c.metodoPago] ?? c.metodoPago}{enBs ? " (Bs)" : " (USD)"}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.12em] text-noche-tenue">Canal</dt>
                <dd>{canal}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.12em] text-noche-tenue">Registro</dt>
                <dd title={horaCaracas(c.creadoEn)}>
                  {haceCuanto(c.creadoEn, ahora)} · {horaCaracas(c.creadoEn)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.12em] text-noche-tenue">Teléfono</dt>
                <dd className="truncate">
                  <a
                    href={`https://wa.me/${c.compradorTelefono.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-lila hover:text-lila-claro underline decoration-lila/40 underline-offset-2"
                  >
                    {c.compradorTelefono}
                  </a>
                </dd>
              </div>
              <div className="col-span-2 min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.12em] text-noche-tenue">Referencia</dt>
                <dd className="mt-0.5">
                  {c.referenciaPago ? (
                    <button
                      type="button"
                      onClick={() => copiar(c.referenciaPago!, c.grupoId)}
                      title="Copiar referencia"
                      className="font-mono text-[13px] bg-white/[0.08] hover:bg-white/[0.14] rounded-md px-2 py-1 max-w-full text-left break-words"
                    >
                      {copiado === c.grupoId ? "✓ copiada" : c.referenciaPago}
                    </button>
                  ) : (
                    <span className="text-red-300 font-medium">sin referencia</span>
                  )}
                </dd>
              </div>
              <div className="col-span-2 min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.12em] text-noche-tenue">Correo</dt>
                <dd className="break-words">{c.compradorEmail ?? <span className="text-red-300 font-medium">sin correo</span>}</dd>
              </div>
            </dl>

            {bloqueado && (
              <p className="text-xs text-amber-100 bg-amber-400/10 border border-amber-300/25 rounded-xl px-3 py-2">
                Esta venta la registraste tú — por control cruzado la verifica otra persona de Finanzas o un admin.
              </p>
            )}
            {esMio && miRol === "admin" && (
              <p className="text-xs text-noche-tenue">Venta registrada por ti. Como admin puedes verificarla.</p>
            )}

            {error && (
              <div role="alert" className="rounded-xl border border-red-400/35 bg-red-500/10 px-3 py-2.5 text-sm font-medium text-red-200">
                {error}
              </div>
            )}

            <div className="grid grid-cols-[1.6fr_1fr] gap-2">
              <button
                type="button"
                onClick={() => ejecutar(c, "verificar")}
                disabled={enProceso || bloqueado}
                className="h-12 bg-green-700 hover:bg-green-600 text-white rounded-[14px] text-sm font-semibold shadow-[0_8px_24px_rgba(21,128,61,0.35)] disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
              >
                {enProceso ? "Procesando…" : c.cantidad > 1 ? `Verificar y enviar ${c.cantidad} QR` : "Verificar y enviar QR"}
              </button>
              {confirmandoRechazo === c.grupoId ? (
                <button
                  type="button"
                  onClick={() => ejecutar(c, "rechazar")}
                  disabled={enProceso}
                  className="h-12 bg-red-600 hover:bg-red-500 text-white rounded-[14px] text-sm font-semibold disabled:opacity-50"
                >
                  {enProceso ? "…" : "Confirmar rechazo"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmandoRechazo(c.grupoId)}
                  disabled={enProceso}
                  className="h-12 border border-red-400/55 text-red-300 hover:bg-red-500/10 rounded-[14px] text-sm font-semibold disabled:opacity-50"
                >
                  Rechazar
                </button>
              )}
            </div>
            {confirmandoRechazo === c.grupoId && !enProceso && (
              <button type="button" onClick={() => setConfirmandoRechazo(null)} className="h-11 px-3 text-xs text-noche-suave self-end -mt-1.5">
                Cancelar
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
