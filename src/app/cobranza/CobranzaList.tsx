"use client";

import { useMemo, useState, useTransition } from "react";
import type { CuotaPorCobrar, ListaCobranza } from "@/lib/abona618";
import { registrarPagoDeCuotas, aprobarCuotas, anularPorFaltaDePago, rechazarPagoAnotado, anularCompraEnPlan } from "./actions";
import { ETIQUETA_METODO, METODOS_EN_BS, NOTA_TASA_CORTA, SIN_TASA, formatoBs, formatoBsAprox, formatoUsd, parsearMontoBs } from "@/lib/formato";
import { convertirABs } from "@/lib/tasa";
import { fechaCorta } from "@/lib/cuotas";
import { codigoCompra } from "@/lib/compra";
import { DOMINIO_RAIZ } from "@/lib/dominios";
import { etiquetaTipo, type Tipo } from "@/lib/precios";

// Esta pantalla está armada POR PERSONA, no por cuota (Anita, 12 oct).
//
// La primera versión listaba cuotas: una compradora con tres pagos aparecía
// como tres tarjetas en tres cajas distintas de la misma pantalla, y ninguna
// decía lo que ya había pagado. Textual: "uno no sabe si hay que escribirle,
// si debe, si no debe". Tenía razón — el equipo no cobra cuotas, atiende
// personas, y la pregunta que trae a esta pantalla es siempre la misma:
// ¿a quién le escribo ahora y qué le digo?
//
// Así que cada tarjeta es UNA persona, con una sola línea grande que dice qué
// hacer con ella, lo que lleva pagado, lo que le falta, y un pago que puede
// cubrir varias cuotas de una sola vez, porque así entra la plata.
//
// El equipo trabaja desde el teléfono, así que es una columna de tarjetas con
// área táctil grande, no una tabla.

type Aviso = { tipo: "ok" | "error"; texto: string };

const METODOS = [
  "pago_movil",
  "transferencia",
  "zelle",
  "binance",
  "efectivo_usd",
  "efectivo_bs",
] as const;

const CANALES = [
  { valor: "whatsapp", etiqueta: "WhatsApp" },
  { valor: "llamada", etiqueta: "Llamada" },
  { valor: "presencial", etiqueta: "En persona" },
  { valor: "otro", etiqueta: "Otro" },
] as const;

/** De más urgente a menos. El orden MANDA: define en qué caja cae cada
 *  persona y qué dice su tarjeta, que es toda la utilidad de la pantalla. */
const URGENCIAS = ["paraAnular", "enGracia", "vencenHoy", "porVerificar", "proximas", "masAdelante"] as const;
type Urgencia = (typeof URGENCIAS)[number];

const SECCIONES: Record<Urgencia, { titulo: string; nota: string; tono: string; barra: string }> = {
  paraAnular: {
    titulo: "Hay que anular",
    nota: "Se les pasó la fecha y no pagaron. Confirma por WhatsApp antes de liberar la entrada.",
    tono: "border-neutral-400 bg-neutral-100",
    barra: "bg-neutral-500",
  },
  enGracia: {
    titulo: "Última llamada",
    nota: "Ya vencieron y no han pagado. Llámalos antes de que pasen a la lista de anular.",
    tono: "border-red-300 bg-red-50",
    barra: "bg-red-500",
  },
  vencenHoy: {
    titulo: "Vencen hoy",
    nota: "Escríbeles hoy mismo.",
    tono: "border-amber-300 bg-amber-50",
    barra: "bg-amber-500",
  },
  porVerificar: {
    titulo: "Pagaron · falta confirmar en el banco",
    nota: "Trabajo de Finanzas. A estas personas NO hay que cobrarles nada.",
    tono: "border-sky-300 bg-sky-50",
    barra: "bg-sky-500",
  },
  proximas: {
    titulo: "Al día · les toca pronto",
    nota: "Un recordatorio suave, sin apuro.",
    tono: "border-neutral-200 bg-white",
    barra: "bg-emerald-500",
  },
  masAdelante: {
    titulo: "Al día",
    nota: "No hay que escribirles. Aquí se anotan los que adelantan su pago.",
    tono: "border-neutral-200 bg-white",
    barra: "bg-emerald-500",
  },
};

type CuotaConUrgencia = CuotaPorCobrar & { urgencia: Urgencia };

