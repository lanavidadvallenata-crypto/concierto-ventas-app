"use client";

import { useState, useTransition } from "react";
import { anularPatrocinio } from "./actions";
import { PAQUETES } from "@/lib/patrocinios";
import { ETIQUETA_METODO } from "@/lib/formato";

export type FilaPatrocinante = {
  id: string;
  empresa: string;
  contactoNombre: string;
  contactoEmail: string;
  paquete: string;
  montoUsd: number;
  metodoPago: string;
  referenciaPago: string | null;
  creadoEn: string;
  anulado: boolean;
  entradas: number;
  asientos: string[];
};

export default function ListaPatrocinantes({ filas }: { filas: FilaPatrocinante[] }) {
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [anulando, iniciar] = useTransition();
  const [confirmando, setConfirmando] = useState<string | null>(null);

  if (filas.length === 0) {
    return (
      <p className="text-sm text-neutral-500 rounded-xl border border-dashed border-neutral-300 p-4">
        Todavía no hay patrocinios registrados.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {mensaje && <p className="text-sm rounded-lg bg-neutral-100 px-3 py-2">{mensaje}</p>}
      {filas.map((f) => {
        const paquete = PAQUETES.find((p) => p.id === f.paquete);
        return (
          <div
            key={f.id}
            className={`rounded-xl border p-4 flex flex-col gap-2 ${f.anulado ? "border-neutral-200 bg-neutral-50 opacity-70" : "border-neutral-200 bg-white"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">{f.empresa}</div>
                <div className="text-sm text-neutral-500 truncate">
                  {f.contactoNombre} · {f.contactoEmail}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-semibold">${f.montoUsd.toFixed(2)}</div>
                <div className="text-xs text-neutral-500">{paquete?.nombre ?? f.paquete}</div>
              </div>
            </div>

            <div className="text-sm text-neutral-600 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                {f.entradas} {f.entradas === 1 ? "entrada" : "entradas"}
                {f.asientos.length > 0 && <> · {f.asientos.join(" · ")}</>}
              </span>
              <span>
                {ETIQUETA_METODO[f.metodoPago] ?? f.metodoPago}
                {f.referenciaPago && <> · ref. {f.referenciaPago}</>}
              </span>
              <span className="text-neutral-400">{new Date(f.creadoEn).toLocaleString("es-VE", { timeZone: "America/Caracas" })}</span>
            </div>

            {f.anulado ? (
              <div className="text-sm font-medium text-neutral-500">Anulado — entradas sin efecto</div>
            ) : confirmando === f.id ? (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-sm text-red-700">¿Anular? Las entradas dejan de servir y las sillas se liberan.</span>
                <form
                  action={(fd) => {
                    fd.set("id", f.id);
                    iniciar(async () => {
                      const r = await anularPatrocinio(fd);
                      setMensaje(r.ok ? (r.aviso ?? "Anulado.") : r.error);
                      setConfirmando(null);
                    });
                  }}
                >
                  <button type="submit" disabled={anulando} className="h-11 px-4 rounded-lg bg-red-600 text-white text-sm font-semibold">
                    Sí, anular
                  </button>
                </form>
                <button type="button" onClick={() => setConfirmando(null)} className="h-11 px-3 text-sm text-neutral-600">
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmando(f.id)}
                className="self-start h-11 px-3 text-sm text-red-700 border border-red-200 rounded-lg"
              >
                Anular patrocinio
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
