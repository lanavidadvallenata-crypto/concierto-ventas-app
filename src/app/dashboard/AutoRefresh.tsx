"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({
  intervaloMs = 20000,
  tema = "claro",
}: {
  intervaloMs?: number;
  /** "noche" = Dashboard con la dirección visual nueva. Finanzas y Cobranza
   *  siguen usando el aspecto de siempre (por defecto). */
  tema?: "claro" | "noche";
}) {
  const router = useRouter();
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setSegundos((s) => s + 1), 1000);
    const refrescar = setInterval(() => {
      router.refresh();
      setSegundos(0);
    }, intervaloMs);
    return () => {
      clearInterval(tick);
      clearInterval(refrescar);
    };
  }, [router, intervaloMs]);

  if (tema === "noche") {
    return (
      <div className="flex items-center gap-2 text-xs text-noche-tenue whitespace-nowrap">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_10px_#34d399]" />
        </span>
        En vivo · hace {segundos} s
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-neutral-400">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-marca-secundario opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-marca-secundario" />
      </span>
      Actualizado hace {segundos}s
    </div>
  );
}
