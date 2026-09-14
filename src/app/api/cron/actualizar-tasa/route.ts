import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { actualizarTasaDesdeAPI } from "@/lib/tasa";

// Vercel llama esto todos los días a las 8am hora Venezuela (ver vercel.json),
// mandando "Authorization: Bearer $CRON_SECRET" automáticamente. Cualquier otra
// llamada sin ese header se rechaza para que nadie más pueda disparar esto.
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const service = createServiceClient();
  const resultado = await actualizarTasaDesdeAPI(service);

  if (!resultado.ok) {
    console.error("Error actualizando tasa de cambio:", resultado.error);
    return NextResponse.json(resultado, { status: 502 });
  }

  return NextResponse.json(resultado);
}
