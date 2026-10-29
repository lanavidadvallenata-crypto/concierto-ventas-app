"use client";

import { useState, type ReactNode } from "react";

// Pestañas del Dashboard (Anita, 29 oct: "demasiado texto, el choricero pa
// abajo"). Cada vista cabe en una pantalla del teléfono y se cambia al
// instante, sin recargar. La pestaña queda en la dirección (?v=) para que el
// refresco automático y los filtros la conserven.

export type Pestana = { id: string; etiqueta: string; contenido: ReactNode; alerta?: boolean };

export default function Pestanas({ pestanas, inicial }: { pestanas: Pestana[]; inicial: string }) {
  const [activa, setActiva] = useState(pestanas.some((p) => p.id === inicial) ? inicial : pestanas[0].id);

  function elegir(id: string) {
    setActiva(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("v", id);
      window.history.replaceState(null, "", url);
    } catch {
      // Sin dirección actualizada la pestaña igual cambia.
    }
  }

  const actual = pestanas.find((p) => p.id === activa) ?? pestanas[0];
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Vistas del dashboard" className="grid gap-1 rounded-2xl bg-white/[0.05] border border-white/10 p-1" style={{ gridTemplateColumns: `repeat(${pestanas.length}, minmax(0, 1fr))` }}>
        {pestanas.map((p) => {
          const sel = p.id === actual.id;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={sel}
              aria-controls={`vista-${p.id}`}
              onClick={() => elegir(p.id)}
              className={`relative h-10 rounded-xl text-[13px] font-semibold transition-colors ${
                sel ? "bg-violeta-hondo text-white shadow-[0_6px_18px_rgba(123,44,191,0.45)]" : "text-noche-suave"
              }`}
            >
              {p.etiqueta}
              {p.alerta && !sel && <span aria-hidden="true" className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`vista-${actual.id}`} className="flex flex-col gap-4">
        {actual.contenido}
      </div>
    </div>
  );
}
