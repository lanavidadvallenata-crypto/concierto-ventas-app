// Embudo del dashboard (Anita, 29 oct): lo puro. Lee lo que devuelve la
// función resumen_embudo de la base, arma los pasos con sus porcentajes, el
// ritmo de venta y los nombres de los canales. Sin base de datos ni Next, para
// probarlo suelto (pruebas/embudo.test.ts).

import { TIPOS, type Tipo } from "@/lib/precios";

export const FECHA_EVENTO = "2026-12-04";

export type Periodo = "hoy" | "7d" | "todo";
export const PERIODOS: { id: Periodo; etiqueta: string }[] = [
  { id: "hoy", etiqueta: "Hoy" },
  { id: "7d", etiqueta: "7 días" },
  { id: "todo", etiqueta: "Todo" },
];

export function leerPeriodo(x: unknown): Periodo {
  return x === "hoy" || x === "todo" ? x : "7d";
}

export function leerZona(x: unknown): Tipo | null {
  return typeof x === "string" && (TIPOS as readonly string[]).includes(x) ? (x as Tipo) : null;
}

/** "AAAA-MM-DD" menos n días. */
export function restarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Desde cuándo cuenta cada período, en hora de Venezuela (UTC-4, sin horario de verano). */
export function desdeDelPeriodo(periodo: Periodo, hoy: string): string {
  if (periodo === "hoy") return `${hoy}T00:00:00-04:00`;
  if (periodo === "7d") return `${restarDias(hoy, 6)}T00:00:00-04:00`;
  return "2026-09-01T00:00:00-04:00";
}

