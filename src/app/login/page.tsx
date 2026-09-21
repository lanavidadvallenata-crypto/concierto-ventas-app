"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setCargando(false);
    if (error) {
      setError(
        error.message.toLowerCase().includes("rate")
          ? "Demasiados intentos — espera un minuto y vuelve a intentar."
          : "Correo o contraseña incorrectos."
      );
      return;
    }
    // Solo rutas internas: ?next= viene de la URL y sin esto se podía usar
    // para mandar a alguien del equipo a un sitio externo después de loguearse.
    // Solo rutas internas. Se resuelve contra el origen actual: "/\\evil.com" o
    // "//evil.com" terminan en otro dominio y se descartan.
    let destino = "/ventas";
    try {
      const u = new URL(params.get("next") ?? "", window.location.origin);
      if (u.origin === window.location.origin && u.pathname.startsWith("/") && u.pathname !== "/login") {
        destino = u.pathname + u.search;
      }
    } catch {
      destino = "/ventas";
    }
    router.push(destino);
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white border border-neutral-200 rounded-xl p-6 shadow-sm"
      >
        <h1 className="text-lg font-semibold mb-1">La Navidad Vallenata</h1>
        <p className="text-sm text-neutral-500 mb-6">Sistema de venta — inicia sesión</p>

        <label className="block text-sm font-medium mb-1" htmlFor="email">Correo</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-neutral-300 rounded-md px-3 py-2 mb-4 text-sm"
          placeholder="tu-correo@ejemplo.com"
        />

        <label className="block text-sm font-medium mb-1" htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-neutral-300 rounded-md px-3 py-2 mb-4 text-sm"
        />

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        <button
          type="submit"
          disabled={cargando}
          className="w-full bg-neutral-900 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
        >
          {cargando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
