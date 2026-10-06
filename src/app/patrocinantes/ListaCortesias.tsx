"use client";

import { useState, useTransition } from "react";
import { anularCortesia } from "./actions";
import { nombreMotivo } from "@/lib/cortesias";
import { horaCaracas } from "@/lib/formato";

export type FilaCortesia = {
  id: string;
  beneficiario: string;
  motivo: string;
  detalle: string | null;
  contactoEmail: string;
  cantidadVip: number;
  cantidadGeneral: number;
  asientos: string[];
  entradasVivas: number;
  creadoEn: string;
  anulado: boolean;
};

export default function ListaCortesias({ filas }: { filas: FilaCortesia[] }) {
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();

  if (filas.length === 0) {
    return (
      <p className="text-sm text-neutral-500 rounded-xl border border-neutral-200 bg-white p-4">
        Todavía no hay cortesías registradas.
      </p>
    );
  }

  const vivas = filas.filter((f) => !f.anulado);
  const totalEntradas = vivas.reduce((s, f) => s + f.entradasVivas, 0);

  function anular(id: string) {
    setMensaje(null);
    const fd = new FormData();
    fd.set("id", id);
    iniciar(async () => {
      const r = await anularCortesia(fd);
      setMensaje(r.ok ? (r.aviso ?? "Cortesía anulada.") : r.error);
      setConfirmando(null);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-500">
        {vivas.length} cortesía{vivas.length === 1 ? "" : "s"} activa{vivas.length === 1 ? "" : "s"} · {totalEntradas}{" "}
        entrada{totalEntradas === 1 ? "" : "s"} ocupando aforo · $0 en recaudación
      </p>

      {mensaje && <p className="text-sm rounded-lg bg-neutral-100 px-3 py-2">{mensaje}</p>}

      <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100 overflow-hidden">
        {filas.map((f) => (
          <div key={f.id} className={`px-4 py-3 flex flex-col gap-1 ${f.anulado ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{f.beneficiario}</p>
                <p className="text-xs text-neutral-400 truncate">{f.contactoEmail}</p>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-neutral-100 text-neutral-600 rounded-full px-2 py-0.5 shrink-0">
                {nombreMotivo(f.motivo)}
              </span>
            </div>

            <p className="text-xs text-neutral-500">
              {f.cantidadVip > 0 && `${f.cantidadVip} VIP`}
              {f.cantidadVip > 0 && f.cantidadGeneral > 0 && " · "}
              {f.cantidadGeneral > 0 && `${f.cantidadGeneral} General`}
              {f.detalle ? ` · ${f.detalle}` : ""}
            </p>

            {f.asientos.length > 0 && <p className="text-xs text-neutral-400">{f.asientos.join(" · ")}</p>}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-neutral-400">{horaCaracas(f.creadoEn)}</span>
              {f.anulado ? (
                <span className="font-semibold text-neutral-500">Anulada</span>
              ) : confirmando === f.id ? (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={enviando}
                    onClick={() => anular(f.id)}
                    className="rounded-md bg-red-600 text-white px-3 py-1 font-semibold disabled:opacity-60"
                  >
                    {enviando ? "Anulando…" : "Sí, anular"}
                  </button>
                  <button type="button" onClick={() => setConfirmando(null)} className="text-neutral-500 underline">
                    Cancelar
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmando(f.id)} className="text-red-600 underline">
                  Anular cortesía
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
