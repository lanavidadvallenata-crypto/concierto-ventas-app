"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EntradaManual() {
  const router = useRouter();
  const [valor, setValor] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valor.trim()) return;
    // Acepta tanto el token solo como la URL completa que trae el QR.
    const token = valor.trim().split("/").pop() || valor.trim();
    router.push(`/acceso/${token}`);
  }

  return (
    <form onSubmit={onSubmit} className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col gap-3">
      <label className="block text-sm font-medium" htmlFor="token">Código o enlace de la entrada</label>
      <input
        id="token"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
        placeholder="Pega aquí el código si el QR no escanea"
      />
      <button type="submit" className="bg-neutral-900 text-white rounded-md py-2 text-sm font-medium">
        Validar
      </button>
    </form>
  );
}
