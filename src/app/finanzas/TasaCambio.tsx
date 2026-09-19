"use client";

import { useState } from "react";
import { actualizarTasaManual } from "./actions";

export default function TasaCambio({ tasaActual }: { tasaActual: number | null }) {
  const [valor, setValor] = useState("");
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMensaje(null);
    if (!valor) return;
    setCargando(true);
    const res = await actualizarTasaManual(valor);
    setCargando(false);
    if (!res.ok) {
      setMensaje({ tipo: "error", texto: res.error });
      return;
    }
    setMensaje({ tipo: "ok", texto: "Tasa actualizada — ya se usa en la página de compra y en Ventas." });
    setValor("");
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Tasa EUR/Bs del día</p>
        <span className="text-sm font-mono tabular-nums text-neutral-600">
          {tasaActual !== null ? `Bs ${tasaActual.toLocaleString("es-VE")}` : "No disponible"}
        </span>
      </div>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Ej: 977.18"
          className="flex-1 border border-neutral-300 rounded-md px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={cargando}
          className="bg-neutral-900 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {cargando ? "Guardando…" : "Actualizar"}
        </button>
      </form>
      {mensaje && (
        <p className={`text-xs ${mensaje.tipo === "error" ? "text-red-600" : "text-green-700"}`}>{mensaje.texto}</p>
      )}
      <p className="text-[11px] text-neutral-400">
        Se actualiza sola todos los días a las 8am con el BCV oficial. Usa esto solo para corregirla o adelantarla si
        hace falta.
      </p>
    </div>
  );
}