export function diasHastaEvento(hoy: string): number {
  return Math.max(0, Math.round((Date.parse(`${FECHA_EVENTO}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Lo que devuelve resumen_embudo (ver supabase/medicion_embudo_29oct.sql).
// Se lee a la defensiva: si algo no viene, cuenta como 0.
// ---------------------------------------------------------------------------
export type CanalResumen = { canal: string; visitantes: number; compras: number; confirmadas: number; valorConfirmado: number };
export type CampanaResumen = { canal: string; campana: string; compras: number; confirmadas: number; valorConfirmado: number };

export type ResumenEmbudo = {
  primerEvento: string | null;
  pasos: { visitantes: number; tienda: number; continuar: number; pago: number; reporto: number; confirmado: number };
  fugas: { expiraron: number; whatsapp: number; whatsappCompradores: number };
  comprasWeb: { reportadas: number; confirmadas: number; enCuotas: number; valorReportado: number; valorConfirmado: number };
  canales: CanalResumen[];
  campanas: CampanaResumen[];
  vivo: { activos5min: number; enPago: number };
};

const num = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const arr = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.map(obj) : []);
const txt = (x: unknown, otro: string) => (typeof x === "string" && x ? x : otro);

export function leerResumen(crudo: unknown): ResumenEmbudo {
  const r = obj(crudo);
  const p = obj(r.pasos);
  const f = obj(r.fugas);
  const c = obj(r.compras_web);
  const v = obj(r.vivo);
  return {
    primerEvento: typeof r.primer_evento === "string" ? r.primer_evento : null,
    pasos: {
      visitantes: num(p.visitantes),
      tienda: num(p.tienda),
      continuar: num(p.continuar),
      pago: num(p.pago),
      reporto: num(p.reporto),
      confirmado: num(p.confirmado),
    },
    fugas: { expiraron: num(f.expiraron), whatsapp: num(f.whatsapp), whatsappCompradores: num(f.whatsapp_compradores) },
    comprasWeb: {
      reportadas: num(c.reportadas),
      confirmadas: num(c.confirmadas),
      enCuotas: num(c.en_cuotas),
      valorReportado: num(c.valor_reportado),
      valorConfirmado: num(c.valor_confirmado),
    },
    canales: arr(r.canales).map((x) => ({
      canal: txt(x.canal, "directo"),
      visitantes: num(x.visitantes),
      compras: num(x.compras),
      confirmadas: num(x.confirmadas),
      valorConfirmado: num(x.valor_confirmado),
    })),
    campanas: arr(r.campanas).map((x) => ({
      canal: txt(x.canal, "directo"),
      campana: txt(x.campana, "—"),
      compras: num(x.compras),
      confirmadas: num(x.confirmadas),
      valorConfirmado: num(x.valor_confirmado),
    })),
    vivo: { activos5min: num(v.activos_5min), enPago: num(v.en_pago) },
  };
}

// ---------------------------------------------------------------------------
// Los pasos, con cuánto pasa de uno al siguiente.
// ---------------------------------------------------------------------------
export type Paso = {
  id: keyof ResumenEmbudo["pasos"];
  etiqueta: string;
  n: number;
  /** % del paso anterior que llegó a este (null en el primero o si el anterior es 0). */
  delAnterior: number | null;
  /** % de las visitas que llegó a este paso. */
  delTotal: number | null;
};

const ETIQUETAS: [keyof ResumenEmbudo["pasos"], string][] = [
  ["visitantes", "Entraron a la web"],
  ["tienda", "Vieron la tienda"],
  ["continuar", "Eligieron y tocaron Continuar"],
  ["pago", "Llegaron a la pantalla de pago"],
  ["reporto", "Reportaron su pago"],
  ["confirmado", "Pago confirmado"],
];

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function pasosDelEmbudo(r: ResumenEmbudo): Paso[] {
  return ETIQUETAS.map(([id, etiqueta], i) => {
    const n = r.pasos[id];
    const anterior = i > 0 ? r.pasos[ETIQUETAS[i - 1][0]] : null;
    return {
      id,
      etiqueta,
      n,
      delAnterior: anterior == null ? null : pct(n, anterior),
      delTotal: i === 0 ? null : pct(n, r.pasos.visitantes),
    };
  });
}

/** El salto donde se pierde más gente (en personas), para señalarlo. null si
 *  todavía no hay suficientes datos para que signifique algo. */
export function mayorFuga(pasos: Paso[]): { desde: Paso; hasta: Paso; perdidos: number } | null {
  let mejor: { desde: Paso; hasta: Paso; perdidos: number } | null = null;
  for (let i = 1; i < pasos.length; i++) {
    const perdidos = pasos[i - 1].n - pasos[i].n;
    if (perdidos > 0 && (!mejor || perdidos > mejor.perdidos)) mejor = { desde: pasos[i - 1], hasta: pasos[i], perdidos };
  }
  return mejor && pasos[0].n >= 10 ? mejor : null;
}

// ---------------------------------------------------------------------------
// Nombres de los canales.
// ---------------------------------------------------------------------------
const CANALES: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  meta: "Meta (FB o IG)",
  manychat: "ManyChat",
  whatsapp: "WhatsApp",
  google: "Google",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X (Twitter)",
  directo: "Directo / sin rastro",
};

export function etiquetaCanal(canal: string): string {
  return CANALES[canal] ?? canal;
}

// ---------------------------------------------------------------------------
// Ritmo: a qué velocidad se está vendiendo contra la que hace falta.
// ---------------------------------------------------------------------------
export type Ritmo = {
  /** Entradas por día, promedio de los últimos 7 días. */
  real: number;
  /** Entradas por día que hacen falta para llenar el aforo el día del evento. */
  necesario: number;
  /** Ocupación proyectada el día del evento al ritmo real, % del aforo (tope 100). */
  proyeccionPct: number;
  diasRestantes: number;
  vaBien: boolean;
};

export function calcularRitmo(o: { ocupadas: number; aforo: number; ultimos7: number; diasRestantes: number }): Ritmo {
  const real = Math.round((o.ultimos7 / 7) * 10) / 10;
  const faltan = Math.max(0, o.aforo - o.ocupadas);
  const dias = Math.max(1, o.diasRestantes);
  const necesario = Math.round((faltan / dias) * 10) / 10;
  const proyectadas = Math.min(o.aforo, o.ocupadas + real * o.diasRestantes);
  const proyeccionPct = o.aforo > 0 ? Math.round((proyectadas / o.aforo) * 100) : 0;
  return { real, necesario, proyeccionPct, diasRestantes: o.diasRestantes, vaBien: faltan === 0 || real >= necesario };
}

/** Las 24 horas del día con cuántas compras hubo en cada una (hora de Venezuela). */
export function comprasPorHora(fechas: readonly string[]): number[] {
  const horas = Array.from({ length: 24 }, () => 0);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Caracas", hour: "numeric", hourCycle: "h23" });
  for (const f of fechas) {
    const h = Number(fmt.format(new Date(f)));
    if (Number.isInteger(h) && h >= 0 && h < 24) horas[h] += 1;
  }
  return horas;
}

/** Mediana en minutos (null si no hay datos). */
export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const s = [...valores].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Minutos desde una fecha hasta ahora. */
export function minutosDesde(iso: string, ahora: Date = new Date()): number {
  return (ahora.getTime() - Date.parse(iso)) / 60_000;
}

/** "45 min", "3 h 10 min", "2 d 4 h". */
export function duracionCorta(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}
