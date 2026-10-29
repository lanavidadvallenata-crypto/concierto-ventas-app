// Recibe los pasos que anota el navegador en la web pública (Anita, 29 oct):
// visita, zona, continuar, expiro, whatsapp. Responde 204 al instante y guarda
// después (after), así nunca demora la página.
//
// Defensas (los números que cuentan plata NO pasan por aquí: "llegó al pago",
// "reportó" y las ventas los anota el servidor dentro de la compra):
//   - solo los 5 pasos de navegador, con campos cortos y validados;
//   - solo desde nuestros dominios (cabecera Origin);
//   - sin bots ni vistas previas de enlaces;
//   - tope por IP y por instancia, alto a propósito: en Venezuela miles de
//     teléfonos salen por la misma IP (CG-NAT) y no queremos perder visitas
//     reales en la hora pico. Solo frena a un script que dispare cientos.

import { after } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { esHostPropio } from "@/lib/dominios";
import { TIPOS, type Tipo } from "@/lib/precios";
import {
  clasificarDispositivo,
  esBot,
  EVENTOS_CLIENTE,
  normalizarLlegada,
  rutaLimpia,
  visitanteValido,
} from "@/lib/medicion";

const texto = (max: number) => z.string().max(max).nullish();

const esquema = z.object({
  v: texto(64),
  e: z.enum(EVENTOS_CLIENTE),
  r: texto(200),
  z: z.enum(TIPOS as [Tipo, ...Tipo[]]).nullish(),
  c: z.number().int().min(0).max(100).nullish(),
  us: texto(200),
  um: texto(200),
  uc: texto(200),
  ut: texto(200),
  rf: texto(500),
  fb: z.boolean().nullish(),
  g: z.boolean().nullish(),
});

const VENTANA_MS = 60_000;
const MAX_POR_IP = 600;
const porIp = new Map<string, { n: number; desde: number }>();

function pasaTope(ip: string): boolean {
  const ahora = Date.now();
  const r = porIp.get(ip);
  if (!r || ahora - r.desde > VENTANA_MS) {
    if (porIp.size > 5000) porIp.clear();
    porIp.set(ip, { n: 1, desde: ahora });
    return true;
  }
  r.n += 1;
  return r.n <= MAX_POR_IP;
}

function origenPermitido(origin: string | null): boolean {
  if (!origin) return true; // algunos navegadores no la mandan en sendBeacon
  try {
    const host = new URL(origin).hostname;
    return (
      esHostPropio(host) ||
      (host.startsWith("concierto-ventas-app") && host.endsWith(".vercel.app")) ||
      host === "localhost" ||
      host === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

const NADA = () => new Response(null, { status: 204 });

export async function POST(request: Request) {
  const ua = request.headers.get("user-agent");
  if (!origenPermitido(request.headers.get("origin")) || esBot(ua)) return NADA();

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "sin-ip";
  if (!pasaTope(ip)) return NADA();

  let crudo: unknown;
  try {
    const cuerpo = await request.text();
    if (cuerpo.length > 4000) return NADA();
    crudo = JSON.parse(cuerpo);
  } catch {
    return NADA();
  }
  const p = esquema.safeParse(crudo);
  if (!p.success) return NADA();
  const d = p.data;

  const llegada =
    d.e === "visita"
      ? normalizarLlegada({
          utmSource: d.us,
          utmMedium: d.um,
          utmCampaign: d.uc,
          utmContent: d.ut,
          referidor: d.rf,
          fbclid: Boolean(d.fb),
          gclid: Boolean(d.g),
        })
      : null;

  const fila = {
    visitante: visitanteValido(d.v),
    evento: d.e,
    ruta: rutaLimpia(d.r),
    zona: d.z ?? null,
    cantidad: d.c ?? null,
    fuente: llegada?.fuente ?? null,
    medio: llegada?.medio ?? null,
    campana: llegada?.campana ?? null,
    contenido: llegada?.contenido ?? null,
    referidor: llegada?.referidor ?? null,
    dispositivo: clasificarDispositivo(ua),
  };

  after(async () => {
    try {
      const { error } = await createServiceClient().from("eventos_web").insert(fila);
      if (error) console.warn(`Medición: no se anotó "${fila.evento}":`, error.message);
    } catch (e) {
      console.warn(`Medición: no se anotó "${fila.evento}":`, (e as Error).message);
    }
  });
  return NADA();
}
