"use client";

import { useEffect, useState } from "react";
import MapaVip, { type SillaElegida } from "@/components/MapaVip";
import type { MesaMapa } from "@/lib/mapa-vip";
import { calcularTotal } from "@/lib/precios";
import { convertirABs } from "@/lib/tasa";
import { METODOS_PAGO, INSTRUCCIONES_PAGO, BINANCE_QR_URL, type MetodoPago } from "@/lib/pagos";
import { iniciarCheckoutPublico, confirmarCheckoutPublico } from "./actions";

type Fase = "seleccion" | "pago" | "confirmado";

export default function CheckoutForm({
  mesas,
  sillasVipDisponibles,
  cupoGeneralRestante,
  tasaEurVes,
}: {
  mesas: MesaMapa[];
  sillasVipDisponibles: number;
  cupoGeneralRestante: number;
  tasaEurVes: number | null;
}) {
  const [fase, setFase] = useState<Fase>("seleccion");
  const [tipo, setTipo] = useState<"vip" | "general">("general");
  const [sillaElegida, setSillaElegida] = useState<SillaElegida | null>(null);

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("transferencia");
  const [honeypot, setHoneypot] = useState("");

  const [referencia, setReferencia] = useState("");
  const [expiraEn, setExpiraEn] = useState<string | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);

  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoEmail, setAvisoEmail] = useState<string | null>(null);

  const { base, fee, total } = calcularTotal(tipo);

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

  async function irAPago() {
    setError(null);
    if (tipo === "vip" && !sillaElegida) {
      setError("Toca una mesa y elige tu silla en el mapa.");
      return;
    }
    if (!nombre || !telefono || !email) {
      setError("Completa nombre, teléfono y correo.");
      return;
    }
    setCargando(true);
    const res = await iniciarCheckoutPublico({ tipo, sillaId: sillaElegida?.id });
    setCargando(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setExpiraEn(res.expiraEn);
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
      sillaId: sillaElegida?.id,
      expiraEnEsperado: expiraEn ?? undefined,
      compradorNombre: nombre,
      compradorTelefono: telefono,
      compradorEmail: email,
      metodoPago,
      referenciaPago: referencia,
      honeypot,
    });
    setCargando(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAvisoEmail(res.avisoEmail ?? null);
    setFase("confirmado");
  }

  function volverAElegir() {
    setSillaElegida(null);
    setExpiraEn(null);
    setError(null);
    setFase("seleccion");
  }

  if (fase === "confirmado") {
    return (
      <div className="bg-white border border-neutral-200 rounded-xl p-6 text-center flex flex-col gap-2">
        <p className="text-lg font-semibold">¡Recibimos tu compra! 🎄</p>
        <p className="text-sm text-neutral-600">
          Estamos verificando tu pago. En cuanto se confirme, te llegará un correo a <strong>{email}</strong> con tu
          entrada y código QR de acceso.
        </p>
        {avisoEmail && <p className="text-sm text-amber-700 mt-2">{avisoEmail}</p>}
      </div>
    );
  }

  if (fase === "pago") {
    const metodo = METODOS_PAGO.find((m) => m.valor === metodoPago)!;
    const minutos = Math.floor(segundosRestantes / 60);
    const segundos = segundosRestantes % 60;
    const expirado = segundosRestantes <= 0;
    const enBolivares = metodo.moneda === "VES";
    const montoBs = enBolivares && tasaEurVes ? convertirABs(total, tasaEurVes) : null;
    return (
      <div className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Completa tu pago</p>
          <span className={`text-sm font-mono font-semibold ${expirado ? "text-red-600" : "text-neutral-700"}`}>
            {expirado ? "Tiempo agotado" : `${minutos}:${segundos.toString().padStart(2, "0")}`}
          </span>
        </div>

        {tipo === "vip" && sillaElegida && (
          <p className="text-sm text-neutral-600">
            Fila {sillaElegida.fila} · Mesa {sillaElegida.mesaNumero} · Silla {sillaElegida.numero}
          </p>
        )}
        <div className="flex flex-col gap-1.5 border-y border-neutral-200 py-3">
          <div className="flex items-center justify-between text-sm text-neutral-500">
            <span>Precio base</span>
            <span>${base.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-neutral-500">
            <span>Fee de servicio (10%)</span>
            <span>${fee.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-base font-bold text-neutral-900 pt-1">
            <span>Total a pagar</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>
        {enBolivares && (
          <p className="text-sm text-neutral-600 -mt-2">
            {montoBs !== null
              ? `≈ Bs ${montoBs.toLocaleString("es-VE")} a la tasa de hoy`
              : "Tasa del día no disponible todavía — confirma el monto en bolívares por WhatsApp antes de pagar."}
          </p>
        )}

        {expirado ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            Se venció el tiempo para pagar{tipo === "vip" ? " y tu silla se liberó" : ""}. Vuelve a intentarlo.
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
      <div className="flex gap-2">
        {(["general", "vip"] as const).map((t) => {
          const precioTipo = calcularTotal(t);
          const activo = tipo === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTipo(t);
                if (t === "general") setSillaElegida(null);
              }}
              className={`flex-1 rounded-md py-2 text-sm font-medium border flex flex-col items-center leading-tight ${
                activo ? "bg-marca-secundario text-white border-marca-secundario" : "border-neutral-300 text-neutral-600"
              }`}
            >
              <span>
                {t === "vip" ? "VIP" : "General"} · ${precioTipo.base}
              </span>
              <span className={`text-[10px] font-normal ${activo ? "text-white/75" : "text-neutral-400"}`}>
                + fee de servicio
              </span>
            </button>
          );
        })}
      </div>

      {tipo === "vip" ? (
        <div>
          <p className="text-xs text-neutral-500 mb-2">{sillasVipDisponibles} sillas VIP disponibles</p>
          <MapaVip
            mesas={mesas}
            sillaSeleccionadaId={sillaElegida?.id ?? null}
            onSeleccionar={setSillaElegida}
            cupoGeneralRestante={cupoGeneralRestante}
          />
          <p className="text-xs text-neutral-500 mt-2">
            {sillaElegida
              ? `Elegida: Fila ${sillaElegida.fila} · Mesa ${sillaElegida.mesaNumero} · Silla ${sillaElegida.numero}`
              : "Toca una mesa en el mapa para ver sus sillas."}
          </p>
        </div>
      ) : (
        <p className="text-xs text-neutral-500">{cupoGeneralRestante} cupos generales restantes</p>
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
        <label className="block text-sm font-medium mb-1">Correo (para enviarte el QR)</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Método de pago</label>
        <select
          value={metodoPago}
          onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
        >
          {METODOS_PAGO.map((m) => (
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

      <p className="text-[11px] text-neutral-400 text-center -mb-1">
        Precio base ${base.toFixed(2)} + fee de servicio (10%) — verás el total desglosado en el siguiente paso.
      </p>

      <button
        type="button"
        disabled={cargando}
        onClick={irAPago}
        className="bg-marca-secundario text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
      >
        {cargando ? "Reservando…" : `Continuar — $${base.toFixed(2)}`}
      </button>
    </div>
  );
}
