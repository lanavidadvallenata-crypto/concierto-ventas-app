"use client";

import { useState, useTransition } from "react";
import type { CuotaPorCobrar, ListaCobranza } from "@/lib/abona618";
import { registrarPagoDeCuota, aprobarCuota, anularPorFaltaDePago } from "./actions";
import { ETIQUETA_METODO, METODOS_EN_BS, NOTA_TASA_CORTA, SIN_TASA, formatoBs, formatoBsAprox, formatoUsd } from "@/lib/formato";
import { convertirABs } from "@/lib/tasa";
import { fechaCorta } from "@/lib/cuotas";
import { codigoCompra } from "@/lib/compra";

// El equipo trabaja desde el teléfono (es la razón por la que la barra de
// navegación se rehizo en dos filas), así que esta pantalla es una sola
// columna de tarjetas con área táctil grande, no una tabla.

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

/** 0414-1234567 → 584141234567, que es lo que wa.me necesita. */
function paraWhatsApp(telefono: string | null): string | null {
  if (!telefono) return null;
  const d = telefono.replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.startsWith("58")) return d;
  return `58${d.replace(/^0+/, "")}`;
}

function mensajeWhatsApp(c: CuotaPorCobrar, grupo: Grupo, tasaEurVes: number | null): string {
  const nombre = (c.compradorNombre ?? "").split(" ")[0] || "";
  const hola = nombre ? `Hola ${nombre}` : "Hola";
  // El monto en bolívares va en el mensaje, pero SIEMPRE con "hoy" pegado:
  // mañana es otro número, y quien recibe el mensaje tiene que saberlo antes
  // de transferir de menos.
  const enBs = tasaEurVes ? ` (hoy son ${formatoBs(convertirABs(c.montoUsd, tasaEurVes))} a la tasa BCV euro)` : "";
  const monto = `${formatoUsd(c.montoUsd)}${enBs}`;
  const cuando = fechaCorta(c.venceEl);

  if (grupo === "enGracia") {
    return (
      `${hola}, te escribo de La Navidad Vallenata. Tu pago de ${monto} venció el ${cuando} ` +
      `y todavía no nos ha llegado. Tienes plazo hasta hoy para completarlo; si no, tu entrada se libera ` +
      `y lo que ya abonaste no se devuelve. ¿Te ayudo con los datos de pago?`
    );
  }
  if (grupo === "vencenHoy") {
    return (
      `${hola}, te escribo de La Navidad Vallenata. Hoy vence tu pago de ${monto}. ` +
      `Cuando lo hagas, mándame la referencia por aquí y yo lo registro. ¿Te paso los datos?`
    );
  }
  if (grupo === "paraAnular") {
    return (
      `${hola}, te escribo de La Navidad Vallenata. Tu pago de ${monto} venció el ${cuando} ` +
      `y se pasó el plazo. Antes de liberar tu entrada quería confirmarte si lo pagaste. ` +
      `Si tienes la referencia, mándamela ya mismo.`
    );
  }
  return (
    `${hola}, te escribo de La Navidad Vallenata. Te recuerdo que el ${cuando} vence tu pago de ${monto} ` +
    `(te falta ${formatoUsd(c.saldo)} para completar tu entrada). Cuando pagues, mándame la referencia por aquí.`
  );
}

type Grupo = "porVerificar" | "vencenHoy" | "enGracia" | "paraAnular" | "proximas" | "masAdelante";

const SECCIONES: { clave: Grupo; titulo: string; nota: string; tono: string }[] = [
  {
    clave: "enGracia",
    titulo: "En plazo de gracia",
    nota: "Ya vencieron. Última llamada antes de liberar la entrada.",
    tono: "border-red-300 bg-red-50",
  },
  {
    clave: "vencenHoy",
    titulo: "Vencen hoy",
    nota: "Escríbeles hoy mismo.",
    tono: "border-amber-300 bg-amber-50",
  },
  {
    clave: "porVerificar",
    titulo: "Anotados, por confirmar en el banco",
    nota: "Trabajo de Finanzas: confirmar que el dinero entró.",
    tono: "border-sky-300 bg-sky-50",
  },
  {
    clave: "paraAnular",
    titulo: "Se pasó el plazo",
    nota: "Hay que anular y devolver la entrada a la venta.",
    tono: "border-neutral-400 bg-neutral-100",
  },
  {
    clave: "proximas",
    titulo: "Próximas a vencer",
    nota: "Recordatorio suave, sin apuro.",
    tono: "border-neutral-200 bg-white",
  },
  {
    clave: "masAdelante",
    titulo: "Más adelante",
    nota: "Todavía no hay que llamarlos. Aquí se anotan los que adelantan su pago.",
    tono: "border-neutral-200 bg-white",
  },
];