type Persona = {
  grupoId: string;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  tipo: Tipo;
  cantidad: number;
  totalUsd: number;
  pagado: number;
  saldo: number;
  urgencia: Urgencia;
  /** Las cuotas sin cobrar, de la más urgente a la menos. */
  pendientes: CuotaConUrgencia[];
  /** Las que ya están cobradas, para que se vea lo que la persona YA pagó. */
  pagadas: { etiqueta: string; montoUsd: number }[];
  /** Las que ya reportó y están esperando al banco: el trabajo de Finanzas. */
  anotadas: CuotaConUrgencia[];
  /** La cuota que manda en su tarjeta. */
  manda: CuotaConUrgencia;
};

/** 0414-1234567 → 584141234567, que es lo que wa.me necesita. */
function paraWhatsApp(telefono: string | null): string | null {
  if (!telefono) return null;
  const d = telefono.replace(/\D/g, "");
  // Formatos venezolanos: 0414-1234567 (11 dígitos con el 0), 4141234567
  // (10) o ya con el 58 (12). Cualquier otra cosa no se inventa: un enlace
  // a un número que no existe es peor que no tener enlace.
  if (/^58\d{10}$/.test(d)) return d;
  if (/^0\d{10}$/.test(d)) return `58${d.slice(1)}`;
  if (/^\d{10}$/.test(d)) return `58${d}`;
  return null;
}

function mensajeWhatsApp(p: Persona, tasaEurVes: number | null): string {
  const nombre = (p.nombre ?? "").split(" ")[0] || "";
  const hola = nombre ? `Hola ${nombre}` : "Hola";
  const c = p.manda;
  // El monto en bolívares va en el mensaje, pero SIEMPRE con "hoy" pegado:
  // mañana es otro número, y quien recibe el mensaje tiene que saberlo antes
  // de transferir de menos.
  const enBs = tasaEurVes ? ` (hoy son ${formatoBs(convertirABs(c.montoUsd, tasaEurVes))} a la tasa BCV euro)` : "";
  const monto = `${formatoUsd(c.montoUsd)}${enBs}`;
  const cuando = fechaCorta(c.venceEl);

  // Ninguno de estos mensajes menciona los días de gracia (Anita, 12 oct):
  // "si no, esperan hasta el último día y piden más prórroga". El comprador
  // sabe su fecha; el margen que tiene el equipo por dentro no se regala.
  if (p.urgencia === "enGracia") {
    return (
      `${hola}, te escribo de La Navidad Vallenata. Tu pago de ${monto} venció el ${cuando} ` +
      `y todavía no nos ha llegado, así que tu entrada está a punto de liberarse. ` +
      `¿Ya lo hiciste? Si tienes la referencia mándamela ahora mismo y la registro de una.`
    );
  }
  if (p.urgencia === "vencenHoy") {
    return (
      `${hola}, te escribo de La Navidad Vallenata. Hoy vence tu pago de ${monto}. ` +
      `Cuando lo hagas, mándame la referencia por aquí y yo lo registro. ¿Te paso los datos?`
    );
  }
  if (p.urgencia === "paraAnular") {
    return (
      `${hola}, te escribo de La Navidad Vallenata. Tu pago de ${monto} venció el ${cuando} ` +
      `y no nos ha llegado, así que tu entrada entró en la lista para volver a la venta. ` +
      `Si lo pagaste, mándame la referencia ya mismo y lo revisamos antes de anularla.`
    );
  }
  // Ya reportó y está esperando al banco: pedirle plata otra vez es el error
  // que tenía esta pantalla. Aquí se tranquiliza, no se cobra.
  if (p.urgencia === "porVerificar") {
    // Lo que pagó es la SUMA de lo anotado, no una cuota: un solo Zelle de
    // $196 que cubre dos cuotas se le confirma como $196, o reclama.
    const anotado = formatoUsd(Math.round(p.anotadas.reduce((s, x) => s + x.montoUsd, 0) * 100) / 100);
    return (
      `${hola}, te escribo de La Navidad Vallenata. Recibimos tu pago de ${anotado} y lo estamos ` +
      `confirmando con el banco; te aviso en cuanto quede listo. Tu entrada sigue apartada a tu nombre.`
    );
  }
  return (
    `${hola}, te escribo de La Navidad Vallenata. Te recuerdo que el ${cuando} vence tu pago de ${monto} ` +
    `(te falta ${formatoUsd(p.saldo)} para completar tu entrada). Cuando pagues, mándame la referencia por aquí.`
  );
}

