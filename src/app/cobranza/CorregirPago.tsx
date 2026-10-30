"use client";

import { useState } from "react";
import { ETIQUETA_METODO, METODOS_EN_BS, formatoBs, formatoUsd, parsearMontoBs } from "@/lib/formato";
import { bsParaEscribir, montoNoCuadra } from "@/lib/correccion-pago";

// Corregir un pago mal anotado sin rechazarlo (Anita, 30 oct). Se abre dentro
// de la tarjeta con lo que dice hoy el pago; se cambia lo que esté mal y el
// pago sigue donde estaba (por confirmar o confirmado).

const METODOS = ["pago_movil", "transferencia", "zelle", "binance", "efectivo_usd", "efectivo_bs"] as const;
type Metodo = (typeof METODOS)[number];

export type DatosCorregidos = { cuotaId: string; metodoPago: Metodo; referenciaPago: string; montoBs: number | null };

export default function CorregirPago({
  cuotaId,
  etiqueta,
  inicial,
  usdDelPago,
  tasa,
  confirmado,
  ocupado,
  onGuardar,
  onCancelar,
}: {
  cuotaId: string;
  /** "Cuota 01" o "Inicial y Cuota 01": lo que cubre este pago. */
  etiqueta: string;
  inicial: { metodoPago: string | null; referenciaPago: string | null; montoBs: number | null };
  /** Lo que vale en dólares todo lo que cubre este pago. */
  usdDelPago: number;
  /** Tasa para comparar (la del pago, o la de hoy). */
  tasa: number | null;
  confirmado: boolean;
  ocupado: boolean;
  onGuardar: (d: DatosCorregidos) => void;
  onCancelar: () => void;
}) {
  const metodoInicial = (METODOS as readonly string[]).includes(inicial.metodoPago ?? "") ? (inicial.metodoPago as Metodo) : "pago_movil";
  const [metodo, setMetodo] = useState<Metodo>(metodoInicial);
  const [referencia, setReferencia] = useState(inicial.referenciaPago ?? "");
  const [monto, setMonto] = useState(inicial.montoBs != null ? bsParaEscribir(inicial.montoBs) : "");

  const enBs = METODOS_EN_BS.has(metodo);
  const leido = enBs ? parsearMontoBs(monto) : null;
  const noCuadra = enBs ? montoNoCuadra(leido, usdDelPago, tasa) : null;
  const esperado = tasa ? Math.round(usdDelPago * tasa * 100) / 100 : null;
  const listo = referencia.trim().length > 0 && (!enBs || (leido != null && leido > 0));

  return (
    <div className="rounded-lg border border-lila/35 bg-white/[0.05] px-3 py-2.5 space-y-2.5 w-full">
      <p className="text-xs text-noche-texto">
        Corregir el pago de <strong>{etiqueta}</strong> ({formatoUsd(usdDelPago)}).{" "}
        {confirmado ? "Ya está confirmado: el cambio queda registrado a tu nombre." : "Sigue por confirmar después de guardar."}
      </p>

      <label className="block text-xs font-medium text-noche-texto">
        Método
        <select
          value={metodo}
          onChange={(e) => setMetodo(e.target.value as Metodo)}
          className="mt-1 w-full h-11 rounded-md border border-white/15 bg-noche px-2 text-sm"
        >
          {METODOS.map((m) => (
            <option key={m} value={m}>
              {ETIQUETA_METODO[m] ?? m}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs font-medium text-noche-texto">
        Referencia
        <input
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="mt-1 w-full h-11 rounded-md border border-white/15 px-3 text-sm font-mono"
        />
      </label>

      {enBs && (
        <label className="block text-xs font-medium text-noche-texto">
          Monto del comprobante en Bs
          <input
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder={esperado != null ? bsParaEscribir(esperado) : "Ej: 20.848,80"}
            className="mt-1 w-full h-11 rounded-md border border-white/15 px-3 text-sm tabular-nums"
          />
          <span className="mt-1 block text-[11px] font-normal text-noche-tenue tabular-nums">
            {leido != null ? `Se guarda: ${formatoBs(leido)}` : "Escríbelo como en el comprobante"}
            {esperado != null ? ` · corresponde ≈ ${formatoBs(esperado)}` : ""}
          </span>
        </label>
      )}

      {noCuadra && (
        <p className="text-xs rounded-md bg-amber-400/10 border border-amber-300/30 text-amber-100 px-2 py-1.5">
          Ojo: {formatoBs(leido!)} son ≈ {formatoUsd(noCuadra.usdEquivalente)} y este pago es de {formatoUsd(usdDelPago)}. Revisa la coma antes de guardar.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!listo || ocupado}
          onClick={() => onGuardar({ cuotaId, metodoPago: metodo, referenciaPago: referencia.trim(), montoBs: enBs ? leido : null })}
          className="h-11 px-3 rounded-lg bg-violeta-hondo text-white text-sm font-semibold disabled:opacity-50"
        >
          {ocupado ? "Guardando…" : "Guardar corrección"}
        </button>
        <button type="button" onClick={onCancelar} disabled={ocupado} className="h-11 px-3 rounded-lg border border-white/15 bg-white/[0.05] text-sm font-semibold">
          Cancelar
        </button>
      </div>
    </div>
  );
}
