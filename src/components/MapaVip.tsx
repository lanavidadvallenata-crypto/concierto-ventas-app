"use client";

import { useState } from "react";
import type { MesaMapa, SillaMapa } from "@/lib/mapa-vip";

// Mesa agotada en ROJO (pedido del equipo, 19 sep): el gris se confundía con
// "deshabilitado / no cargó". Rojo = vendida completa, sin ambigüedad.
const COLOR_MESA: Record<"vacia" | "parcial" | "llena", string> = {
  vacia: "#3F6B4E",
  parcial: "#C9A24B",
  llena: "#CE0100",
};

function estadoAgregadoMesa(sillas: SillaMapa[]): "vacia" | "parcial" | "llena" {
  const disponibles = sillas.filter((s) => s.estado === "disponible").length;
  if (disponibles === 0) return "llena";
  if (disponibles === sillas.length) return "vacia";
  return "parcial";
}

export type SillaElegida = { id: string; numero: number; mesaNumero: number; fila: string };

// Selección múltiple: el comprador toca sillas para agregarlas y las vuelve a
// tocar para quitarlas, en la mesa que quiera, hasta `maximo`. La lista de
// elegidas se muestra debajo con una X por silla.
export default function MapaVip({
  mesas,
  seleccionadas,
  onCambiar,
  maximo = 10,
  cupoGeneralRestante,
}: {
  mesas: MesaMapa[];
  seleccionadas: SillaElegida[];
  onCambiar: (sillas: SillaElegida[]) => void;
  maximo?: number;
  cupoGeneralRestante?: number;
}) {
  const [mesaActivaId, setMesaActivaId] = useState<string | null>(null);

  const filas = [...new Set(mesas.map((m) => m.fila))].sort();
  const mesaActiva = mesas.find((m) => m.id === mesaActivaId) ?? null;
  const idsSeleccionados = new Set(seleccionadas.map((s) => s.id));
  const llena = seleccionadas.length >= maximo;

  function alternar(silla: SillaElegida) {
    if (idsSeleccionados.has(silla.id)) {
      onCambiar(seleccionadas.filter((s) => s.id !== silla.id));
    } else if (!llena) {
      onCambiar([...seleccionadas, silla]);
    }
  }

  return (
    <div className="flex flex-col gap-4 bg-white border border-neutral-200 rounded-xl p-3 sm:p-4">
      <div className="bg-neutral-900 text-white text-center text-xs font-semibold tracking-[0.2em] py-3 rounded-lg">
        TARIMA
      </div>

      <div className="flex flex-col gap-2.5">
        {filas.map((fila) => {
          const mesasFila = mesas.filter((m) => m.fila === fila).sort((a, b) => a.numero - b.numero);
          const izquierda = mesasFila.filter((m) => m.numero <= 5);
          const derecha = mesasFila.filter((m) => m.numero > 5);
          // Las 10 mesas de la fila se reparten en dos rejillas de 5 columnas
          // (una a cada lado del pasillo) y cada mesa ocupa el ancho de su
          // celda: así el mapa siempre cabe en el ancho del teléfono en vez de
          // desbordarse por la derecha (antes cada mesa medía 32px fijos y la
          // fila completa pedía más ancho del que hay en un móvil).
          return (
            <div key={fila} className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-[10px] sm:text-[11px] font-semibold text-neutral-400 w-2.5 sm:w-3 shrink-0">{fila}</span>
              <div className="flex-1 min-w-0 grid grid-cols-5 gap-1 sm:gap-1.5 justify-items-end">
                {izquierda.map((m) => (
                  <MesaBoton
                    key={m.id}
                    mesa={m}
                    activa={mesaActivaId === m.id}
                    conSeleccion={m.sillas.some((s) => idsSeleccionados.has(s.id))}
                    onClick={() => setMesaActivaId(mesaActivaId === m.id ? null : m.id)}
                  />
                ))}
              </div>
              <div className="w-2 sm:w-4 shrink-0 border-l border-dashed border-neutral-300 h-7 sm:h-8" />
              <div className="flex-1 min-w-0 grid grid-cols-5 gap-1 sm:gap-1.5 justify-items-start">
                {derecha.map((m) => (
                  <MesaBoton
                    key={m.id}
                    mesa={m}
                    activa={mesaActivaId === m.id}
                    conSeleccion={m.sillas.some((s) => idsSeleccionados.has(s.id))}
                    onClick={() => setMesaActivaId(mesaActivaId === m.id ? null : m.id)}
                  />
                ))}
              </div>
              <span className="hidden sm:block text-[11px] font-semibold text-neutral-400 w-3 shrink-0 text-right">{fila}</span>
            </div>
          );
        })}
      </div>

      <div className="bg-neutral-50 text-neutral-400 text-center text-[11px] font-medium py-5 rounded-lg border border-dashed border-neutral-300">
        ZONA GENERAL (sin asiento asignado)
        {typeof cupoGeneralRestante === "number" && (
          <span className="block mt-0.5">{cupoGeneralRestante} cupos disponibles</span>
        )}
      </div>

      {mesaActiva && (
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-sm font-semibold">
              Fila {mesaActiva.fila} · Mesa {mesaActiva.numero}
            </p>
            <p className="text-xs text-neutral-500">
              {seleccionadas.length}/{maximo} elegidas
            </p>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {[...mesaActiva.sillas]
              .sort((a, b) => a.numero - b.numero)
              .map((s) => {
                const seleccionada = idsSeleccionados.has(s.id);
                const disabled = (s.estado !== "disponible" && !seleccionada) || (llena && !seleccionada);
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={disabled}
                    aria-pressed={seleccionada}
                    onClick={() =>
                      alternar({ id: s.id, numero: s.numero, mesaNumero: mesaActiva.numero, fila: mesaActiva.fila })
                    }
                    className={`h-11 rounded-md text-sm font-semibold border ${
                      seleccionada
                        ? "bg-neutral-900 text-white border-neutral-900"
                        : disabled
                        ? "bg-neutral-100 text-neutral-300 border-neutral-200 cursor-not-allowed"
                        : "bg-white border-neutral-300 hover:border-neutral-900"
                    }`}
                  >
                    {s.numero}
                  </button>
                );
              })}
          </div>
          {llena && (
            <p className="text-[11px] text-amber-700 mt-2">Máximo {maximo} sillas por compra. Quita una para elegir otra.</p>
          )}
        </div>
      )}

      {seleccionadas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {seleccionadas.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => alternar(s)}
              title="Quitar"
              className="inline-flex items-center gap-1.5 bg-neutral-900 text-white rounded-full pl-3 pr-2 py-1 text-xs font-medium"
            >
              {s.fila}{s.mesaNumero} · S{s.numero}
              <span aria-hidden="true" className="text-white/70">×</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 text-[11px] text-neutral-500 flex-wrap">
        <Leyenda color={COLOR_MESA.vacia} texto="Mesa disponible" />
        <Leyenda color={COLOR_MESA.parcial} texto="Quedan pocas sillas" />
        <Leyenda color={COLOR_MESA.llena} texto="Mesa agotada" />
      </div>
    </div>
  );
}

function MesaBoton({
  mesa,
  activa,
  conSeleccion,
  onClick,
}: {
  mesa: MesaMapa;
  activa: boolean;
  conSeleccion: boolean;
  onClick: () => void;
}) {
  const estado = estadoAgregadoMesa(mesa.sillas);
  const disponibles = mesa.sillas.filter((s) => s.estado === "disponible").length;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={estado === "llena" && !conSeleccion}
      title={`Mesa ${mesa.numero} — ${disponibles} de ${mesa.sillas.length} disponibles`}
      className={`w-full max-w-9 aspect-square rounded-full text-[10px] sm:text-[11px] font-semibold text-white flex items-center justify-center border-2 transition-transform disabled:cursor-not-allowed ${
        activa ? "border-neutral-900 scale-110" : conSeleccion ? "border-neutral-900" : "border-transparent"
      } ${estado === "llena" ? "opacity-90" : ""}`}
      style={{ backgroundColor: COLOR_MESA[estado] }}
    >
      {mesa.numero}
    </button>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: color }} />
      {texto}
    </span>
  );
}
