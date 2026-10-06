"use client";

import { useState, useTransition } from "react";
import { registrarCortesia } from "./actions";
import MapaVip, { type SillaElegida } from "@/components/MapaVip";
import type { MesaMapa } from "@/lib/mapa-vip";
import { MOTIVOS, type Motivo } from "@/lib/cortesias";

// Cortesías: entradas que ocupan aforo real pero no son dinero. Se puede dar
// VIP, general o las dos en el mismo registro — Anita pidió poder mezclar.
export default function CortesiaForm({ mesas }: { mesas: MesaMapa[] }) {
  const [motivo, setMotivo] = useState<Motivo>("canje");
  const [cantidadVip, setCantidadVip] = useState(0);
  const [cantidadGeneral, setCantidadGeneral] = useState(0);
  const [sillas, setSillas] = useState<SillaElegida[]>([]);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [enviando, iniciar] = useTransition();

  const ayuda = MOTIVOS.find((m) => m.id === motivo)?.ayuda ?? "";
  const total = cantidadVip + cantidadGeneral;

  function enviar(formData: FormData) {
    setMensaje(null);
    if (total < 1) {
      setMensaje({ tipo: "error", texto: "Indica al menos una entrada, VIP o general." });
      return;
    }
    if (cantidadVip > 0 && sillas.length !== cantidadVip) {
      setMensaje({ tipo: "error", texto: `Elige exactamente ${cantidadVip} silla${cantidadVip === 1 ? "" : "s"} en el mapa.` });
      return;
    }
    formData.set("sillaIds", JSON.stringify(sillas.map((s) => s.id)));
    iniciar(async () => {
      const r = await registrarCortesia(formData);
      if (r.ok) {
        setMensaje({ tipo: "ok", texto: r.aviso ?? "Cortesía registrada." });
        setSillas([]);
        setCantidadVip(0);
        setCantidadGeneral(0);
        (document.getElementById("form-cortesia") as HTMLFormElement | null)?.reset();
      } else {
        setMensaje({ tipo: "error", texto: r.error });
      }
    });
  }

  return (
    <form id="form-cortesia" action={enviar} className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div>
        <h2 className="font-semibold">Registrar cortesía</h2>
        <p className="text-sm text-neutral-500">
          Entradas que no se cobran: canje, sorteo, prensa, staff, invitación. Ocupan aforo real y salen con su QR, pero
          no suman nada a la recaudación ni aparecen como patrocinio.
        </p>
      </div>

      <label className="text-sm">
        Motivo
        <select
          name="motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value as Motivo)}
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11 bg-white"
        >
          {MOTIVOS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </select>
        <span className="block text-xs text-neutral-400 mt-1">{ayuda}</span>
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm">
          A nombre de
          <input
            name="beneficiario"
            required
            placeholder="Persona, marca o cuenta"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11"
          />
        </label>
        <label className="text-sm">
          Correo <span className="text-neutral-400">(ahí llegan las entradas)</span>
          <input name="contactoEmail" type="email" required className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11" />
        </label>
        <label className="text-sm">
          Teléfono <span className="text-neutral-400">(opcional)</span>
          <input name="contactoTelefono" inputMode="tel" className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11" />
        </label>
        <label className="text-sm">
          A cambio de qué <span className="text-neutral-400">(queda en el registro)</span>
          <input
            name="detalle"
            placeholder="Ej.: 3 reels en IG · ganadora sorteo 5 oct"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          Entradas VIP
          <input
            name="cantidadVip"
            type="number"
            min="0"
            max="10"
            value={cantidadVip}
            onChange={(e) => {
              const n = Math.max(0, Math.min(10, Number(e.target.value) || 0));
              setCantidadVip(n);
              if (n === 0) setSillas([]);
              else if (sillas.length > n) setSillas(sillas.slice(0, n));
            }}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11 tabular-nums"
          />
        </label>
        <label className="text-sm">
          Entradas generales
          <input
            name="cantidadGeneral"
            type="number"
            min="0"
            max="20"
            value={cantidadGeneral}
            onChange={(e) => setCantidadGeneral(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 h-11 tabular-nums"
          />
        </label>
      </div>
      <p className="text-xs text-neutral-400 -mt-2">
        Puedes dar solo VIP, solo generales o las dos cosas en el mismo registro.
      </p>

      {cantidadVip > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">
            Elige {cantidadVip} silla{cantidadVip === 1 ? "" : "s"} ({sillas.length}/{cantidadVip})
          </div>
          <MapaVip mesas={mesas} seleccionadas={sillas} onCambiar={setSillas} maximo={cantidadVip} />
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
        disabled={enviando || total < 1}
        className="h-12 rounded-lg bg-[#3F0A62] text-white font-semibold disabled:opacity-60"
      >
        {enviando ? "Registrando…" : total < 1 ? "Indica cuántas entradas" : `Emitir ${total} entrada${total === 1 ? "" : "s"} de cortesía`}
      </button>
    </form>
  );
}
