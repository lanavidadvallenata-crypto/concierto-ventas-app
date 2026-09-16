"use client";

import { useState } from "react";
import { cambiarRol, cambiarActivo } from "./actions";
import type { Rol } from "@/lib/perfil";

const ROLES: { valor: Rol; etiqueta: string }[] = [
  { valor: "acceso", etiqueta: "Acceso" },
  { valor: "ventas", etiqueta: "Ventas" },
  { valor: "finanzas", etiqueta: "Finanzas" },
  { valor: "admin", etiqueta: "Admin" },
];

type Fila = { id: string; nombre: string; email: string; rol: Rol; activo: boolean };

export default function PerfilesList({ perfiles, miId }: { perfiles: Fila[]; miId: string }) {
  const [filas, setFilas] = useState(perfiles);
  const [cargandoId, setCargandoId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<{ id: string; texto: string } | null>(null);

  async function onCambiarRol(id: string, nuevoRol: string) {
    setErrorId(null);
    setCargandoId(id);
    const res = await cambiarRol(id, nuevoRol);
    setCargandoId(null);
    if (!res.ok) {
      setErrorId({ id, texto: res.error });
      return;
    }
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, rol: nuevoRol as Rol } : f)));
  }

  async function onCambiarActivo(id: string, activo: boolean) {
    setErrorId(null);
    setCargandoId(id);
    const res = await cambiarActivo(id, activo);
    setCargandoId(null);
    if (!res.ok) {
      setErrorId({ id, texto: res.error });
      return;
    }
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, activo } : f)));
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200">
        <p className="text-sm font-semibold">Equipo ({filas.length})</p>
      </div>
      <div className="divide-y divide-neutral-100">
        {filas.map((f) => {
          const esYo = f.id === miId;
          const cargando = cargandoId === f.id;
          return (
            <div key={f.id} className="px-4 py-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {f.nombre} {esYo && <span className="text-neutral-400 font-normal">(tú)</span>}
                    {!f.activo && <span className="ml-2 text-[11px] text-red-600 font-normal">Desactivada</span>}
                  </p>
                  <p className="text-xs text-neutral-500 truncate">{f.email}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={f.rol}
                    disabled={esYo || cargando}
                    onChange={(e) => onCambiarRol(f.id, e.target.value)}
                    className="border border-neutral-300 rounded-md px-2 py-1.5 text-xs bg-white disabled:opacity-50 disabled:bg-neutral-50"
                  >
                    {ROLES.map((r) => (
                      <option key={r.valor} value={r.valor}>{r.etiqueta}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={esYo || cargando}
                    onClick={() => onCambiarActivo(f.id, !f.activo)}
                    className="border border-neutral-300 rounded-md px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {f.activo ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </div>
              {errorId?.id === f.id && <p className="text-xs text-red-600">{errorId.texto}</p>}
            </div>
          );
        })}
        {filas.length === 0 && (
          <p className="px-4 py-6 text-sm text-neutral-400 text-center">Todavía no hay cuentas creadas.</p>
        )}
      </div>
    </div>
  );
}
