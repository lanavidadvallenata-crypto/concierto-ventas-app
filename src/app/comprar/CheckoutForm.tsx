"use client";

import { useEffect, useState } from "react";
import MapaVip, { type SillaElegida } from "@/components/MapaVip";
import type { MesaMapa } from "@/lib/mapa-vip";
import { calcularTotal } from "@/lib/precios";
import { convertirABs } from "@/lib/tasa";
import { METODOS_PAGO, INSTRUCCIONES_PAGO, type MetodoPago } from "@/lib/pagos";
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
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("pago_movil");
  const [honeypot, setHoneypot] = useState("");

  const [referencia, setReferencia] = useState("");
  const [expiraEn, setExpiraEn] = useState<string | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);

  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoEmail, setAvisoEmail] = useState<string | null>(null);

  const total = calcularTotal(tipo).total;

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
        <p className="text-2xl font-bold">${total.toFixed(2)}</p>
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
          <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 text-sm text-neutral-700 whitespace-pre-line">
            <p className="font-semibold mb-1">{metodo.etiqueta} ({metodo.moneda})</p>
            {INSTRUCCIONES_PAGO[metodoPago]}
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
            className="bg-neutral-900 text-white rounded-md py-2 text-sm font-medium"
          >
            Volver a elegir
          </button>
        ) : (
          <button
            type="button"
            disabled={cargando}
            onClick={confirmarPago}
            className="bg-neutral-900 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
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
        {(["general", "vip"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTipo(t);
              if (t === "general") setSillaElegida(null);
            }}
            className={`flex-1 rounded-md py-2 text-sm font-medium border ${
              tipo === t ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-300 text-neutral-600"
            }`}
          >
            {t === "vip" ? `VIP · $${calcularTotal("vip").total}` : `General · $${calcularTotal("general").total}`}
          </button>
        ))}
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
            <option key={m.valor} value={m.valor}>
              {m.etiqueta} ({m.moneda})
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

      <button
        type="button"
        disabled={cargando}
        onClick={irAPago}
        className="bg-neutral-900 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
      >
        {cargando ? "Reservando…" : `Continuar — $${total.toFixed(2)}`}
      </button>
    </div>
  );
}