export default function CobranzaList({
  lista,
  hoy,
  miRol,
  nombrePorId,
  moduloActivo,
  topeVip,
  tasaEurVes,
}: {
  lista: ListaCobranza;
  hoy: string;
  miRol: string;
  nombrePorId: Record<string, string>;
  moduloActivo: boolean;
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

  const puedeAprobar = miRol === "finanzas" || miRol === "admin";

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
      setProcesando(null);
      setConfirmando(null);
      if (!res.ok) {
        poner(id, { tipo: "error", texto: res.error ?? "No se pudo completar." });
        return;
      }
      setAbierto(null);
      poner(id, { tipo: "ok", texto: res.aviso ?? "Listo." });
    });
  }

  const totalPorCobrar = [
    ...lista.enGracia,
    ...lista.vencenHoy,
    ...lista.porVerificar,
    ...lista.paraAnular,
    ...lista.proximas,
    ...lista.masAdelante,
  ].length;

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold">Cobranza de cuotas</h1>
        {!moduloActivo && (
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

      {totalPorCobrar === 0 && (
        <p className="text-sm text-neutral-500 py-6 text-center">
          No hay cuotas por cobrar ahora mismo. Nada pendiente.
        </p>
      )}

      {SECCIONES.map((sec) => {
        const items = lista[sec.clave];
        if (items.length === 0) return null;
        return (
          <section key={sec.clave} className="space-y-2">
            <div>
              <h2 className="text-sm font-semibold">
                {sec.titulo} <span className="text-neutral-400 font-normal">· {items.length}</span>
              </h2>
              <p className="text-xs text-neutral-500">{sec.nota}</p>
            </div>

            {items.map((c) => {
              const wa = paraWhatsApp(c.compradorTelefono);
              const aviso = avisos[c.cuotaId];
              const esteProcesando = procesando === c.cuotaId;
              const enBs = METODOS_EN_BS.has(c.metodoPago ?? "");

              return (
                <article key={c.cuotaId} className={`rounded-xl border px-3 py-3 space-y-2 ${sec.tono}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {c.compradorNombre ?? "Sin nombre"}
                        <span className="text-neutral-400 font-normal font-mono text-xs"> · {codigoCompra(c.grupoId)}</span>
                      </p>
                      <p className="text-xs text-neutral-600">
                        {c.cantidad} {c.tipo === "vip" ? (c.cantidad === 1 ? "VIP" : "VIP") : c.cantidad === 1 ? "General" : "Generales"}
                        {" · "}
                        {c.etiqueta}
                        {" · vence "}
                        {fechaCorta(c.venceEl)}
                        {c.diasParaVencer < 0 && ` (${-c.diasParaVencer} ${-c.diasParaVencer === 1 ? "día" : "días"} tarde)`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-sm tabular-nums">{formatoUsd(c.montoUsd)}</div>
                      <div className="text-[11px] text-neutral-600 tabular-nums">
                        {tasaEurVes ? formatoBsAprox(convertirABs(c.montoUsd, tasaEurVes)) : SIN_TASA}
                      </div>
                      <div className="text-[11px] text-neutral-500">de {formatoUsd(c.totalUsd)}</div>
                    </div>
                  </div>

                  <p className="text-xs text-neutral-600">
                    Pagado {formatoUsd(c.pagado)} · <strong>falta {formatoUsd(c.saldo)}</strong>
                    {tasaEurVes ? <span className="text-neutral-500"> ({formatoBsAprox(convertirABs(c.saldo, tasaEurVes))})</span> : null}
                  </p>

                  {c.reportadoEn && (
                    <div className="text-xs rounded-md bg-white/70 border border-neutral-200 px-2 py-1.5 space-y-0.5">
                      <p>
                        <strong>{ETIQUETA_METODO[c.metodoPago ?? ""] ?? c.metodoPago}</strong>
                        {c.referenciaPago ? ` · ref. ${c.referenciaPago}` : ""}
                        {enBs && c.montoBs != null ? ` · ${formatoBs(c.montoBs)}` : ""}
                      </p>
                      <p className="text-neutral-500">
                        {c.reportadoPor
                          ? `Anotado por ${nombrePorId[c.reportadoPor] ?? "alguien del equipo"}${c.canalReporte ? ` (${c.canalReporte})` : ""}`
                          : "Lo reportó el comprador desde su página"}
                      </p>
                      {c.nota && <p className="text-neutral-600 italic">“{c.nota}”</p>}
                    </div>
                  )}

                  {aviso && (
                    <p
                      className={`text-xs rounded-md px-2 py-1.5 ${
                        aviso.tipo === "ok" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"
                      }`}
                    >
                      {aviso.texto}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {!wa && (
                      <span className="h-11 px-1 inline-flex items-center text-xs text-neutral-500">
                        {c.compradorEmail ? `Sin WhatsApp · ${c.compradorEmail}` : "Sin teléfono ni correo"}
                      </span>
                    )}
                    {wa && (
                      <a
                        href={`https://wa.me/${wa}?text=${encodeURIComponent(mensajeWhatsApp(c, sec.clave, tasaEurVes))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-11 px-3 inline-flex items-center rounded-lg bg-[#25D366] text-white text-sm font-semibold"
                      >
                        WhatsApp
                      </a>
                    )}

                    {sec.clave === "porVerificar" ? (
                      puedeAprobar ? (
                        <button
                          type="button"
                          disabled={esteProcesando}
                          onClick={() => correr(c.cuotaId, () => aprobarCuota(c.cuotaId))}
                          className="h-11 px-3 rounded-lg bg-marca-secundario text-white text-sm font-semibold disabled:opacity-50"
                        >
                          {esteProcesando ? "Confirmando…" : "Confirmé el dinero en el banco"}
                        </button>
                      ) : (
                        <span className="h-11 px-1 inline-flex items-center text-xs text-neutral-500">
                          Esperando a Finanzas
                        </span>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAbierto(abierto === c.cuotaId ? null : c.cuotaId)}
                        className="h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm font-semibold"
                      >
                        {abierto === c.cuotaId ? "Cerrar" : "Anotar su pago"}
                      </button>
                    )}

                    {sec.clave === "paraAnular" && puedeAprobar && (
                      confirmando === c.cuotaId ? (
                        <button
                          type="button"
                          disabled={esteProcesando}
                          onClick={() => correr(c.cuotaId, () => anularPorFaltaDePago(c.grupoId))}
                          className="h-11 px-3 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
                        >
                          {esteProcesando ? "Anulando…" : "Sí, anular y revender"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmando(c.cuotaId)}
                          className="h-11 px-3 rounded-lg border border-red-300 text-red-700 bg-white text-sm font-semibold"
                        >
                          Anular por falta de pago
                        </button>
                      )
                    )}
                  </div>

                  {abierto === c.cuotaId && (
                    <FormularioPago
                      cuota={c}
                      procesando={esteProcesando}
                      onEnviar={(datos) => correr(c.cuotaId, () => registrarPagoDeCuota(datos))}
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
  cuota,
  procesando,
  onEnviar,
}: {
  cuota: CuotaPorCobrar;
  procesando: boolean;
  onEnviar: (datos: Record<string, unknown>) => void;
}) {
  const [metodo, setMetodo] = useState<string>("pago_movil");
  const [referencia, setReferencia] = useState("");
  const [montoBs, setMontoBs] = useState("");
  const [canal, setCanal] = useState<string>("whatsapp");
  const [nota, setNota] = useState("");

  const enBs = METODOS_EN_BS.has(metodo);

  return (
    <form
      className="rounded-lg border border-neutral-300 bg-white p-3 space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onEnviar({
          cuotaId: cuota.cuotaId,
          grupoId: cuota.grupoId,
          metodoPago: metodo,
          referenciaPago: referencia,
          canal,
          ...(enBs && montoBs ? { montoBs: Number(montoBs.replace(",", ".")) } : {}),
          ...(nota.trim() ? { nota: nota.trim() } : {}),
        });
      }}
    >
      <p className="text-xs text-neutral-600">
        Anota el pago de <strong>{formatoUsd(cuota.montoUsd)}</strong> tal como te lo mandó. Finanzas lo confirma
        después en el banco: todavía no queda cobrado.
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
            placeholder="Lo que dice su comprobante"
            className="mt-1 w-full h-11 rounded-lg border border-neutral-300 px-2 text-sm"
            required
          />
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
        disabled={procesando}
        className="w-full h-11 rounded-lg bg-marca-secundario text-white text-sm font-semibold disabled:opacity-50"
      >
        {procesando ? "Anotando…" : "Anotar el pago"}
      </button>
    </form>
  );
}
