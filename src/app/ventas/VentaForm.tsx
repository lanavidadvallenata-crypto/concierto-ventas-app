"use client";

import { useState, useTransition } from "react";
import { registrarVenta } from "./actions";
import MapaVip, { type SillaElegida } from "@/components/MapaVip";
import type { MesaMapa } from "@/lib/mapa-vip";
import { calcularTotal, MAX_POR_COMPRA } from "@/lib/precios";
import { convertirABs } from "@/lib/tasa";
import { metodosParaCanal, type MetodoPago } from "@/lib/pagos";

const METODOS = metodosParaCanal("manual");

export type PreventaInfo = { vip: number; general: number; precioVip: number; precioGeneral: number } | null;

export default function VentaForm({
  mesas,
  cupoGeneralRestante,
  tasaEurVes,
  preventa,
}: {
  mesas: MesaMapa[];
  cupoGeneralRestante?: number;
  tasaEurVes: number | null;
  preventa: PreventaInfo;
}) {
  const [tipo, setTipo] = useState<"vip" | "general">("general");
  const [sillas, setSillas] = useState<SillaElegida[]>([]);
  const [cantidadGeneral, setCantidadGeneral] = useState(1);
  // null = usar el sugerido; número = el vendedor lo editó (negoció).
  const [precioManual, setPrecioManual] = useState<number | null>(null);
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("transferencia");
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const cantidad = tipo === "vip" ? sillas.length : cantidadGeneral;

  // Precio sugerido según etapa (preventa mientras quede cupo, luego regular).
  const preventaRestante = preventa ? (tipo === "vip" ? preventa.vip : preventa.general) : 0;
  const unitarioPreventa = preventa ? (tipo === "vip" ? preventa.precioVip : preventa.precioGeneral) : 0;
  const unitarioRegular = calcularTotal(tipo).total;
  const enPreventa = Math.min(cantidad, Math.max(0, preventaRestante));
  const enRegular = Math.max(0, cantidad - enPreventa);
  const sugerido = Math.round((enPreventa * unitarioPreventa + enRegular * unitarioRegular) * 100) / 100;

  const precio = precioManual ?? sugerido;
  const precioEditado = precioManual !== null;

  const enBolivares = metodoPago === "pago_movil" || metodoPago === "transferencia" || metodoPago === "efectivo_bs";
  const montoBs = enBolivares && tasaEurVes ? convertirABs(precio, tasaEurVes) : null;

  function cambiarTipo(t: "vip" | "general") {
    setTipo(t);
    setPrecioManual(null);
    if (t === "general") setSillas([]);
  }

  function onSubmit(formData: FormData) {
    setMensaje(null);
    if (tipo === "vip" && sillas.length === 0) {
      setMensaje({ tipo: "error", texto: "Toca una mesa y elige las sillas en el mapa antes de registrar la venta." });
      return;
    }
    startTransition(async () => {
      const res = await registrarVenta(formData);
      if (res.ok) {
        setMensaje({
          tipo: res.avisoEmail ? "error" : "ok",
          texto:
            res.avisoEmail ||
            `Venta registrada: ${res.cantidad} entrada${res.cantidad === 1 ? "" : "s"} por $${res.total.toFixed(2)}. Al comprador le llegó el correo de bienvenida. Pasa a Finanzas para verificar el pago.`,
        });
        (document.getElementById("venta-form") as HTMLFormElement)?.reset();
        setSillas([]);
        setCantidadGeneral(1);
        setPrecioManual(null);
      } else {
        setMensaje({ tipo: "error", texto: res.error });
      }
    });
  }

  return (
    <form id="venta-form" action={onSubmit} className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex gap-2">
        {(["general", "vip"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => cambiarTipo(t)}
            className={`flex-1 rounded-md py-2 text-sm font-medium border ${
              tipo === t ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-300 text-neutral-600"
            }`}
          >
            {t === "vip" ? "VIP" : "General"}
          </button>
        ))}
      </div>
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="sillaIds" value={JSON.stringify(sillas.map((s) => s.id))} />

      {tipo === "vip" ? (
        <div>
          <label className="block text-sm font-medium mb-1">Sillas (hasta {MAX_POR_COMPRA.vip})</label>
          <MapaVip
            mesas={mesas}
            seleccionadas={sillas}
            onCambiar={(s) => {
              setSillas(s);
              setPrecioManual(null);
            }}
            maximo={MAX_POR_COMPRA.vip}
            cupoGeneralRestante={cupoGeneralRestante}
          />
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium mb-1">Cantidad de entradas generales (hasta {MAX_POR_COMPRA.general})</label>
          <input
            name="cantidadGeneral"
            type="number"
            min={1}
            max={MAX_POR_COMPRA.general}
            value={cantidadGeneral}
            onChange={(e) => {
              setCantidadGeneral(Math.max(1, Math.min(MAX_POR_COMPRA.general, Number(e.target.value) || 1)));
              setPrecioManual(null);
            }}
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
          />
          <p className="text-xs text-neutral-400 mt-1">Se crea un ticket (y un QR) por cada entrada, todos al mismo correo.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Nombre del comprador</label>
          <input name="compradorNombre" required className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Teléfono (WhatsApp)</label>
          <input name="compradorTelefono" required className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Correo (para enviarle los QR)</label>
        <input name="compradorEmail" type="email" required className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Precio total (USD) — incluye 10% fee</label>
          <input
            name="precio"
            type="number"
            step="0.01"
            required
            value={precio}
            onChange={(e) => setPrecioManual(Number(e.target.value))}
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
          />
          <p className="text-xs text-neutral-400 mt-1">
            {cantidad === 0
              ? "Elige las entradas para ver el precio sugerido."
              : enPreventa > 0 && enRegular > 0
              ? `${enPreventa} × $${unitarioPreventa.toFixed(2)} preventa + ${enRegular} × $${unitarioRegular.toFixed(2)} = $${sugerido.toFixed(2)}. Editable si negociaste otro precio.`
              : enPreventa > 0
              ? `${cantidad} × $${unitarioPreventa.toFixed(2)} (preventa) = $${sugerido.toFixed(2)}. Editable si negociaste otro precio.`
              : `${cantidad} × $${unitarioRegular.toFixed(2)} = $${sugerido.toFixed(2)}. Editable si negociaste otro precio.`}
            {precioEditado && (
              <button type="button" onClick={() => setPrecioManual(null)} className="ml-2 underline">
                usar sugerido
              </button>
            )}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Método de pago</label>
          <select
            name="metodoPago"
            required
            value={metodoPago}
            onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
          >
            {METODOS.map((m) => (
              <option key={m.valor} value={m.valor} disabled={!m.activo}>
                {m.etiqueta}
                {!m.activo ? " — muy pronto" : ""}
              </option>
            ))}
          </select>
          {enBolivares && (
            <p className="text-xs text-neutral-500 mt-1">
              {montoBs !== null
                ? `≈ Bs ${montoBs.toLocaleString("es-VE")} (tasa del día)`
                : "Tasa del día aún no disponible — usa el monto en USD como referencia."}
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Referencia del pago</label>
        <input name="referenciaPago" className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" placeholder="Últimos dígitos, número de confirmación…" />
      </div>

      {mensaje && (
        <div
          role={mensaje.tipo === "ok" ? "status" : "alert"}
          className={`rounded-lg border px-3 py-2.5 text-sm font-medium ${
            mensaje.tipo === "ok" ? "bg-green-50 border-green-300 text-green-800" : "bg-red-50 border-red-300 text-red-800"
          }`}
        >
          {mensaje.texto}
        </div>
      )}

      <button
        type="submit"
        disabled={pending || cantidad === 0}
        className="bg-neutral-900 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Registrando…" : cantidad > 1 ? `Registrar venta (${cantidad} entradas)` : "Registrar venta"}
      </button>
    </form>
  );
}
