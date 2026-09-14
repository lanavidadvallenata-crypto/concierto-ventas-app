"use client";

import { useState, useTransition } from "react";
import { registrarVenta } from "./actions";
import MapaVip, { type SillaElegida } from "@/components/MapaVip";
import type { MesaMapa } from "@/lib/mapa-vip";

const PRECIO_SUGERIDO: Record<"vip" | "general", number> = { vip: 120, general: 30 };

export default function VentaForm({ mesas }: { mesas: MesaMapa[] }) {
  const [tipo, setTipo] = useState<"vip" | "general">("general");
  const [precio, setPrecio] = useState<number>(PRECIO_SUGERIDO.general);
  const [sillaElegida, setSillaElegida] = useState<SillaElegida | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function cambiarTipo(t: "vip" | "general") {
    setTipo(t);
    setPrecio(PRECIO_SUGERIDO[t]);
    if (t === "general") setSillaElegida(null);
  }

  function onSubmit(formData: FormData) {
    setMensaje(null);
    if (tipo === "vip" && !sillaElegida) {
      setMensaje({ tipo: "error", texto: "Toca una mesa y elige una silla en el mapa antes de registrar la venta." });
      return;
    }
    startTransition(async () => {
      const res = await registrarVenta(formData);
      if (res.ok) {
        setMensaje({
          tipo: res.avisoEmail ? "error" : "ok",
          texto: res.avisoEmail || "Venta registrada — le llegó un correo de bienvenida al comprador. Pasa a Finanzas para verificar el pago.",
        });
        (document.getElementById("venta-form") as HTMLFormElement)?.reset();
        setSillaElegida(null);
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

      {tipo === "vip" ? (
        <div>
          <label className="block text-sm font-medium mb-1">Silla</label>
          <input type="hidden" name="sillaId" value={sillaElegida?.id ?? ""} />
          <MapaVip mesas={mesas} sillaSeleccionadaId={sillaElegida?.id ?? null} onSeleccionar={setSillaElegida} />
          <p className="text-xs text-neutral-500 mt-2">
            {sillaElegida
              ? `Elegida: Fila ${sillaElegida.fila} · Mesa ${sillaElegida.mesaNumero} · Silla ${sillaElegida.numero}`
              : "Toca una mesa en el mapa para ver sus sillas."}
          </p>
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium mb-1">Cantidad de entradas generales</label>
          <input
            name="cantidadGeneral"
            type="number"
            min={1}
            max={20}
            defaultValue={1}
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
          />
          <p className="text-xs text-neutral-400 mt-1">Por ahora se registra 1 ticket por comprador — para grupos, registra una venta por cada entrada.</p>
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
        <label className="block text-sm font-medium mb-1">Correo (para enviarle el QR)</label>
        <input name="compradorEmail" type="email" required className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Precio (USD)</label>
          <input
            name="precio"
            type="number"
            step="0.01"
            required
            value={precio}
            onChange={(e) => setPrecio(Number(e.target.value))}
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Método de pago</label>
          <select name="metodoPago" required className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm">
            <option value="pago_movil">Pago móvil</option>
            <option value="transferencia">Transferencia</option>
            <option value="zelle">Zelle</option>
            <option value="binance">Binance</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Referencia del pago</label>
        <input name="referenciaPago" className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" placeholder="Últimos dígitos, número de confirmación…" />
      </div>

      {mensaje && (
        <p className={`text-sm ${mensaje.tipo === "ok" ? "text-green-700" : "text-red-600"}`}>{mensaje.texto}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-neutral-900 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Registrando…" : "Registrar venta"}
      </button>
    </form>
  );
}
