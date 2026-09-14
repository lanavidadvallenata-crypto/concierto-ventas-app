"use client";

import { useState } from "react";
import type { MesaMapa, SillaMapa } from "@/lib/mapa-vip";

const COLOR_MESA: Record<"vacia" | "parcial" | "llena", string> = {
  vacia: "#3F6B4E",
  parcial: "#C9A24B",
  llena: "#B0A99A",
};

function estadoAgregadoMesa(sillas: SillaMapa[]): "vacia" | "parcial" | "llena" {
  const disponibles = sillas.filter((s) => s.estado === "disponible").length;
  if (disponibles === 0) return "llena";
  if (disponibles === sillas.length) return "vacia";
  return "parcial";
}

export type SillaElegida = { id: string; numero: number; mesaNumero: number; fila: string };

export default function MapaVip({
  mesas,
  onSeleccionar,
  sillaSeleccionadaId,
}: {
  mesas: MesaMapa[];
  onSeleccionar: (silla: SillaElegida) => void;
  sillaSeleccionadaId?: string | null;
}) {
  const [mesaActivaId, setMesaActivaId] = useState<string | null>(null);

  const filas = [...new Set(mesas.map((m) => m.fila))].sort();
  const mesaActiva = mesas.find((m) => m.id === mesaActivaId) ?? null;

  return (
    <div className="flex flex-col gap-4 bg-white border border-neutral-200 rounded-xl p-4">
      <div className="bg-neutral-900 text-white text-center text-xs font-semibold tracking-[0.2em] py-3 rounded-lg">
        TARIMA
      </div>

      <div className="flex flex-col gap-2.5">
        {filas.map((fila) => {
          const mesasFila = mesas.filter((m) => m.fila === fila).sort((a, b) => a.numero - b.numero);
          const izquierda = mesasFila.filter((m) => m.numero <= 5);
          const derecha = mesasFila.filter((m) => m.numero > 5);
          return (
            <div key={fila} className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-neutral-400 w-3 shrink-0">{fila}</span>
              <div className="flex-1 flex justify-end gap-1.5">
                {izquierda.map((m) => (
                  <MesaBoton
                    key={m.id}
                    mesa={m}
                    activa={mesaActivaId === m.id}
                    onClick={() => setMesaActivaId(mesaActivaId === m.id ? null : m.id)}
                  />
                ))}
              </div>
              <div className="w-5 shrink-0 border-l border-dashed border-neutral-300 h-8" />
              <div className="flex-1 flex justify-start gap-1.5">
                {derecha.map((m) => (
                  <MesaBoton
                    key={m.id}
                    mesa={m}
                    activa={mesaActivaId === m.id}
                    onClick={() => setMesaActivaId(mesaActivaId === m.id ? null : m.id)}
                  />
                ))}
              </div>
              <span className="text-[11px] font-semibold text-neutral-400 w-3 shrink-0 text-right">{fila}</span>
            </div>
          );
        })}
      </div>

      <div className="bg-neutral-50 text-neutral-400 text-center text-[11px] font-medium py-5 rounded-lg border border-dashed border-neutral-300">
        ZONA GENERAL (sin asiento asignado)
      </div>

      {mesaActiva && (
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3">
          <p className="text-sm font-semibold mb-2.5">
            Fila {mesaActiva.fila} · Mesa {mesaActiva.numero} — elige tu silla
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {[...mesaActiva.sillas]
              .sort((a, b) => a.numero - b.numero)
              .map((s) => {
                const seleccionada = s.id === sillaSeleccionadaId;
                const disabled = s.estado !== "disponible" && !seleccionada;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onSeleccionar({ id: s.id, numero: s.numero, mesaNumero: mesaActiva.numero, fila: mesaActiva.fila })
                    }
                    className={`h-9 rounded-md text-xs font-medium border ${
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

function MesaBoton({ mesa, activa, onClick }: { mesa: MesaMapa; activa: boolean; onClick: () => void }) {
  const estado = estadoAgregadoMesa(mesa.sillas);
  const disponibles = mesa.sillas.filter((s) => s.estado === "disponible").length;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={estado === "llena"}
      title={`Mesa ${mesa.numero} — ${disponibles} de ${mesa.sillas.length} disponibles`}
      className={`w-8 h-8 rounded-full text-[10px] font-semibold text-white flex items-center justify-center border-2 shrink-0 transition-transform disabled:opacity-40 disabled:cursor-not-allowed ${
        activa ? "border-neutral-900 scale-110" : "border-transparent"
      }`}
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
