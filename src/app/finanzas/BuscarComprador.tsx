"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buscarTickets, reenviarQR, reabrirPago, corregirContacto, reenviarCorreoCompra, anularCompraVerificada, type TicketBuscado } from "./actions";
import { codigoCompra } from "@/lib/compra";
import { ETIQUETA_CANAL, ETIQUETA_METODO, formatoBs, formatoUsd, haceCuanto, horaCaracas } from "@/lib/formato";
import { conAsiento, etiquetaTipo } from "@/lib/precios";

const ESTADO: Record<TicketBuscado["estadoPago"], { texto: string; clase: string }> = {
  pendiente: { texto: "Pendiente", clase: "bg-amber-100 text-amber-800" },
  verificado: { texto: "Verificado", clase: "bg-green-100 text-green-800" },
  rechazado: { texto: "Rechazado", clase: "bg-red-100 text-red-800" },
};

// Para atender al comprador que escribe "pagué y no me llegó nada" o "me
// rechazaron el pago pero aquí está el comprobante": buscar por nombre,
// correo, teléfono o referencia, ver el estado, reenviar QR o reabrir.
// Un admin también anula desde aquí una compra aprobada (Anita, 22 oct: con
// miles de compras, "Aprobadas recientemente" solo muestra las últimas 40 y
// una aprobada por error sin dinero en el banco no se encontraba).
export default function BuscarComprador({ esAdmin = false }: { esAdmin?: boolean }) {
  const router = useRouter();
  const [consulta, setConsulta] = useState("");
  const [cargando, setCargando] = useState(false);
  const [resultados, setResultados] = useState<TicketBuscado[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accionando, setAccionando] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<Record<string, { tipo: "ok" | "error"; texto: string }>>({});
  // Corrección de correo/teléfono: una compra a la vez.
  const [editando, setEditando] = useState<string | null>(null);
  const [nuevoEmail, setNuevoEmail] = useState("");
  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [identidadConfirmada, setIdentidadConfirmada] = useState(false);
  // Confirmación de "Anular compra": una compra a la vez.
  const [anulando, setAnulando] = useState<string | null>(null);

  async function anular(t: TicketBuscado) {
    setAccionando(t.grupoId);
    const res = await anularCompraVerificada(t.id);
    setAccionando(null);
    setAvisos((prev) => ({
      ...prev,
      [t.grupoId]: res.ok ? { tipo: "ok", texto: res.aviso ?? "Compra anulada." } : { tipo: "error", texto: res.error },
    }));
    if (res.ok) {
      setAnulando(null);
      setResultados((prev) => prev?.map((x) => (x.grupoId === t.grupoId ? { ...x, estadoPago: "rechazado" } : x)) ?? null);
      router.refresh();
    }
  }

  function abrirEdicion(t: TicketBuscado) {
    setAnulando(null);
    setEditando(t.grupoId);
    setNuevoEmail(t.compradorEmail ?? "");
    setNuevoTelefono(t.compradorTelefono ?? "");
    setIdentidadConfirmada(false);
  }

  async function guardarContacto(t: TicketBuscado) {
    setAccionando(t.grupoId);
    const res = await corregirContacto(t.id, nuevoEmail, nuevoTelefono);
    setAccionando(null);
    if (res.ok) {
      const email = nuevoEmail.trim().toLowerCase();
      const tel = nuevoTelefono.trim();
      setResultados((prev) => prev?.map((x) => (x.grupoId === t.grupoId ? { ...x, compradorEmail: email, compradorTelefono: tel } : x)) ?? null);
      setEditando(null);
    }
    setAvisos((prev) => ({
      ...prev,
      [t.grupoId]: res.ok
        ? {
            tipo: "ok",
            texto: `${res.aviso ?? "Datos guardados."}${t.estadoPago === "verificado" && t.canal !== "taquilla" ? " Ahora toca “Reenviar QR” para mandarle sus entradas al correo nuevo." : ""}`,
          }
        : { tipo: "error", texto: res.error },
    }));
  }

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

  async function accion(t: TicketBuscado, tipo: "reenviar" | "reabrir" | "correo1") {
    setAccionando(t.grupoId);
    const res = tipo === "reenviar" ? await reenviarQR(t.id) : tipo === "correo1" ? await reenviarCorreoCompra(t.id) : await reabrirPago(t.id);
    setAccionando(null);
    setAvisos((prev) => ({
      ...prev,
      [t.grupoId]: res.ok ? { tipo: "ok", texto: res.aviso ?? "Listo." } : { tipo: "error", texto: res.error },
    }));
    if (res.ok && tipo === "reabrir") {
      setResultados((prev) => prev?.map((x) => (x.grupoId === t.grupoId ? { ...x, estadoPago: "pendiente" } : x)) ?? null);
      router.refresh();
    }
  }

  return (
    <section className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold">Buscar comprador</p>
        <p className="text-xs text-neutral-500">
          Para &ldquo;pagué y no me llegó nada&rdquo; o &ldquo;me rechazaron pero aquí está el comprobante&rdquo;: busca por nombre, correo, teléfono o referencia.
        </p>
      </div>
      <form onSubmit={onBuscar} className="flex gap-2">
        <input
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="Nombre, correo, teléfono o referencia"
          className="flex-1 min-w-0 h-11 border border-neutral-300 rounded-lg px-3 text-sm"
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
        <p className="text-sm text-neutral-500">No hay ninguna compra que coincida. Si la persona dice que compró, pídele la captura del pago y la referencia.</p>
      )}

      {resultados && resultados.length > 0 && (
        <div className="flex flex-col divide-y divide-neutral-100 border-t border-neutral-100">
          {resultados.map((t) => {
            const estado = ESTADO[t.estadoPago];
            const aviso = avisos[t.grupoId];
            const ocupado = accionando === t.grupoId;
            return (
              <div key={t.grupoId} className="py-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold truncate">{t.compradorNombre}</p>
                  <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 shrink-0 ${estado.clase}`}>{estado.texto}</span>
                </div>
                <p className="text-xs text-neutral-600">
                  {t.cantidad} × {etiquetaTipo(t.tipo, t.cantidad)} · {formatoUsd(t.precio)}
                  {t.precioBs != null ? ` · ${formatoBs(t.precioBs)}` : ""} · {ETIQUETA_METODO[t.metodoPago] ?? t.metodoPago}
                  {t.referenciaPago ? ` · ref. ${t.referenciaPago}` : ""} · {ETIQUETA_CANAL[t.canal] ?? t.canal}
                </p>
                <p className="text-xs text-neutral-500">
                  {t.compradorEmail ?? "sin correo"} · {t.compradorTelefono} · {haceCuanto(t.creadoEn)} ({horaCaracas(t.creadoEn)})
                </p>
                {t.estadoPago === "verificado" && (
                  <p className="text-xs text-neutral-500">
                    {t.qrUsados >= t.cantidad
                      ? "Todas las entradas ya se usaron en la puerta."
                      : t.qrUsados > 0
                      ? `${t.qrUsados} de ${t.cantidad} ya entraron.`
                      : t.canal === "taquilla"
                      ? "Boleto físico (sin QR)."
                      : t.qrEnviadoEn
                      ? `QR enviado ${haceCuanto(t.qrEnviadoEn)}.`
                      : "QR generado pero el correo no se registró como enviado."}
                  </p>
                )}
                {t.estadoPago === "pendiente" && <DondeEsta t={t} />}
                <div className="flex gap-2 flex-wrap">
                  {t.estadoPago === "verificado" && t.qrUsados < t.cantidad && t.canal !== "taquilla" && (
                    <button
                      type="button"
                      onClick={() => accion(t, "reenviar")}
                      disabled={ocupado || !t.compradorEmail}
                      className="mt-1 h-9 px-3 border border-neutral-300 rounded-lg text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
                    >
                      {ocupado ? "Enviando…" : `Reenviar ${t.cantidad > 1 ? "los QR" : "QR"} por correo`}
                    </button>
                  )}
                  {t.canal !== "taquilla" && editando !== t.grupoId && (
                    <button
                      type="button"
                      onClick={() => abrirEdicion(t)}
                      disabled={ocupado}
                      className="mt-1 h-9 px-3 border border-neutral-300 rounded-lg text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Corregir correo / teléfono
                    </button>
                  )}
                  {t.estadoPago === "pendiente" && t.canal !== "taquilla" && (
                    <button
                      type="button"
                      onClick={() => accion(t, "correo1")}
                      disabled={ocupado || !t.compradorEmail}
                      className="mt-1 h-9 px-3 border border-neutral-300 rounded-lg text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
                    >
                      {ocupado ? "Enviando…" : "Reenviar correo de compra"}
                    </button>
                  )}
                  {esAdmin && t.estadoPago === "verificado" && t.qrUsados === 0 && anulando !== t.grupoId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditando(null);
                        setAnulando(t.grupoId);
                      }}
                      disabled={ocupado}
                      className="mt-1 h-9 px-3 border border-red-300 text-red-700 rounded-lg text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
                    >
                      Anular compra
                    </button>
                  )}
                  {t.estadoPago === "rechazado" && (
                    <button
                      type="button"
                      onClick={() => accion(t, "reabrir")}
                      disabled={ocupado}
                      className="mt-1 h-9 px-3 border border-amber-400 text-amber-900 bg-amber-50 rounded-lg text-xs font-semibold hover:bg-amber-100 disabled:opacity-50"
                    >
                      {ocupado ? "Reabriendo…" : "Reabrir — mandó el comprobante"}
                    </button>
                  )}
                </div>
                {anulando === t.grupoId && (
                  <ConfirmarAnulacion t={t} ocupado={ocupado} onAnular={() => anular(t)} onCancelar={() => setAnulando(null)} />
                )}
                {editando === t.grupoId && (
                  <div className="mt-1 border border-amber-300 bg-amber-50 rounded-lg p-3 flex flex-col gap-2">
                    <p className="text-xs text-amber-900">
                      Antes de cambiar el correo, confirma que es el comprador: pídele la captura del pago y verifica la referencia
                      {t.referenciaPago ? ` (${t.referenciaPago})` : ""} y el monto. Así nadie se queda con entradas ajenas.
                    </p>
                    <label className="text-xs font-medium text-neutral-700">
                      Correo correcto
                      <input
                        type="email"
                        value={nuevoEmail}
                        onChange={(e) => setNuevoEmail(e.target.value)}
                        className="mt-1 w-full h-10 border border-neutral-300 rounded-md px-3 text-sm bg-white"
                      />
                    </label>
                    <label className="text-xs font-medium text-neutral-700">
                      Teléfono correcto
                      <input
                        type="tel"
                        value={nuevoTelefono}
                        onChange={(e) => setNuevoTelefono(e.target.value)}
                        className="mt-1 w-full h-10 border border-neutral-300 rounded-md px-3 text-sm bg-white"
                      />
                    </label>
                    <label className="flex items-start gap-2 text-xs text-neutral-800">
                      <input type="checkbox" checked={identidadConfirmada} onChange={(e) => setIdentidadConfirmada(e.target.checked)} className="mt-0.5" />
                      Verifiqué la captura del pago con la referencia y el monto.
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => guardarContacto(t)}
                        disabled={ocupado || !identidadConfirmada || !nuevoEmail.trim() || !nuevoTelefono.trim()}
                        className="h-9 px-3 bg-neutral-900 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                      >
                        {ocupado ? "Guardando…" : "Guardar datos"}
                      </button>
                      <button type="button" onClick={() => setEditando(null)} className="h-9 px-3 border border-neutral-300 rounded-lg text-xs font-semibold">
                        Cancelar
                      </button>
                    </div>
                  </div>
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

// Qué pasa al anular, dicho antes de tocar el botón. Anular SIEMPRE le avisa
// al comprador (Anita, 22 oct): "no pudimos verificar tu pago, tu entrada está
// en pausa, comunícate con nosotros" + WhatsApp. Cortesías y patrocinios no
// tuvieron pago: a esos no les llega ese correo.
function ConfirmarAnulacion({
  t,
  ocupado,
  onAnular,
  onCancelar,
}: {
  t: TicketBuscado;
  ocupado: boolean;
  onAnular: () => void;
  onCancelar: () => void;
}) {
  const sinPago = t.canal === "cortesia" || t.canal === "patrocinio";
  const leAvisa = !sinPago && !!t.compradorEmail;
  const varias = t.cantidad > 1;
  return (
    <div className="mt-1 border border-red-300 bg-red-50 rounded-lg p-3 flex flex-col gap-2">
      <p className="text-xs font-semibold text-red-900">
        Anular la compra de {t.compradorNombre}: {t.cantidad} × {etiquetaTipo(t.tipo, t.cantidad)} · {formatoUsd(t.precio)}
      </p>
      <ul className="text-xs text-red-900 list-disc pl-4 flex flex-col gap-0.5">
        <li>
          {t.canal === "taquilla"
            ? varias ? "Las entradas quedan sin efecto." : "La entrada queda sin efecto."
            : varias ? `Sus ${t.cantidad} QR dejan de servir: en la puerta salen “no válido”.` : "Su QR deja de servir: en la puerta sale “no válido”."}
        </li>
        <li>{conAsiento(t.tipo) ? (varias ? "Las sillas vuelven a la venta." : "La silla vuelve a la venta.") : "El cupo vuelve a la venta."}</li>
        {t.plan && <li>El plan de cuotas se anula con ella.</li>}
        <li>
          {leAvisa
            ? `Le llega un correo a ${t.compradorEmail}: “No pudimos verificar tu pago”, ${varias ? "sus entradas están" : "su entrada está"} en pausa y que se comunique con ustedes, con un botón de WhatsApp.`
            : sinPago
            ? "Es una entrada sin pago: no le llega correo. Avísale por WhatsApp."
            : "No tiene correo: avísale por WhatsApp."}
        </li>
        <li>Si después aparece el pago: búscala aquí y toca “Reabrir”.</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAnular}
          disabled={ocupado}
          className="h-9 px-3 bg-red-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
        >
          {ocupado ? "Anulando…" : leAvisa ? "Sí, anular y avisarle" : "Sí, anular"}
        </button>
        <button type="button" onClick={onCancelar} disabled={ocupado} className="h-9 px-3 border border-neutral-300 bg-white rounded-lg text-xs font-semibold">
          Cancelar
        </button>
      </div>
      <p className="text-[11px] text-red-800">No lo uses para cambios de zona: le llegaría ese correo. Los cambios de zona se hacen como dice el SOP.</p>
    </div>
  );
}

// Dónde se aprueba una compra pendiente. Antes decía siempre "está arriba en
// la lista de pendientes", y las compras en cuotas NO están ahí: están en
// Cobranza. Con 6 Preferenciales de Edimar Salas eso costó media mañana
// (Anita, 19 oct).
function DondeEsta({ t }: { t: TicketBuscado }) {
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const enCobranza = `/cobranza?q=${encodeURIComponent(codigoCompra(t.grupoId))}`;

  if (t.plan === undefined) {
    return (
      <p className="text-xs text-amber-700">
        No se pudo saber si es en cuotas. Si es de contado, está arriba en la lista de pendientes; si es en cuotas, está en{" "}
        <Link href={enCobranza} className="underline font-semibold">Cobranza</Link>.
      </p>
    );
  }
  if (t.plan === null) {
    return <p className="text-xs text-amber-700">Compra de contado: está arriba en la lista de pendientes — verifícala desde ahí.</p>;
  }
  if (t.plan.estado === "anulado" || t.plan.estado === "vencido") {
    return (
      <p className="text-xs rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-red-800">
        Compra en cuotas con el plan <strong>{t.plan.estado === "anulado" ? "anulado" : "caído por falta de pago"}</strong>. Pagó{" "}
        {usd(t.plan.pagadoUsd)} de {usd(t.plan.totalUsd)}. No se aprueba desde aquí: consúltalo con Anita.
      </p>
    );
  }
  return (
    <p className="text-xs rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-sky-900">
      <strong>Compra en cuotas</strong> · confirmado {usd(t.plan.pagadoUsd)} de {usd(t.plan.totalUsd)}
      {t.plan.porConfirmarUsd > 0 ? <> · <strong>{usd(t.plan.porConfirmarUsd)} por confirmar en el banco</strong></> : null}. No está
      en la lista de arriba: sus pagos se confirman en{" "}
      <Link href={enCobranza} className="underline font-semibold">
        Cobranza →
      </Link>
    </p>
  );
}