/** La línea grande de la tarjeta: lo único que el equipo tiene que leer. */
function queHacer(p: Persona): string {
  const c = p.manda;
  switch (p.urgencia) {
    case "paraAnular":
      if (p.anotadas.length > 0) {
        return `Se le pasó la fecha de ${c.etiqueta} (${fechaCorta(c.venceEl)}), pero tiene un pago anotado: confírmalo o recházalo antes de decidir.`;
      }
      return `Se le pasó la fecha de ${c.etiqueta} (${fechaCorta(c.venceEl)}). Hay que anular y revender.`;
    case "enGracia":
      return `Debe ${formatoUsd(c.montoUsd)} desde el ${fechaCorta(c.venceEl)}. Escríbele ya.`;
    case "vencenHoy":
      return `Hoy le vence ${formatoUsd(c.montoUsd)}. Escríbele hoy mismo.`;
    case "porVerificar":
      return `Pagó ${formatoUsd(p.anotadas.reduce((s, x) => s + x.montoUsd, 0))}. Finanzas tiene que confirmarlo en el banco.`;
    case "proximas":
      return `Al día. Le toca ${formatoUsd(c.montoUsd)} el ${fechaCorta(c.venceEl)}.`;
    default:
      return `Al día — no hay que escribirle. Próximo pago el ${fechaCorta(c.venceEl)}.`;
  }
}

