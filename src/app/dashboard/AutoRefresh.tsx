"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({ intervaloMs = 20000 }: { intervaloMs?: number }) {
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
