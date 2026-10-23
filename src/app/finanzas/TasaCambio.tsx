"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { actualizarTasaManual } from "./actions";
import { CAMPO, TARJETA } from "@/components/noche/estilos";

export default function TasaCambio({ tasaActual }: { tasaActual: number | null }) {
  const [valor, setValor] = useState("");
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const router = useRouter();

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
    router.refresh();
  }

  return (
    <div className={`${TARJETA} p-4 flex flex-col gap-2.5`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Tasa EUR/Bs del día</h2>
        <span className="text-[15px] font-mono font-semibold tabular-nums text-lila-claro">
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
          aria-label="Nueva tasa EUR/Bs"
          className={`flex-1 min-w-0 ${CAMPO}`}
        />
        <button
          type="submit"
          disabled={cargando}
          className="h-11 px-4 rounded-xl border border-lila/40 bg-violeta-hondo/30 hover:bg-violeta-hondo/45 text-noche-texto text-sm font-semibold disabled:opacity-50"
        >
          {cargando ? "Guardando…" : "Actualizar"}
        </button>
      </form>
      {mensaje && (
        <p className={`text-xs ${mensaje.tipo === "error" ? "text-red-300" : "text-emerald-300"}`}>{mensaje.texto}</p>
      )}
      <p className="text-[11px] text-noche-tenue">
        Se actualiza sola todos los días a las 8am con el BCV oficial. Usa esto solo para corregirla o adelantarla si
        hace falta.
      </p>
    </div>
  );
}
