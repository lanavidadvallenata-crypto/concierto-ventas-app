// Anota un paso del embudo desde el servidor (Anita, 29 oct): "llegó al
// pago" y "reportó su pago". Ventas no se toca (Anita: "no quiero que las
// chicas sumen un paso").
//
// Regla de oro: medir NUNCA frena ni rompe una venta. Por eso:
//   - corre con after(): la compra responde primero y la anotación va después;
//   - todo va en try/catch y un error solo se anota en el log;
//   - si la tabla eventos_web todavía no existe (falta correr el SQL), la
//     inserción falla en silencio y la web sigue vendiendo igual.

import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { clasificarDispositivo, COOKIE_VISITANTE, visitanteValido, type EventoServidor } from "@/lib/medicion";
import type { Tipo } from "@/lib/precios";

export type EventoDeServidor = {
  evento: EventoServidor;
  zona?: Tipo | null;
  cantidad?: number | null;
  valorUsd?: number | null;
  grupoId?: string | null;
  enCuotas?: boolean | null;
};

export function anotarEventoServidor(datos: EventoDeServidor): void {
  const tarea = async () => {
    try {
      let visitante: string | null = null;
      let dispositivo: string | null = null;
      try {
        visitante = visitanteValido((await cookies()).get(COOKIE_VISITANTE)?.value);
      } catch {
        visitante = null;
      }
      try {
        dispositivo = clasificarDispositivo((await headers()).get("user-agent"));
      } catch {
        dispositivo = null;
      }
      const { error } = await createServiceClient()
        .from("eventos_web")
        .insert({
          evento: datos.evento,
          visitante,
          dispositivo,
          zona: datos.zona ?? null,
          cantidad: datos.cantidad ?? null,
          valor_usd: datos.valorUsd ?? null,
          grupo_id: datos.grupoId ?? null,
          en_cuotas: datos.enCuotas ?? null,
        });
      if (error) console.warn(`Medición: no se anotó "${datos.evento}":`, error.message);
    } catch (e) {
      console.warn(`Medición: no se anotó "${datos.evento}":`, (e as Error).message);
    }
  };
  try {
    after(tarea);
  } catch {
    // Fuera de una petición (pruebas, scripts): se anota igual, sin esperar.
    void tarea();
  }
}
