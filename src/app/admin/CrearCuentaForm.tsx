"use client";

import { useState } from "react";
import { crearCuenta } from "./actions";

const ROLES: { valor: string; etiqueta: string }[] = [
  { valor: "acceso", etiqueta: "Acceso (escanear QR en la puerta)" },
  { valor: "ventas", etiqueta: "Ventas" },
  { valor: "finanzas", etiqueta: "Finanzas" },
  { valor: "admin", etiqueta: "Admin (control total)" },
];

function generarContrasena() {
  // Fácil de leer/dictar por teléfono a alguien parado en la puerta: sin
  // caracteres ambiguos (0/O, 1/l/I) y con separador visual.
  const alfabeto = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bloque = () =>
    Array.from({ length: 4 }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]).join("");
  return `${bloque()}-${bloque()}`;
}

export default function CrearCuentaForm() {
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [rol, setRol] = useState("acceso");
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMensaje(null);
    if (!nombre || !correo || !contrasena) return;
    setCargando(true);
    const res = await crearCuenta({ nombre, correo, contrasena, rol });
    setCargando(false);
    if (!res.ok) {
      setMensaje({ tipo: "error", texto: res.error });
      return;
    }
    setMensaje({
      tipo: "ok",
      texto: `Cuenta creada — pásale a ${nombre} el correo y esta contraseña: ${contrasena}`,
    });
    setNombre("");
    setCorreo("");
    setContrasena("");
    setRol("acceso");
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col gap-3">
      <p className="text-sm font-semibold">Nueva cuenta</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500" htmlFor="nombre">Nombre</label>
            <input
              id="nombre"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Carlos (puerta 1)"
              className="border border-neutral-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500" htmlFor="correo">Correo</label>
            <input
              id="correo"
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              placeholder="correo@ejemplo.com"
              className="border border-neutral-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500" htmlFor="rol">Rol</label>
            <select
              id="rol"
              value={rol}
              onChange={(e) => setRol(e.target.value)}
              className="border border-neutral-300 rounded-md px-3 py-2 text-sm bg-white"
            >
              {ROLES.map((r) => (
                <option key={r.valor} value={r.valor}>{r.etiqueta}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500" htmlFor="contrasena">Contraseña</label>
            <div className="flex gap-2">
              <input
                id="contrasena"
                type="text"
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="flex-1 border border-neutral-300 rounded-md px-3 py-2 text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setContrasena(generarContrasena())}
                className="shrink-0 border border-neutral-300 rounded-md px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-50"
              >
                Generar
              </button>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={cargando}
          className="self-start bg-neutral-900 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {cargando ? "Creando…" : "Crear cuenta"}
        </button>
      </form>
      {mensaje && (
        <p className={`text-xs ${mensaje.tipo === "error" ? "text-red-600" : "text-green-700"}`}>{mensaje.texto}</p>
      )}
      <p className="text-[11px] text-neutral-400">
        No hay correo de bienvenida automático — copia la contraseña de arriba y pásasela tú directamente (WhatsApp,
        de palabra) a la persona.
      </p>
    </div>
  );
}
