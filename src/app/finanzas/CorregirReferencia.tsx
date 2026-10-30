"use client";

import { useState } from "react";
import { ETIQUETA_METODO } from "@/lib/formato";
import { REFERENCIA_POR_METODO, normalizarReferencia, validarReferencia, type MetodoPago } from "@/lib/pagos";

// Corregir la referencia de una compra de contado por verificar (Anita,
// 30 oct), sin rechazarla. El método solo cambia dentro de la misma moneda.

export default function CorregirReferencia({
  metodoActual,
  referenciaActual,
  metodos,
  ocupado,
  onGuardar,
  onCancelar,
}: {
  metodoActual: string;
  referenciaActual: string | null;
  metodos: MetodoPago[];
  ocupado: boolean;
  onGuardar: (metodo: MetodoPago, referencia: string) => void;
  onCancelar: () => void;
}) {
  const [metodo, setMetodo] = useState<MetodoPago>(
    metodos.includes(metodoActual as MetodoPago) ? (metodoActual as MetodoPago) : metodos[0]
  );
  const [referencia, setReferencia] = useState(referenciaActual ?? "");
  const regla = REFERENCIA_POR_METODO[metodo];
  const problema = referencia.trim() ? validarReferencia(metodo, referencia) : null;
  const queda = referencia.trim() ? normalizarReferencia(metodo, referencia) : "";

  return (
    <div className="rounded-xl border border-lila/35 bg-white/[0.05] p-3 flex flex-col gap-2.5">
      {metodos.length > 1 && (
        <label className="block text-xs font-medium text-noche-texto">
          Método
          <select
            value={metodo}
            onChange={(e) => setMetodo(e.target.value as MetodoPago)}
            className="mt-1 w-full h-11 rounded-md border border-white/15 bg-noche px-2 text-sm"
          >
            {metodos.map((m) => (
              <option key={m} value={m}>
                {ETIQUETA_METODO[m] ?? m}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-xs font-medium text-noche-texto">
        {regla.etiqueta}
        <input
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          inputMode={regla.teclado === "numeric" ? "numeric" : "text"}
          placeholder={regla.placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="mt-1 w-full h-11 rounded-md border border-white/15 px-3 text-sm font-mono"
        />
        <span className={`mt-1 block text-[11px] font-normal ${problema ? "text-amber-200" : "text-noche-tenue"}`}>
          {problema ?? (queda ? `Se guarda: ${queda}` : "Cópiala del comprobante")}
        </span>
      </label>
      <div className="grid grid-cols-[1.6fr_1fr] gap-2">
        <button
          type="button"
          disabled={ocupado || !queda || Boolean(problema)}
          onClick={() => onGuardar(metodo, referencia)}
          className="h-11 rounded-[12px] bg-violeta-hondo text-white text-sm font-semibold disabled:opacity-50"
        >
          {ocupado ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          disabled={ocupado}
          className="h-11 rounded-[12px] border border-white/15 bg-white/[0.05] text-sm font-semibold"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
