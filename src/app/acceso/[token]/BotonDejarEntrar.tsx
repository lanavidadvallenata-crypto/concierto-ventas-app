"use client";

import { useFormStatus } from "react-dom";

// Se desactiva mientras se registra: un doble toque no manda dos ingresos.
export default function BotonDejarEntrar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full min-h-20 rounded-2xl bg-green-600 active:bg-green-700 disabled:opacity-70 text-white text-2xl font-bold tracking-wide shadow-lg"
    >
      {pending ? "REGISTRANDO…" : "DEJAR ENTRAR"}
    </button>
  );
}
