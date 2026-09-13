"use client";

import { useState, useTransition } from "react";
import { verificarPago, rechazarPago } from "./actions";

type Ticket = {
  id: string;
  compradorNombre: string;
  compradorTelefono: string;
  tipo: "vip" | "general";
  precio: number;
  moneda: string;
  metodoPago: string;
  referenciaPago: string | null;
  vendedorNombre: string;
  asiento: string | null;
};

export default function PendientesList({ tickets, miId }: { tickets: Ticket[]; miId: string }) {
  const [pending, startTransition] = useTransition();
  const [procesando, setProcesando] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});

  function accionar(id: string, accion: (id: string) => Promise<{ ok: boolean; error?: string }>) {
    setProcesando(id);
    startTransition(async () => {
      const res = await accion(id);
      if (!res.ok) {
        setErrores((prev) => ({ ...prev, [id]: res.error ?? "Error" }));
      }
      setProcesando(null);
    });
  }

  if (tickets.length === 0) {
    return <p className="text-sm text-neutral-400">No hay pagos pendientes por verificar.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {tickets.map((t) => (
        <div key={t.id} className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">{t.compradorNombre}</span>
            <span className="text-sm font-semibold tabular-nums">${t.precio.toFixed(2)} {t.moneda}</span>
          </div>
          <p className="text-xs text-neutral-500">
            {t.tipo === "vip" ? t.asiento : "General"} · {t.metodoPago.replace("_", " ")}
            {t.referenciaPago ? ` · ref. ${t.referenciaPago}` : ""}
          </p>
          <p className="text-xs text-neutral-400">
            Tel {t.compradorTelefono} · Vendido por {t.vendedorNombre}
            {t.vendedorNombre && ""}
          </p>

          {errores[t.id] && <p className="text-xs text-red-600">{errores[t.id]}</p>}

          <div className="flex gap-2 mt-1">
            <button
              onClick={() => accionar(t.id, verificarPago)}
              disabled={pending && procesando === t.id}
              className="flex-1 bg-green-700 text-white rounded-md py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {procesando === t.id ? "Procesando…" : "Verificar y enviar QR"}
            </button>
            <button
              onClick={() => accionar(t.id, rechazarPago)}
              disabled={pending && procesando === t.id}
              className="flex-1 border border-red-300 text-red-700 rounded-md py-1.5 text-sm font-medium disabled:opacity-50"
            >
              Rechazar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
