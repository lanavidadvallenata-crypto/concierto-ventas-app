"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MapaVip, { type SillaElegida } from "@/components/MapaVip";
import type { MesaMapa } from "@/lib/mapa-vip";
import { calcularTotal, MAX_POR_COMPRA } from "@/lib/precios";
import { convertirABs } from "@/lib/tasa";
import { metodoEsEnBs, metodosParaCanal, type MetodoPago } from "@/lib/pagos";
import { registrarVentaTaquilla } from "./actions";

// En taquilla solo tiene sentido lo que se cobra ahí mismo. Orden: efectivo primero.
const METODOS = [...metodosParaCanal("taquilla")].sort((a, b) => {
  const peso = (m: MetodoPago) => (m === "efectivo_usd" ? 0 : m === "efectivo_bs" ? 1 : 2);
  return peso(a.valor) - peso(b.valor);
});

export default function TaquillaForm({
  mesas,
  cupoGeneralRestante,
  tasaEurVes,
}: {
  mesas: MesaMapa[];
  cupoGeneralRestante: number;
  tasaEurVes: number | null;
}) {
  const router = useRouter();
  const [tipo, setTipo] = useState<"vip" | "general">("general");
  const [sillas, setSillas] = useState<SillaElegida[]>([]);
  const [cantidad, setCantidad] = useState(1);
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("efectivo_usd");
  const [precioManual, setPrecioManual] = useState<number | null>(null);
  // Monto en bolívares escrito por el vendedor (métodos en Bs).
  const [montoBsManual, setMontoBsManual] = useState<number | null>(null);
  const [referencia, setReferencia] = useState("");
  const [boleto, setBoleto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const n = tipo === "vip" ? sillas.length : cantidad;
  // Precio de taquilla = el mismo de la web (Anita, 25 sep): $140 VIP /
  // $30 General, precio final. Un solo precio en todos los canales.
  const unitario = calcularTotal(tipo).total;
  const sugerido = Math.round(n * unitario * 100) / 100;

  // Métodos en bolívares: el vendedor escribe lo que cobró en Bs y se muestra
  // el equivalente en USD. El resto: en USD.
  const enBs = metodoEsEnBs(metodoPago) && tasaEurVes !== null;
  const sugeridoBs = enBs && tasaEurVes ? convertirABs(sugerido, tasaEurVes) : null;
  const montoBs = enBs ? montoBsManual ?? sugeridoBs : null;
  const precio = enBs && montoBs != null && tasaEurVes ? Math.round((montoBs / tasaEurVes) * 100) / 100 : precioManual ?? sugerido;
  const precioEditado = enBs ? montoBsManual !== null : precioManual !== null;
  const esEfectivo = metodoPago === "efectivo_usd" || metodoPago === "efectivo_bs";
  const fmtBs = (x: number) => x.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function reiniciarMonto() {
    setPrecioManual(null);
    setMontoBsManual(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMensaje(null);
    if (n === 0) {
      setMensaje({ tipo: "error", texto: tipo === "vip" ? "Elige las sillas en el mapa." : "Indica la cantidad." });
      return;
    }
    if (!(precio > 0) || (enBs && !(montoBs && montoBs > 0))) {
      setMensaje({ tipo: "error", texto: "Escribe el monto cobrado." });
      return;
    }
    setCargando(true);
    const res = await registrarVentaTaquilla({
      tipo,
      sillaIds: tipo === "vip" ? sillas.map((s) => s.id) : undefined,
      cantidad: tipo === "general" ? cantidad : undefined,
      metodoPago,
      precioTotal: enBs ? undefined : precio,
      montoBs: enBs && montoBs != null ? montoBs : undefined,
      precioEditado,
      referenciaPago: referencia,
      boletoFisico: boleto,
    });
    setCargando(false);
    if (!res.ok) {
      setMensaje({ tipo: "error", texto: res.error });
      return;
    }
    setMensaje({
      tipo: "ok",
      texto: `Vendida${res.cantidad === 1 ? "" : "s"}: ${res.cantidad} ${tipo === "vip" ? "VIP" : "General"} por $${res.total.toFixed(2)}${
        res.totalBs != null ? ` (Bs ${res.totalBs.toLocaleString("es-VE", { minimumFractionDigits: 2 })})` : ""
      }. Entrega el boleto físico.`,
    });
    setSillas([]);
    setCantidad(1);
    setReferencia("");
    setBoleto("");
    reiniciarMonto();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex gap-2">
        {(["general", "vip"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTipo(t);
              reiniciarMonto();
              if (t === "general") setSillas([]);
            }}
            className={`flex-1 h-12 rounded-md text-base font-semibold border ${
              tipo === t ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-300 text-neutral-600"
            }`}
          >
            {t === "vip" ? `VIP · $${calcularTotal("vip").total}` : `General · $${calcularTotal("general").total}`}
          </button>
        ))}
      </div>

      {tipo === "vip" ? (
        <MapaVip
          mesas={mesas}
          seleccionadas={sillas}
          onCambiar={(s) => {
            setSillas(s);
            reiniciarMonto();
          }}
          maximo={MAX_POR_COMPRA.vip}
          cupoGeneralRestante={cupoGeneralRestante}
        />
      ) : (
        <div>
          <label className="block text-sm font-medium mb-1">Cantidad</label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { setCantidad((c) => Math.max(1, c - 1)); reiniciarMonto(); }} className="w-12 h-12 rounded-md border border-neutral-300 text-xl font-semibold" aria-label="Menos">−</button>
            <input
              type="number"
              min={1}
              max={MAX_POR_COMPRA.general}
              value={cantidad}
              onChange={(e) => { setCantidad(Math.max(1, Math.min(MAX_POR_COMPRA.general, Number(e.target.value) || 1))); reiniciarMonto(); }}
              className="w-20 h-12 text-center border border-neutral-300 rounded-md text-xl font-semibold"
            />
            <button type="button" onClick={() => { setCantidad((c) => Math.min(MAX_POR_COMPRA.general, c + 1)); reiniciarMonto(); }} className="w-12 h-12 rounded-md border border-neutral-300 text-xl font-semibold" aria-label="Más">+</button>
            {[2, 4, 6].map((q) => (
              <button key={q} type="button" onClick={() => { setCantidad(q); reiniciarMonto(); }} className="h-12 px-3 rounded-md border border-neutral-300 text-sm font-medium text-neutral-600">
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Método de pago</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {METODOS.map((m) => (
            <button
              key={m.valor}
              type="button"
              disabled={!m.activo}
              onClick={() => {
                setMetodoPago(m.valor);
                reiniciarMonto();
              }}
              className={`h-12 rounded-md text-sm font-medium border px-2 disabled:opacity-40 ${
                metodoPago === m.valor ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-300 text-neutral-700"
              }`}
            >
              {m.etiqueta}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {enBs ? (
          <div>
            <label className="block text-sm font-medium mb-1">Total cobrado (Bs)</label>
            <input
              type="number"
              step="0.01"
              min={0.01}
              inputMode="decimal"
              value={montoBs ?? ""}
              onChange={(e) => setMontoBsManual(Number(e.target.value))}
              className="w-full h-12 border border-neutral-300 rounded-md px-3 text-lg font-semibold tabular-nums"
            />
            <p className="text-xs text-neutral-500 mt-1 tabular-nums">
              {n > 0 && sugeridoBs != null
                ? `${n} × $${unitario.toFixed(2)} = $${sugerido.toFixed(2)} → Bs ${fmtBs(sugeridoBs)} (tasa ${fmtBs(tasaEurVes!)})`
                : "Elige las entradas"}
              {precioEditado && (
                <button type="button" onClick={reiniciarMonto} className="ml-2 underline">
                  usar sugerido
                </button>
              )}
            </p>
            <p className="text-sm font-medium text-neutral-800 mt-1 tabular-nums">Equivale a ${precio.toFixed(2)}</p>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-1">Total cobrado (USD)</label>
            <input
              type="number"
              step="0.01"
              min={0.01}
              inputMode="decimal"
              value={precio}
              onChange={(e) => setPrecioManual(Number(e.target.value))}
              className="w-full h-12 border border-neutral-300 rounded-md px-3 text-lg font-semibold tabular-nums"
            />
            <p className="text-xs text-neutral-500 mt-1">
              {n > 0 ? `${n} × $${unitario.toFixed(2)} = $${sugerido.toFixed(2)}` : "Elige las entradas"}
              {precioEditado && (
                <button type="button" onClick={reiniciarMonto} className="ml-2 underline">
                  usar sugerido
                </button>
              )}
            </p>
            {metodoEsEnBs(metodoPago) && tasaEurVes === null && (
              <p className="text-sm font-medium text-amber-800 mt-1">Tasa del día no disponible: cobra y registra en USD.</p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-3">
          {!esEfectivo && (
            <div>
              <label className="block text-sm font-medium mb-1">Referencia del pago</label>
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className="w-full h-12 border border-neutral-300 rounded-md px-3 text-sm" placeholder="Nº de confirmación" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Nº de boleto físico <span className="text-neutral-400 font-normal">(opcional)</span></label>
            <input value={boleto} onChange={(e) => setBoleto(e.target.value)} className="w-full h-12 border border-neutral-300 rounded-md px-3 text-sm" placeholder="Ej: 0041-0044" />
          </div>
        </div>
      </div>

      {mensaje && (
        <div
          role={mensaje.tipo === "ok" ? "status" : "alert"}
          className={`rounded-lg border px-3 py-3 text-base font-medium ${
            mensaje.tipo === "ok" ? "bg-green-50 border-green-300 text-green-800" : "bg-red-50 border-red-300 text-red-800"
          }`}
        >
          {mensaje.texto}
        </div>
      )}

      <button
        type="submit"
        disabled={cargando || n === 0}
        className="h-14 bg-green-700 hover:bg-green-800 text-white rounded-lg text-base font-semibold disabled:opacity-50"
      >
        {cargando
          ? "Registrando…"
          : n > 0
          ? `Cobrar ${enBs && montoBs != null ? `Bs ${fmtBs(montoBs)}` : `$${precio.toFixed(2)}`} — ${n} ${tipo === "vip" ? "VIP" : "General"}`
          : "Registrar venta"}
      </button>
    </form>
  );
}