export default function CobranzaList({
  lista,
  hoy,
  miRol,
  nombrePorId,
  moduloActivo,
  configError,
  topeVip,
  tasaEurVes,
}: {
  lista: ListaCobranza;
  hoy: string;
  miRol: string;
  nombrePorId: Record<string, string>;
  moduloActivo: boolean;
  /** true = no se pudo leer abona618_config: no se sabe si está encendido. */
  configError: boolean;
  topeVip: number;
  /** Tasa BCV del euro de hoy, para estimar los bolívares de lo que falta por
   *  cobrar. null = no se pudo leer; entonces no se estima nada. */
  tasaEurVes: number | null;
}) {
  const [, startTransition] = useTransition();
  const [procesando, setProcesando] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<Record<string, Aviso>>({});
  const [abierto, setAbierto] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState("");
  // "Anular compra" (solo admin): compra duplicada, arrepentido, prueba.
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivoAnulacion, setMotivoAnulacion] = useState("");

  const puedeAprobar = miRol === "finanzas" || miRol === "admin";
  const esAdmin = miRol === "admin";

  // Una fila por cuota se vuelve una fila por persona. La urgencia de la
  // persona es la de su cuota más urgente: si debe algo desde ayer, no
  // importa que tenga otra cuota tranquila para diciembre.
  const personas = useMemo<Persona[]>(() => {
    const porGrupo = new Map<string, Persona>();
    for (const urgencia of URGENCIAS) {
      for (const c of lista[urgencia]) {
        const item: CuotaConUrgencia = { ...c, urgencia };
        const ya = porGrupo.get(c.grupoId);
        if (ya) {
          ya.pendientes.push(item);
          if (item.reportadoEn) ya.anotadas.push(item);
          continue;
        }
        porGrupo.set(c.grupoId, {
          grupoId: c.grupoId,
          nombre: c.compradorNombre,
          telefono: c.compradorTelefono,
          email: c.compradorEmail,
          tipo: c.tipo,
          cantidad: c.cantidad,
          totalUsd: c.totalUsd,
          pagado: c.pagado,
          saldo: c.saldo,
          urgencia,
          pendientes: [item],
          pagadas: lista.pagadasPorGrupo[c.grupoId] ?? [],
          anotadas: item.reportadoEn ? [item] : [],
          manda: item,
        });
      }
    }
    for (const p of porGrupo.values()) {
      p.pendientes.sort((a, b) => a.diasParaVencer - b.diasParaVencer);
    }
    return [...porGrupo.values()];
  }, [lista]);

  function poner(id: string, aviso: Aviso) {
    setAvisos((prev) => ({ ...prev, [id]: aviso }));
  }

  function correr(id: string, fn: () => Promise<{ ok: boolean; aviso?: string; error?: string }>) {
    setProcesando(id);
    setAvisos((prev) => {
      const copia = { ...prev };
      delete copia[id];
      return copia;
    });
    startTransition(async () => {
      const res = await fn();
      setProcesando((actual) => (actual === id ? null : actual));
      setConfirmando((actual) => (actual === id ? null : actual));
      setAnulando((actual) => (actual === id ? null : actual));
      if (!res.ok) {
        poner(id, { tipo: "error", texto: res.error ?? "No se pudo completar." });
        return;
      }
      setAbierto(null);
      poner(id, { tipo: "ok", texto: res.aviso ?? "Listo." });
    });
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold">Cobranza de cuotas</h1>
        {lista.error && (
          <p className="text-sm rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
            <strong>No se pudo leer la base de datos.</strong> Lo que ves abajo no es real: no es que nadie deba
            nada, es que no se pudo cargar. Recarga en un momento.
          </p>
        )}
        {configError && (
          <p className="text-xs rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            No se pudo leer si el plan de cuotas está encendido o apagado.
          </p>
        )}
        {!configError && !moduloActivo && (
          <p className="text-xs rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-neutral-600">
            El plan de cuotas está <strong>apagado</strong> para compradores nuevos. Lo que aparece aquí son planes
            que ya existen y hay que seguir cobrando igual.
          </p>
        )}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-neutral-200 px-2 py-2">
            <div className="text-base font-semibold tabular-nums">{formatoUsd(lista.saldoTotal)}</div>
            {tasaEurVes && (
              <div className="text-[11px] text-neutral-600 tabular-nums leading-tight">
                {formatoBsAprox(convertirABs(lista.saldoTotal, tasaEurVes))}
              </div>
            )}
            <div className="text-[11px] text-neutral-500 leading-tight">por cobrar</div>
          </div>
          <div className="rounded-lg border border-neutral-200 px-2 py-2">
            <div className="text-base font-semibold tabular-nums">{lista.planesActivos}</div>
            <div className="text-[11px] text-neutral-500 leading-tight">compras en plan</div>
          </div>
          <div className="rounded-lg border border-neutral-200 px-2 py-2">
            <div className="text-base font-semibold tabular-nums">
              {lista.vipEnPlan}
              <span className="text-neutral-400 text-xs"> / {topeVip}</span>
            </div>
            <div className="text-[11px] text-neutral-500 leading-tight">VIP en plan</div>
          </div>
        </div>
        <p className="text-[11px] text-neutral-500">
          {tasaEurVes
            ? `Los montos en bolívares son ${NOTA_TASA_CORTA} y cambian cada día. La deuda es en dólares: al cobrar, usa el monto en Bs del día del pago, no el de hoy.`
            : `${SIN_TASA} — los montos salen solo en dólares hasta que vuelva.`}
        </p>
      </header>

      {personas.length === 0 && !lista.error && (
        <p className="text-sm text-neutral-500 py-6 text-center">
          No hay nada por cobrar ahora mismo. Nadie debe nada.
        </p>
      )}

      {/* 17. Lo que Finanzas tiene que confirmar, aunque la persona esté en
          otra caja por tener además algo vencido. Sin esto, Finanzas barría
          solo la caja azul y esos pagos quedaban escondidos. */}
      {(() => {
        const escondidos = personas.filter((p) => p.anotadas.length > 0 && p.urgencia !== "porVerificar");
        if (escondidos.length === 0) return null;
        return (
          <p className="text-xs rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sky-900">
            <strong>Finanzas:</strong> además de la caja azul, hay {escondidos.length}{" "}
            {escondidos.length === 1 ? "pago anotado" : "pagos anotados"} esperando confirmación en otras cajas:{" "}
            {escondidos.map((p) => `${p.nombre ?? "sin nombre"} (${codigoCompra(p.grupoId)})`).join(", ")}.
          </p>
        );
      })()}

      {URGENCIAS.map((urgencia) => {
        const sec = SECCIONES[urgencia];
        const gente = personas.filter((p) => p.urgencia === urgencia);
        if (gente.length === 0) return null;

        return (
          <section key={urgencia} className="space-y-2">
            <div>
              <h2 className="text-sm font-semibold">
                {sec.titulo} <span className="text-neutral-400 font-normal">· {gente.length}</span>
              </h2>
              <p className="text-xs text-neutral-500">{sec.nota}</p>
            </div>

            {gente.map((p) => {
              const wa = paraWhatsApp(p.telefono);
              const aviso = avisos[p.grupoId];
              const esteProcesando = procesando === p.grupoId;
              const avance = p.totalUsd > 0 ? Math.round((p.pagado / p.totalUsd) * 100) : 0;

              return (
                <article key={p.grupoId} className={`rounded-xl border px-3 py-3 space-y-2.5 ${sec.tono}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {p.nombre ?? "Sin nombre"}
                        <span className="text-neutral-400 font-normal font-mono text-xs"> · {codigoCompra(p.grupoId)}</span>
                      </p>
                      <p className="text-xs text-neutral-600">
                        {p.cantidad} {etiquetaTipo(p.tipo, p.cantidad)} ·{" "}
                        {formatoUsd(p.totalUsd)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-sm tabular-nums">
                        falta {formatoUsd(Math.round((p.saldo - p.anotadas.reduce((s, x) => s + x.montoUsd, 0)) * 100) / 100)}
                      </div>
                      <div className="text-[11px] text-neutral-600 tabular-nums">
                        {tasaEurVes ? formatoBsAprox(convertirABs(p.saldo, tasaEurVes)) : SIN_TASA}
                      </div>
                    </div>
                  </div>

                  {/* Lo único que el equipo tiene que leer para saber qué hacer. */}
                  <p className="text-sm font-semibold text-neutral-900">{queHacer(p)}</p>

                  <div>
                    <div className="h-1.5 w-full rounded-full bg-white/80 overflow-hidden">
                      <div className={`h-full rounded-full ${sec.barra}`} style={{ width: `${avance}%` }} />
                    </div>
                    <p className="text-xs text-neutral-600 mt-1 tabular-nums">
                      Confirmado {formatoUsd(p.pagado)} de {formatoUsd(p.totalUsd)}
                      {p.anotadas.length > 0 && (
                        <>
                          {" · "}
                          <span className="text-sky-800">
                            por confirmar {formatoUsd(Math.round(p.anotadas.reduce((s, x) => s + x.montoUsd, 0) * 100) / 100)}
                          </span>
                        </>
                      )}
                    </p>
                  </div>

                  <ul className="text-xs rounded-md bg-white/70 border border-neutral-200 divide-y divide-neutral-100">
                    {p.pagadas.map((c) => (
                      <li key={c.etiqueta} className="flex items-center justify-between gap-2 px-2 py-1.5">
                        <span className="text-neutral-500">
                          <span className="text-emerald-700 font-semibold">✓</span> {c.etiqueta}
                        </span>
                        <span className="tabular-nums text-neutral-500">{formatoUsd(c.montoUsd)} · pagada</span>
                      </li>
                    ))}
                    {p.pendientes.map((c) => (
                      <li key={c.cuotaId} className="px-2 py-1.5 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-neutral-800">{c.etiqueta}</span>
                          <span className="tabular-nums">
                            {formatoUsd(c.montoUsd)}
                            <span className="text-neutral-500">
                              {" · "}
                              {c.reportadoEn
                                ? "por confirmar"
                                : `vence ${fechaCorta(c.venceEl)}${c.diasParaVencer < 0 ? ` (${-c.diasParaVencer} ${-c.diasParaVencer === 1 ? "día" : "días"} tarde)` : ""}`}
                            </span>
                          </span>
                        </div>
                        {c.reportadoEn && (
                          <div className="text-neutral-500 flex items-center justify-between gap-2 flex-wrap">
                            <span>
                              {ETIQUETA_METODO[c.metodoPago ?? ""] ?? c.metodoPago}
                              {c.referenciaPago ? ` · ref. ${c.referenciaPago}` : ""}
                              {METODOS_EN_BS.has(c.metodoPago ?? "") && c.montoBs != null ? ` · ${formatoBs(c.montoBs)}` : ""}
                              {" · "}
                              {c.reportadoPor
                                ? `anotado por ${nombrePorId[c.reportadoPor] ?? "alguien del equipo"}`
                                : "lo reportó el comprador"}
                            </span>
                            {puedeAprobar && (
                              rechazando === c.cuotaId ? (
                                <span className="flex items-center gap-1.5 w-full">
                                  <input
                                    value={motivoRechazo}
                                    onChange={(e) => setMotivoRechazo(e.target.value)}
                                    placeholder="¿Por qué? Ej: no aparece en Bancamiga"
                                    className="flex-1 min-w-0 h-9 rounded-md border border-neutral-300 px-2 text-xs"
                                  />
                                  <button
                                    type="button"
                                    disabled={esteProcesando || motivoRechazo.trim().length < 3}
                                    onClick={() =>
                                      correr(p.grupoId, () => rechazarPagoAnotado({ cuotaId: c.cuotaId, motivo: motivoRechazo.trim() }))
                                    }
                                    className="h-9 px-2 rounded-md bg-red-600 text-white text-xs font-semibold disabled:opacity-50"
                                  >
                                    Rechazar
                                  </button>
                                  <button type="button" onClick={() => setRechazando(null)} className="h-9 px-2 text-xs text-neutral-500">
                                    Cancelar
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => { setRechazando(c.cuotaId); setMotivoRechazo(""); }}
                                  className="h-9 px-2 rounded-md border border-red-200 text-red-700 bg-white text-xs font-semibold"
                                >
                                  No llegó al banco
                                </button>
                              )
                            )}
                          </div>
                        )}
                        {c.nota && <div className="text-neutral-600 italic">“{c.nota}”</div>}
                      </li>
                    ))}
                  </ul>

                  {aviso && (
                    <p
                      className={`text-xs rounded-md px-2 py-1.5 ${
                        aviso.tipo === "ok"
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                          : "bg-red-50 text-red-800 border border-red-200"
                      }`}
                    >
                      {aviso.texto}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {wa ? (
                      <a
                        href={`https://wa.me/${wa}?text=${encodeURIComponent(mensajeWhatsApp(p, tasaEurVes))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-11 px-3 inline-flex items-center rounded-lg bg-[#25D366] text-white text-sm font-semibold"
                      >
                        WhatsApp
                      </a>
                    ) : (
                      <span className="h-11 px-1 inline-flex items-center text-xs text-neutral-500">
                        {p.email ? `Sin WhatsApp · ${p.email}` : "Sin teléfono ni correo"}
                      </span>
                    )}

                    {/* La misma página que ve el comprador: avance, cuotas y
                        datos de pago. Se le puede pasar el enlace tal cual. */}
                    <a
                      href={`https://${DOMINIO_RAIZ}/compra/${p.grupoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-11 px-3 inline-flex items-center rounded-lg border border-neutral-300 bg-white text-sm font-semibold"
                    >
                      Ver su plan
                    </a>

                    {p.anotadas.length > 0 && puedeAprobar && (
                      <button
                        type="button"
                        disabled={esteProcesando}
                        onClick={() => correr(p.grupoId, () => aprobarCuotas(p.anotadas.map((c) => c.cuotaId)))}
                        className="h-11 px-3 rounded-lg bg-marca-secundario text-white text-sm font-semibold disabled:opacity-50"
                      >
                        {esteProcesando
                          ? "Confirmando…"
                          : `Confirmé ${p.anotadas.length > 1 ? "los pagos" : "el dinero"} en el banco`}
                      </button>
                    )}
                    {p.anotadas.length > 0 && !puedeAprobar && (
                      <span className="h-11 px-1 inline-flex items-center text-xs text-neutral-500">
                        Esperando a Finanzas
                      </span>
                    )}

                    {p.pendientes.some((c) => !c.reportadoEn) && (
                      <button
                        type="button"
                        onClick={() => setAbierto(abierto === p.grupoId ? null : p.grupoId)}
                        className="h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm font-semibold"
                      >
                        {abierto === p.grupoId ? "Cerrar" : "Anotar un pago"}
                      </button>
                    )}

                    {esAdmin && (p.urgencia !== "paraAnular" || p.anotadas.length > 0) && anulando !== p.grupoId && (
                      <button
                        type="button"
                        onClick={() => { setAnulando(p.grupoId); setMotivoAnulacion(""); }}
                        className="h-11 px-3 rounded-lg border border-neutral-300 text-neutral-600 bg-white text-sm font-semibold"
                      >
                        Anular compra
                      </button>
                    )}

                    {p.urgencia === "paraAnular" && puedeAprobar && p.anotadas.length === 0 && (
                      confirmando === p.grupoId ? (
                        <button
                          type="button"
                          disabled={esteProcesando}
                          onClick={() => correr(p.grupoId, () => anularPorFaltaDePago(p.grupoId))}
                          className="h-11 px-3 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
                        >
                          {esteProcesando ? "Anulando…" : "Sí, anular y revender"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmando(p.grupoId)}
                          className="h-11 px-3 rounded-lg border border-red-300 text-red-700 bg-white text-sm font-semibold"
                        >
                          Anular por falta de pago
                        </button>
                      )
                    )}
                  </div>

                  {esAdmin && anulando === p.grupoId && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                      <p className="text-sm font-semibold text-red-900">Anular esta compra y devolver sus entradas a la venta</p>
                      <p className="text-xs text-red-900/80">
                        Es para compras duplicadas, pruebas o compradores que se arrepintieron. Si no pagó a tiempo, usa
                        &ldquo;Anular por falta de pago&rdquo; cuando le aparezca.
                        {p.pagado > 0 && ` Tiene ${formatoUsd(p.pagado)} confirmados: lo que se haga con ese dinero lo decides tú con el comprador.`}
                        {p.anotadas.length > 0 &&
                          ` Ojo: tiene ${formatoUsd(Math.round(p.anotadas.reduce((s, x) => s + x.montoUsd, 0) * 100) / 100)} anotados sin confirmar que se van a descartar.`}
                      </p>
                      <input
                        value={motivoAnulacion}
                        onChange={(e) => setMotivoAnulacion(e.target.value)}
                        placeholder="Motivo (queda en el registro). Ej: compra de prueba"
                        className="w-full h-11 rounded-md border border-neutral-300 bg-white px-2 text-sm"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={esteProcesando || motivoAnulacion.trim().length < 5}
                          onClick={() =>
                            correr(p.grupoId, () => anularCompraEnPlan({ grupoId: p.grupoId, motivo: motivoAnulacion.trim() }))
                          }
                          className="h-11 px-3 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
                        >
                          {esteProcesando ? "Anulando…" : "Sí, anular la compra"}
                        </button>
                        <button type="button" onClick={() => setAnulando(null)} className="h-11 px-3 text-sm text-neutral-600">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {abierto === p.grupoId && (
                    <FormularioPago
                      key={`${p.grupoId}:${p.pendientes.filter((c) => !c.reportadoEn).map((c) => c.cuotaId).join(",")}`}
                      persona={p}
                      procesando={esteProcesando}
                      onEnviar={(datos) => correr(p.grupoId, () => registrarPagoDeCuotas(datos))}
                    />
                  )}
                </article>
              );
            })}
          </section>
        );
      })}

      <p className="text-[11px] text-neutral-400 pt-2">
        Al día de hoy, {fechaCorta(hoy)}. La pantalla se actualiza sola cada minuto.
      </p>
    </div>
  );
}

function FormularioPago({
  persona,
  procesando,
  onEnviar,
}: {
  persona: Persona;
  procesando: boolean;
  onEnviar: (datos: Record<string, unknown>) => void;
}) {
  // Solo se pueden anotar las que nadie anotó todavía.
  const anotables = persona.pendientes.filter((c) => !c.reportadoEn);
  const [elegidas, setElegidas] = useState<string[]>(anotables[0] ? [anotables[0].cuotaId] : []);
  const [metodo, setMetodo] = useState<string>("pago_movil");
  const [referencia, setReferencia] = useState("");
  const [montoBs, setMontoBs] = useState("");
  const [canal, setCanal] = useState<string>("whatsapp");
  const [nota, setNota] = useState("");
  const [errorBs, setErrorBs] = useState<string | null>(null);

  const enBs = METODOS_EN_BS.has(metodo);
  const bsLeido = enBs ? parsearMontoBs(montoBs) : null;
  const total = Math.round(
    anotables.filter((c) => elegidas.includes(c.cuotaId)).reduce((s, c) => s + c.montoUsd, 0) * 100
  ) / 100;

  function alternar(id: string) {
    setElegidas((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <form
      className="rounded-lg border border-neutral-300 bg-white p-3 space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        // Solo lo que se VE marcado. Si la pantalla se refrescó y una cuota
        // salió de la lista, su id no viaja aunque siga en el estado.
        const visibles = new Set(anotables.map((c) => c.cuotaId));
        const bs = enBs ? parsearMontoBs(montoBs) : null;
        if (enBs && bs == null) {
          setErrorBs("No entendí ese monto. Escríbelo como en el comprobante, por ejemplo 23.534,75.");
          return;
        }
        setErrorBs(null);
        onEnviar({
          cuotaIds: elegidas.filter((id) => visibles.has(id)),
          grupoId: persona.grupoId,
          metodoPago: metodo,
          referenciaPago: referencia,
          canal,
          ...(enBs && bs != null ? { montoBs: bs } : {}),
          ...(nota.trim() ? { nota: nota.trim() } : {}),
        });
      }}
    >
      <div>
        <p className="text-xs font-medium text-neutral-700">¿Qué cubre este pago?</p>
        <p className="text-[11px] text-neutral-500 mb-1.5">
          Marca todas las cuotas que cubrió. Si mandó un solo pago por dos, se anotan juntas con la misma referencia.
        </p>
        <div className="flex flex-col gap-1">
          {anotables.map((c) => (
            <label key={c.cuotaId} className="flex items-center gap-2.5 min-h-11 cursor-pointer">
              <input
                type="checkbox"
                checked={elegidas.includes(c.cuotaId)}
                onChange={() => alternar(c.cuotaId)}
                className="h-5 w-5 shrink-0 accent-[#3F0A62]"
              />
              <span className="text-sm">
                {c.etiqueta} · <span className="font-semibold tabular-nums">{formatoUsd(c.montoUsd)}</span>
                <span className="text-neutral-500 text-xs"> · vence {fechaCorta(c.venceEl)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <p className="text-xs text-neutral-700 border-t border-neutral-200 pt-2">
        Vas a anotar <strong className="tabular-nums">{formatoUsd(total)}</strong>. Finanzas lo confirma después en el
        banco: todavía no queda cobrado.
      </p>

      <label className="block">
        <span className="text-xs font-medium text-neutral-700">¿Cómo pagó?</span>
        <select
          value={metodo}
          onChange={(e) => setMetodo(e.target.value)}
          className="mt-1 w-full h-11 rounded-lg border border-neutral-300 px-2 text-sm"
        >
          {METODOS.map((m) => (
            <option key={m} value={m}>
              {ETIQUETA_METODO[m] ?? m}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-neutral-700">Referencia del pago</span>
        <input
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          inputMode={enBs ? "numeric" : "text"}
          placeholder={enBs ? "Últimos dígitos de la referencia" : "Correo o usuario del pago"}
          className="mt-1 w-full h-11 rounded-lg border border-neutral-300 px-2 text-sm"
          required
        />
      </label>

      {enBs && (
        <label className="block">
          <span className="text-xs font-medium text-neutral-700">Monto exacto en bolívares</span>
          <input
            value={montoBs}
            onChange={(e) => setMontoBs(e.target.value)}
            inputMode="decimal"
            placeholder="Lo que dice su comprobante, ej: 23.534,75"
            className="mt-1 w-full h-11 rounded-lg border border-neutral-300 px-2 text-sm"
            required
          />
          {montoBs && bsLeido != null && (
            <span className="block text-[11px] text-neutral-500 mt-1 tabular-nums">Se va a guardar {formatoBs(bsLeido)}</span>
          )}
          {errorBs && <span className="block text-[11px] text-red-700 mt-1">{errorBs}</span>}
          {elegidas.length > 1 && (
            <span className="block text-[11px] text-neutral-500 mt-1">
              Escribe el total del comprobante. Se reparte entre las cuotas que marcaste, para que los bolívares
              cobrados cuadren con el banco.
            </span>
          )}
        </label>
      )}

      <label className="block">
        <span className="text-xs font-medium text-neutral-700">¿Por dónde te llegó?</span>
        <select
          value={canal}
          onChange={(e) => setCanal(e.target.value)}
          className="mt-1 w-full h-11 rounded-lg border border-neutral-300 px-2 text-sm"
        >
          {CANALES.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.etiqueta}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-neutral-700">Nota (opcional)</span>
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Ej: dijo que el resto lo paga el lunes"
          className="mt-1 w-full h-11 rounded-lg border border-neutral-300 px-2 text-sm"
        />
      </label>

      <button
        type="submit"
        disabled={procesando || elegidas.length === 0}
        className="w-full h-11 rounded-lg bg-marca-secundario text-white text-sm font-semibold disabled:opacity-50"
      >
        {procesando ? "Anotando…" : elegidas.length === 0 ? "Marca al menos una cuota" : `Anotar ${formatoUsd(total)}`}
      </button>
    </form>
  );
}
