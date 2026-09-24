"use client";

import { useState, useTransition } from "react";
import { registrarPatrocinio } from "./actions";
import MapaVip, { type SillaElegida } from "@/components/MapaVip";
import type { MesaMapa } from "@/lib/mapa-vip";
import { PAQUETES, type Paquete } from "@/lib/patrocinios";
import { metodosParaCanal, type MetodoPago, REFERENCIA_POR_METODO } from "@/lib/pagos";

const METODOS = metodosParaCanal("patrocinio");

export default function PatrocinioForm({ mesas }: { mesas: MesaMapa[] }) {
  const [paqueteId, setPaqueteId] = useState<Paquete>("oficial");
  const [sillas, setSillas] = useState<SillaElegida[]>([]);
  const [metodo, setMetodo] = useState<MetodoPago>("transferencia");
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [enviando, iniciar] = useTransition();

  const paquete = PAQUETES.find((p) => p.id === paqueteId)!;
  const esVip = paquete.tipo === "vip";
  const ref = REFERENCIA_POR_METODO[metodo];

  function enviar(formData: FormData) {
    setMensaje(null);
    if (esVip && sillas.length !== paquete.entradas) {
      setMensaje({ tipo: "error", texto: `Elige exactamente ${paquete.entradas} sillas en el mapa.` });
      return;
    }
    formData.set("sillaIds", JSON.stringify(sillas.map((s) => s.id)));
    iniciar(async () => {
      const r = await registrarPatrocinio(formData);
      if (r.ok) {
        setMensaje({ tipo: "ok", texto: r.aviso ?? "Patrocinio registrado." });
        setSillas([]);
        (document.getElementById("form-patrocinio") as HTMLFormElement | null)?.reset();
      } else {
        setMensaje({ tipo: "error", texto: r.error });
      }
    });
  }

  return (
    <form id="form-patrocinio" action={enviar} className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div>
        <h2 className="font-semibold">Registrar patrocinio</h2>
        <p className="text-sm text-neutral-500">
          Las entradas de cortesía se emiten de una vez: ocupan aforo real (no se puede vender esa silla otra vez) y
          salen por correo con su QR.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PAQUETES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setPaqueteId(p.id);
              setSillas([]);
            }}
            className={`text-left rounded-lg border p-3 min-h-[44px] ${
              paqueteId === p.id ? "border-[#3F0A62] bg-[#3F0A62]/5" : "border-neutral-200"
            }`}
          >
            <div className="font-semibold text-sm">{p.nombre}</div>
            <div className="text-xs text-neutral-500">US${p.monto} · {p.incluye}</div>
          </button>
        ))}
      </div>
      <input type="hidden" name="paquete" value={paqueteId} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm">
          Empresa o marca
          <input name="empresa" required className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11" />
        </label>
        <label className="text-sm">
          Persona de contacto
          <input name="contactoNombre" required className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11" />
        </label>
        <label className="text-sm">
          Teléfono
          <input name="contactoTelefono" inputMode="tel" className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11" />
        </label>
        <label className="text-sm">
          Correo <span className="text-neutral-400">(ahí llegan las entradas)</span>
          <input name="contactoEmail" type="email" required className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11" />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-sm">
          Monto pagado (US$)
          <input
            name="montoUsd"
            type="number"
            step="0.01"
            min="1"
            defaultValue={paquete.monto}
            key={paqueteId}
            required
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11"
          />
        </label>
        <label className="text-sm">
          Método de pago
          <select
            name="metodoPago"
            value={metodo}
            onChange={(e) => setMetodo(e.target.value as MetodoPago)}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11 bg-white"
          >
            {METODOS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {ref?.etiqueta ?? "Referencia"}
          <input
            name="referenciaPago"
            required
            inputMode={ref?.teclado === "numeric" ? "numeric" : "text"}
            placeholder={ref?.placeholder}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11"
          />
        </label>
      </div>

      {esVip && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">
            Elige {paquete.entradas} sillas ({sillas.length}/{paquete.entradas})
          </div>
          <MapaVip mesas={mesas} seleccionadas={sillas} onCambiar={setSillas} maximo={paquete.entradas} />
        </div>
      )}

      <label className="text-sm">
        Notas <span className="text-neutral-400">(opcional)</span>
        <textarea name="notas" rows={2} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2" />
      </label>

      {mensaje && (
        <p className={`text-sm rounded-lg px-3 py-2 ${mensaje.tipo === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
          {mensaje.texto}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="h-12 rounded-lg bg-[#3F0A62] text-white font-semibold disabled:opacity-60"
      >
        {enviando ? "Registrando…" : `Registrar patrocinio y emitir ${paquete.entradas} entradas`}
      </button>
    </form>
  );
}
