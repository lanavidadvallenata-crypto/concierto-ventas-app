"use client";

import { useEffect, useRef, useState } from "react";
import MapaVip, { type SillaElegida } from "@/components/MapaVip";
import type { MesaMapa } from "@/lib/mapa-vip";
import { calcularTotal, MAX_POR_COMPRA, type CotizacionCompra } from "@/lib/precios";
import { convertirABs } from "@/lib/tasa";
import {
  INSTRUCCIONES_PAGO,
  BINANCE_QR_URL,
  REFERENCIA_POR_METODO,
  metodosParaCanal,
  validarReferencia,
  validarTelefono,
  type MetodoPago,
} from "@/lib/pagos";
import { iniciarCheckoutPublico, confirmarCheckoutPublico, liberarHoldPublico } from "./actions";
import BotonSoporte from "@/components/BotonSoporte";
import { sugerirCorreo } from "@/lib/correo";
import { TEXTO_HORARIO, avisoFueraDeHorario } from "@/lib/horario";

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
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("pago_movil");
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
  const [codigoCompra, setCodigoCompra] = useState<string | null>(null);
  // Duración total del apartado (para la barra del contador).
  const [duracionPago, setDuracionPago] = useState(900);
  // Al cambiar de paso, la pantalla sube al inicio del formulario: si no, la
  // persona queda a media página y no ve el contador ni los avisos.
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fase === "seleccion") return;
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    raiz.current?.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "start" });
  }, [fase]);
  const [avisoHorario, setAvisoHorario] = useState<string | null>(null);

  const sugerenciaCorreo = email.includes("@") ? sugerirCorreo(email) : null;

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
    const errorTelefono = validarTelefono(telefono);
    if (errorTelefono) {
      setError(errorTelefono);
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
    setDuracionPago(Math.max(60, Math.round((new Date(res.expiraEn).getTime() - Date.now()) / 1000)));
    setCotizacion(res.cotizacion);
    setTasaCompra(res.tasaEurVes);
    setFase("pago");
  }

  async function confirmarPago() {
    setError(null);
    const errorReferencia = validarReferencia(metodoPago, referencia);
    if (errorReferencia) {
      setError(errorReferencia);
      return;
    }
    if (!email.trim()) {
      setError("Revisa tu correo: es donde te llegan tus QR.");
      return;
    }
    const errorTelefono = validarTelefono(telefono);
    if (errorTelefono) {
      setError(errorTelefono);
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
    setCodigoCompra(res.codigo ?? null);
    setAvisoHorario(avisoFueraDeHorario(new Date()));
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
    const avisoCorreo = (
      <div key="correo" className="rounded-xl border-2 border-evento-acento bg-[#FFF4F2] p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-evento-principal">
          <IconoCorreo />
          <p className="text-base font-bold leading-tight">Revisa Promociones y Spam</p>
        </div>
        <p className="text-sm leading-relaxed text-[#5A1A1D]">
          Tus QR llegan en <strong>otro correo</strong> de &ldquo;La Navidad Vallenata&rdquo;{codigoCompra ? <> con tu código <strong>{codigoCompra}</strong></> : null}.
          Muchas veces cae en <strong>Promociones</strong> o en <strong>Spam (No deseado)</strong>: búscalo ahí y márcalo como &ldquo;No es spam&rdquo;.
        </p>
        <div className="rounded-lg bg-white border border-[#F2C9C4] px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-neutral-500">Te lo enviamos a</p>
          <p className="text-base font-semibold text-neutral-900 break-all">{email}</p>
          {sugerenciaCorreo && (
            <p className="text-sm font-semibold text-evento-acento mt-1">
              ¿Está bien escrito? Parece que quisiste poner {sugerenciaCorreo}. Si es así, escríbenos por WhatsApp para corregirlo.
            </p>
          )}
        </div>
      </div>
    );
    const avisoHorarioBloque = (
      <div
        key="horario"
        className={`rounded-xl p-4 flex flex-col gap-1.5 ${avisoHorario ? "border-2 border-amber-500 bg-amber-50" : "border border-amber-300 bg-amber-50/70"}`}
      >
        <div className="flex items-center gap-2 text-amber-900">
          <IconoReloj />
          <p className="text-base font-bold leading-tight">¿Cuándo llegan tus QR?</p>
        </div>
        {avisoHorario ? <p className="text-sm font-semibold leading-relaxed text-amber-950">{avisoHorario}</p> : null}
        <p className="text-sm leading-relaxed text-amber-900">{TEXTO_HORARIO}</p>
      </div>
    );
    return (
      <div ref={raiz} className="scroll-mt-4 bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="bg-marca-secundario text-white px-5 pt-6 pb-5 text-center flex flex-col items-center gap-1.5">
          <span className="w-12 h-12 rounded-full bg-white/15 border border-white/30 flex items-center justify-center">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <p className="text-2xl font-bold leading-tight">¡Recibimos tu compra!</p>
          <p className="text-sm text-white/85">
            Estamos verificando tu pago. Cuando se confirme te enviamos{" "}
            {confirmadas > 1 ? `tus ${confirmadas} entradas con sus QR` : "tu entrada con su QR"}.
          </p>
          {codigoCompra && (
            <div className="mt-2 rounded-lg bg-white/10 border border-white/25 px-4 py-2 flex flex-col items-center">
              <span className="text-[11px] uppercase tracking-[0.14em] text-white/75">Tu código de compra</span>
              <span className="font-mono text-2xl font-bold tracking-[0.18em]">{codigoCompra}</span>
              <span className="text-[11px] text-white/70">Guárdalo: con él te atendemos más rápido</span>
            </div>
          )}
        </div>

        <div className="p-4 sm:p-5 flex flex-col gap-3">
          {duplicado && (
            <p className="text-sm rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2">
              Esta compra ya la teníamos registrada con esa misma referencia — no la duplicamos. Si de verdad son dos compras
              distintas, usa la referencia de cada pago por separado.
            </p>
          )}
          {avisoEmail && <p className="text-sm rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2">{avisoEmail}</p>}
          {/* Si entró fuera de horario, eso es lo primero que necesita saber. */}
          {avisoHorario ? [avisoHorarioBloque, avisoCorreo] : [avisoCorreo, avisoHorarioBloque]}
          <BotonSoporte
            variante="boton"
            texto="¿Escribiste mal tu correo o teléfono? Escríbenos"
            mensaje={`Hola, acabo de comprar entradas para La Navidad Vallenata${codigoCompra ? ` (compra ${codigoCompra})` : ""} a nombre de ${nombre}. Mi correo registrado es ${email} y necesito ayuda con: `}
          />
        </div>
      </div>
    );
  }

  if (fase === "pago" && cotizacion) {
    const metodo = METODOS_WEB.find((m) => m.valor === metodoPago)!;
    const minutos = Math.floor(segundosRestantes / 60);
    const segundos = segundosRestantes % 60;
    const expirado = segundosRestantes <= 0;
    const fraccion = Math.max(0, Math.min(1, segundosRestantes / duracionPago));
    const urgencia = segundosRestantes <= 120 ? "critico" : segundosRestantes <= 300 ? "aviso" : "normal";
    const enBolivares = metodo.moneda === "VES";
    const montoBs = enBolivares && tasaCompra ? convertirABs(cotizacion.total, tasaCompra) : null;
    return (
      <div ref={raiz} className="scroll-mt-4 bg-white border border-neutral-200 rounded-xl p-5 flex flex-col gap-4">
        {/* Contador: fijo arriba mientras la persona baja a ver los datos de pago. */}
        <div
          role="timer"
          aria-label={expirado ? "Tiempo agotado" : `Quedan ${minutos} minutos y ${segundos} segundos para pagar`}
          className={`sticky top-2 z-20 -mx-5 -mt-5 rounded-t-xl px-5 pt-3 pb-3 text-white shadow-lg ${
            expirado || urgencia === "critico" ? "bg-evento-acento" : urgencia === "aviso" ? "bg-amber-600" : "bg-marca-secundario"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-white/80">
                {expirado ? "Se acabó el tiempo" : tipo === "vip" ? "Tus sillas están apartadas" : "Tus entradas están apartadas"}
              </p>
              <p className="text-sm font-semibold leading-snug">
                {expirado
                  ? "Vuelve a elegir para intentarlo de nuevo"
                  : urgencia === "critico"
                  ? "¡Últimos minutos! Paga y confirma ya"
                  : "Paga y confirma antes de que termine el tiempo"}
              </p>
            </div>
            <span
              className={`font-mono text-4xl font-bold tabular-nums leading-none shrink-0 ${urgencia === "critico" && !expirado ? "motion-safe:animate-pulse" : ""}`}
            >
              {expirado ? "0:00" : `${minutos}:${segundos.toString().padStart(2, "0")}`}
            </span>
          </div>
          <div className="mt-2.5 h-2 rounded-full bg-white/25 overflow-hidden" aria-hidden="true">
            <div className="h-full rounded-full bg-white" style={{ width: `${fraccion * 100}%` }} />
          </div>
        </div>

        <p className="text-base font-semibold -mb-1">Completa tu pago</p>

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

        <div className="flex flex-col gap-1.5 border-y border-neutral-200 py-3 tabular-nums">
          {netoPorEtapa(cotizacion).map((r) => (
            <div key={r.etapa} className="flex items-center justify-between text-sm text-neutral-600">
              <span>
                {r.cantidad} × {r.nombreEtapa} · ${r.unitario.toFixed(2)} c/u
              </span>
              <span>${r.neto.toFixed(2)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-sm text-neutral-800 border-t border-dashed border-neutral-200 pt-1.5">
            <span>Subtotal (precio neto)</span>
            <span>${cotizacion.base.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-neutral-800">
            <span>Fee de servicio (10 %)</span>
            <span>${cotizacion.fee.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-base font-bold text-neutral-900 pt-1 border-t border-neutral-200 mt-0.5">
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
            <label className="block text-sm font-medium mb-1" htmlFor="referencia-pago">
              {REFERENCIA_POR_METODO[metodoPago].etiqueta}
            </label>
            <input
              id="referencia-pago"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              inputMode={REFERENCIA_POR_METODO[metodoPago].teclado}
              autoCapitalize={metodoPago === "zelle" ? "characters" : "off"}
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono tracking-wide"
              placeholder={REFERENCIA_POR_METODO[metodoPago].placeholder}
            />
            <p className="text-xs text-neutral-500 mt-1">{REFERENCIA_POR_METODO[metodoPago].ayuda}</p>
          </div>
        )}

        {!expirado && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex flex-col gap-2">
            <p className="text-sm font-semibold text-amber-900">Revisa tus datos antes de confirmar</p>
            <p className="text-xs text-amber-900/80 -mt-1">Tus QR llegan a este correo. Si está mal escrito, no te llegarán.</p>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1" htmlFor="correo-revision">Correo</label>
              <input
                id="correo-revision"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm bg-white"
              />
              {sugerenciaCorreo && (
                <button type="button" onClick={() => setEmail(sugerenciaCorreo)} className="text-xs text-amber-900 underline underline-offset-2 mt-1 text-left">
                  ¿Quisiste decir <strong>{sugerenciaCorreo}</strong>? Toca para corregir
                </button>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1" htmlFor="telefono-revision">Teléfono (WhatsApp)</label>
              <input
                id="telefono-revision"
                type="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                autoComplete="tel"
                className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm bg-white"
              />
            </div>
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
        <BotonSoporte mensaje={`Hola, estoy comprando entradas para La Navidad Vallenata a nombre de ${nombre || "(mi nombre)"} y tengo una duda con el pago: `} />
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
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
        />
        {sugerenciaCorreo ? (
          <button type="button" onClick={() => setEmail(sugerenciaCorreo)} className="text-xs text-amber-800 underline underline-offset-2 mt-1 text-left">
            ¿Quisiste decir <strong>{sugerenciaCorreo}</strong>? Toca para corregir
          </button>
        ) : (
          <p className="text-xs text-neutral-500 mt-1">Revísalo bien: si tiene un error, tus QR no te van a llegar.</p>
        )}
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
        <p className="text-xs text-neutral-500 mt-1">
          Después de pagar te vamos a pedir: <strong className="text-neutral-700">{REFERENCIA_POR_METODO[metodoPago].etiqueta.toLowerCase()}</strong>.
        </p>
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
      <BotonSoporte />
    </div>
  );
}

// Precio neto (sin fee) por etapa, para el desglose Subtotal / Fee / Total.
function netoPorEtapa(c: CotizacionCompra) {
  const mapa = new Map<string, { etapa: string; nombreEtapa: string; cantidad: number; unitario: number; neto: number }>();
  for (const l of c.lineas) {
    const r = mapa.get(l.etapa) ?? { etapa: l.etapa, nombreEtapa: l.nombreEtapa, cantidad: 0, unitario: l.base, neto: 0 };
    r.cantidad += 1;
    r.neto = Math.round((r.neto + l.base) * 100) / 100;
    mapa.set(l.etapa, r);
  }
  return [...mapa.values()];
}

function IconoCorreo() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
    </svg>
  );
}

function IconoReloj() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
