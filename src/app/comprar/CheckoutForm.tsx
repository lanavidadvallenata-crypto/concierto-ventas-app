"use client";

import { useEffect, useState } from "react";
import MapaVip, { type SillaElegida } from "@/components/MapaVip";
import type { MesaMapa } from "@/lib/mapa-vip";
import { calcularTotal, MAX_POR_COMPRA, type CotizacionCompra } from "@/lib/precios";
import { convertirABs } from "@/lib/tasa";
import { INSTRUCCIONES_PAGO, BINANCE_QR_URL, metodosParaCanal, type MetodoPago } from "@/lib/pagos";
import { iniciarCheckoutPublico, confirmarCheckoutPublico, liberarHoldPublico } from "./actions";

type Fase = "seleccion" | "pago" | "confirmado";

const METODOS_WEB = metodosParaCanal("web");

export default function CheckoutForm({
  mesas,
  sillasVipDisponibles,
  cupoGeneralRestante,
  tasaEurVes,
  preventa,
}: {
  mesas: MesaMapa[];
  sillasVipDisponibles: number;
  cupoGeneralRestante: number;
  tasaEurVes: number | null;
  // Cupo de preventa restante por tipo (null = no hay preventa activa).
  preventa: { vip: number; general: number; precioVip: number; precioGeneral: number } | null;
}) {
  const [fase, setFase] = useState<Fase>("seleccion");
  const [tipo, setTipo] = useState<"vip" | "general">("general");
  const [sillas, setSillas] = useState<SillaElegida[]>([]);
  const [cantidadGeneral, setCantidadGeneral] = useState(1);

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("transferencia");
  const [honeypot, setHoneypot] = useState("");

  const [referencia, setReferencia] = useState("");
  const [expiraEn, setExpiraEn] = useState<string | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);
  const [cotizacion, setCotizacion] = useState<CotizacionCompra | null>(null);
  const [tasaCompra, setTasaCompra] = useState<number | null>(tasaEurVes);

  const [cargando, setCargando] = useState(false);
  const [tardando, setTardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoEmail, setAvisoEmail] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState(false);
  const [confirmadas, setConfirmadas] = useState(0);

  const cantidad = tipo === "vip" ? sillas.length : cantidadGeneral;

  // Si el servidor tarda más de lo normal en responder (ej. mucho tráfico a la vez),
  // avisamos en vez de dejar el botón "Confirmando…" sin explicación.
  useEffect(() => {
    if (!cargando) return;
    const aviso = setTimeout(() => setTardando(true), 8000);
    return () => clearTimeout(aviso);
  }, [cargando]);

  useEffect(() => {
    if (fase !== "pago" || !expiraEn) return;
    const actualizar = () => {
      const restante = Math.max(0, Math.floor((new Date(expiraEn).getTime() - Date.now()) / 1000));
      setSegundosRestantes(restante);
    };
    actualizar();
    const intervalo = setInterval(actualizar, 1000);
    return () => clearInterval(intervalo);
  }, [fase, expiraEn]);

  // Estimación en pantalla antes de reservar (la real la calcula el servidor).
  const preventaRestante = preventa ? (tipo === "vip" ? preventa.vip : preventa.general) : 0;
  const unitarioPreventa = preventa ? (tipo === "vip" ? preventa.precioVip : preventa.precioGeneral) : 0;
  const unitarioRegular = calcularTotal(tipo).total;
  const enPreventa = Math.min(cantidad, Math.max(0, preventaRestante));
  const enRegular = Math.max(0, cantidad - enPreventa);
  const totalEstimado = Math.round((enPreventa * unitarioPreventa + enRegular * unitarioRegular) * 100) / 100;

  async function irAPago() {
    setError(null);
    if (tipo === "vip" && sillas.length === 0) {
      setError("Toca una mesa y elige tus sillas en el mapa.");
      return;
    }
    if (!nombre || !telefono || !email) {
      setError("Completa nombre, teléfono y correo.");
      return;
    }
    setCargando(true);
    const res = await iniciarCheckoutPublico({
      tipo,
      sillaIds: tipo === "vip" ? sillas.map((s) => s.id) : undefined,
      cantidad: tipo === "general" ? cantidadGeneral : undefined,
    });
    setCargando(false);
    setTardando(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setExpiraEn(res.expiraEn);
    setCotizacion(res.cotizacion);
    setTasaCompra(res.tasaEurVes);
    setFase("pago");
  }

  async function confirmarPago() {
    setError(null);
    if (!referencia) {
      setError("Ingresa el número de referencia del pago.");
      return;
    }
    setCargando(true);
    const res = await confirmarCheckoutPublico({
      tipo,
      sillaIds: tipo === "vip" ? sillas.map((s) => s.id) : undefined,
      cantidad: tipo === "general" ? cantidadGeneral : undefined,
      expiraEnEsperado: expiraEn ?? undefined,
      tasaMostrada: tasaCompra ?? undefined,
      compradorNombre: nombre,
      compradorTelefono: telefono,
      compradorEmail: email,
      metodoPago,
      referenciaPago: referencia,
      honeypot,
    });
    setCargando(false);
    setTardando(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAvisoEmail(res.avisoEmail ?? null);
    setDuplicado(res.duplicado ?? false);
    setConfirmadas(res.cantidad);
    setFase("confirmado");
  }

  function volverAElegir() {
    // Suelta el hold de estas sillas para que no queden bloqueadas 15 min
    // (y para que el mismo comprador pueda volver a elegirlas).
    if (tipo === "vip" && sillas.length && expiraEn) {
      void liberarHoldPublico({ sillaIds: sillas.map((s) => s.id), expiraEn });
    }
    setSillas([]);
    setExpiraEn(null);
    setCotizacion(null);
    setError(null);
    setFase("seleccion");
  }

  if (fase === "confirmado") {
    return (
      <div className="bg-white border border-neutral-200 rounded-xl p-6 text-center flex flex-col gap-2">
        <p className="text-lg font-semibold">¡Recibimos tu compra! 🎄</p>
        <p className="text-sm text-neutral-600">
          Estamos verificando tu pago. En cuanto se confirme, te llegará un correo a <strong>{email}</strong> con{" "}
          {confirmadas > 1 ? `tus ${confirmadas} entradas y sus códigos QR` : "tu entrada y código QR"} de acceso.
        </p>
        {duplicado && (
          <p className="text-sm text-amber-700 mt-2">
            Esta compra ya la teníamos registrada con esa misma referencia — no la duplicamos. Si de verdad son dos
            compras distintas, usa la referencia de cada pago por separado.
          </p>
        )}
        {avisoEmail && <p className="text-sm text-amber-700 mt-2">{avisoEmail}</p>}
      </div>
    );
  }

  if (fase === "pago" && cotizacion) {
    const metodo = METODOS_WEB.find((m) => m.valor === metodoPago)!;
    const minutos = Math.floor(segundosRestantes / 60);
    const segundos = segundosRestantes % 60;
    const expirado = segundosRestantes <= 0;
    const enBolivares = metodo.moneda === "VES";
    const montoBs = enBolivares && tasaCompra ? convertirABs(cotizacion.total, tasaCompra) : null;
    return (
      <div className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Completa tu pago</p>
          <span className={`text-sm font-mono font-semibold ${expirado ? "text-red-600" : "text-neutral-700"}`}>
            {expirado ? "Tiempo agotado" : `${minutos}:${segundos.toString().padStart(2, "0")}`}
          </span>
        </div>

        {tipo === "vip" && sillas.length > 0 && (
          <p className="text-sm text-neutral-600">
            {sillas.length === 1 ? "Silla" : `${sillas.length} sillas`}:{" "}
            {sillas.map((s) => `${s.fila}${s.mesaNumero}·S${s.numero}`).join(", ")}
          </p>
        )}
        {tipo === "general" && (
          <p className="text-sm text-neutral-600">
            {cantidad} entrada{cantidad === 1 ? "" : "s"} General
          </p>
        )}

        <div className="flex flex-col gap-1.5 border-y border-neutral-200 py-3">
          {cotizacion.resumen.map((r) => (
            <div key={r.etapa} className="flex items-center justify-between text-sm text-neutral-600">
              <span>
                {r.cantidad} × {r.nombreEtapa}
              </span>
              <span>${(r.cantidad * r.totalUnitario).toFixed(2)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>Incluye fee de servicio (10 %)</span>
            <span>${cotizacion.fee.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-base font-bold text-neutral-900 pt-1">
            <span>Total a pagar</span>
            <span>${cotizacion.total.toFixed(2)}</span>
          </div>
        </div>
        {enBolivares && (
          <p className="text-sm text-neutral-700 -mt-2">
            {montoBs !== null ? (
              <>
                Paga exactamente <strong>Bs {montoBs.toLocaleString("es-VE", { minimumFractionDigits: 2 })}</strong>{" "}
                <span className="text-neutral-500">(tasa BCV euro de hoy)</span>
              </>
            ) : (
              "Tasa del día no disponible todavía — confirma el monto en bolívares por WhatsApp antes de pagar."
            )}
          </p>
        )}

        {expirado ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            Se venció el tiempo para pagar{tipo === "vip" ? " y tus sillas se liberaron" : ""}. Vuelve a intentarlo.
          </div>
        ) : (
          <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 text-sm text-neutral-700 whitespace-pre-line flex flex-col gap-3">
            <div>
              <p className="font-semibold mb-1">{metodo.etiqueta} ({metodo.moneda})</p>
              {INSTRUCCIONES_PAGO[metodoPago]}
            </div>
            {metodoPago === "binance" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={BINANCE_QR_URL}
                alt="Código QR de Binance Pay para pagar"
                className="w-40 h-40 object-contain self-center rounded-md border border-neutral-200 bg-white"
              />
            )}
          </div>
        )}

        {!expirado && (
          <div>
            <label className="block text-sm font-medium mb-1">Número de referencia del pago</label>
            <input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
              placeholder="Últimos dígitos, número de confirmación…"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {cargando && tardando && (
          <p className="text-xs text-amber-700">
            Esto está tardando más de lo normal — no cierres esta pantalla ni vuelvas a tocar el botón, tu compra se está procesando.
          </p>
        )}

        {expirado ? (
          <button
            type="button"
            onClick={volverAElegir}
            className="bg-marca-secundario text-white rounded-md py-2 text-sm font-medium"
          >
            Volver a elegir
          </button>
        ) : (
          <button
            type="button"
            disabled={cargando}
            onClick={confirmarPago}
            className="bg-marca-secundario text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
          >
            {cargando ? "Confirmando…" : "Ya pagué — confirmar"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col gap-4">
      {preventa && (preventa.vip > 0 || preventa.general > 0) && (
        <div className="bg-evento-principal text-white rounded-lg px-4 py-3 text-sm">
          <p className="font-semibold">Preventa activa</p>
          <p className="text-marca-acento/90 text-xs mt-0.5">
            {preventa.vip > 0 && `VIP $${(preventa.precioVip / 1.1).toFixed(0)} · quedan ${preventa.vip}`}
            {preventa.vip > 0 && preventa.general > 0 && " · "}
            {preventa.general > 0 && `General $${(preventa.precioGeneral / 1.1).toFixed(0)} · quedan ${preventa.general}`}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {(["general", "vip"] as const).map((t) => {
          const activo = tipo === t;
          const hayPreventa = preventa && (t === "vip" ? preventa.vip : preventa.general) > 0;
          const base = hayPreventa
            ? (t === "vip" ? preventa!.precioVip : preventa!.precioGeneral) / 1.1
            : calcularTotal(t).base;
          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTipo(t);
                if (t === "general") setSillas([]);
              }}
              className={`flex-1 rounded-md py-2 text-sm font-medium border flex flex-col items-center leading-tight ${
                activo ? "bg-marca-secundario text-white border-marca-secundario" : "border-neutral-300 text-neutral-600"
              }`}
            >
              <span>
                {t === "vip" ? "VIP" : "General"} · ${Math.round(base)}
              </span>
              <span className={`text-[10px] font-normal ${activo ? "text-white/75" : "text-neutral-400"}`}>
                {hayPreventa ? "preventa · + fee" : "+ fee de servicio"}
              </span>
            </button>
          );
        })}
      </div>

      {tipo === "vip" ? (
        <div>
          <p className="text-xs text-neutral-500 mb-2">
            {sillasVipDisponibles} sillas VIP disponibles · elige hasta {MAX_POR_COMPRA.vip} por compra
          </p>
          <MapaVip
            mesas={mesas}
            seleccionadas={sillas}
            onCambiar={setSillas}
            maximo={MAX_POR_COMPRA.vip}
            cupoGeneralRestante={cupoGeneralRestante}
          />
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium mb-1">¿Cuántas entradas?</label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCantidadGeneral((c) => Math.max(1, c - 1))}
              className="w-11 h-11 rounded-md border border-neutral-300 text-lg font-semibold"
              aria-label="Menos"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={Math.min(MAX_POR_COMPRA.general, Math.max(1, cupoGeneralRestante))}
              value={cantidadGeneral}
              onChange={(e) =>
                setCantidadGeneral(Math.max(1, Math.min(MAX_POR_COMPRA.general, Number(e.target.value) || 1)))
              }
              className="w-16 h-11 text-center border border-neutral-300 rounded-md text-base font-semibold"
            />
            <button
              type="button"
              onClick={() => setCantidadGeneral((c) => Math.min(MAX_POR_COMPRA.general, c + 1))}
              className="w-11 h-11 rounded-md border border-neutral-300 text-lg font-semibold"
              aria-label="Más"
            >
              +
            </button>
            <span className="text-xs text-neutral-500">máx. {MAX_POR_COMPRA.general} · {cupoGeneralRestante} disponibles</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Nombre completo</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Teléfono (WhatsApp)</label>
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Correo (para enviarte los QR)</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Método de pago</label>
        <select
          value={metodoPago}
          onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
        >
          {METODOS_WEB.map((m) => (
            <option key={m.valor} value={m.valor} disabled={!m.activo}>
              {m.etiqueta} ({m.moneda}){!m.activo ? " — muy pronto" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Campo trampa para bots — invisible para personas */}
      <input
        type="text"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        className="absolute opacity-0 pointer-events-none -z-10"
        style={{ left: "-9999px" }}
        aria-hidden="true"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}
      {cargando && tardando && (
        <p className="text-xs text-amber-700 text-center">
          Esto está tardando más de lo normal — no cierres esta pantalla, ya casi.
        </p>
      )}

      <p className="text-[11px] text-neutral-400 text-center -mb-1">
        {cantidad > 0
          ? `${cantidad} entrada${cantidad === 1 ? "" : "s"} · total estimado $${totalEstimado.toFixed(2)} (incluye fee 10 %). Verás el desglose en el siguiente paso.`
          : "Elige tus entradas para ver el total."}
      </p>

      <button
        type="button"
        disabled={cargando || cantidad === 0}
        onClick={irAPago}
        className="bg-marca-secundario text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
      >
        {cargando ? "Reservando…" : cantidad > 0 ? `Continuar — $${totalEstimado.toFixed(2)}` : "Continuar"}
      </button>
    </div>
  );
}
