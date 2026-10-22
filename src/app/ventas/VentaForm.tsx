"use client";

import { useRef, useState, useTransition } from "react";
import { registrarVenta } from "./actions";
import { cotizar } from "@/app/cotizar/actions";
import { CONDICIONES, fechaCorta, type PlanPublico } from "@/lib/cuotas";
import { leerPagoInicial, TEXTO_SIN_PLAN } from "@/lib/venta-cuotas";
import MapaVip, { type SillaElegida } from "@/components/MapaVip";
import type { MesaMapa } from "@/lib/mapa-vip";
import { calcularTotal, conAsiento, etiquetaTipo, MAX_POR_COMPRA, type Tipo } from "@/lib/precios";
import { convertirABs } from "@/lib/tasa";
import { metodosParaCanal, type MetodoPago } from "@/lib/pagos";

const METODOS = metodosParaCanal("manual");

export type PreventaInfo = { vip: number; general: number; precioVip: number; precioGeneral: number } | null;

export default function VentaForm({
  mesas,
  mesasPreferencial = [],
  cupoGeneralRestante,
  tasaEurVes,
  preventa,
}: {
  mesas: MesaMapa[];
  /** Vacío = la zona Preferencial no está abierta: no se muestra la pestaña. */
  mesasPreferencial?: MesaMapa[];
  cupoGeneralRestante?: number;
  tasaEurVes: number | null;
  preventa: PreventaInfo;
}) {
  const [tipo, setTipo] = useState<Tipo>("general");
  const tipos: Tipo[] = mesasPreferencial.length > 0 ? ["general", "preferencial", "vip"] : ["general", "vip"];
  const [sillas, setSillas] = useState<SillaElegida[]>([]);
  const [cantidadGeneral, setCantidadGeneral] = useState(1);
  // null = usar el sugerido; número = el vendedor lo editó (negoció).
  const [precioManual, setPrecioManual] = useState<number | null>(null);
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("transferencia");
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [pending, startTransition] = useTransition();
  // Venta en cuotas (Anita, 22 oct): sin salir a la web.
  const [forma, setForma] = useState<"contado" | "cuotas">("contado");
  const [plan, setPlan] = useState<{ estado: "cargando" } | { estado: "listo"; plan: PlanPublico } | { estado: "sin"; texto: string } | null>(null);
  const [montoPagado, setMontoPagado] = useState("");
  const [acepto, setAcepto] = useState(false);
  const [verCondiciones, setVerCondiciones] = useState(false);
  const turno = useRef(0);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cantidad = conAsiento(tipo) ? sillas.length : cantidadGeneral;
  const enCuotas = forma === "cuotas";

  // El plan lo calcula el servidor (mismo calendario, mismo tope VIP que la
  // web). Se pide desde cada cambio, no desde un efecto, y solo vale la
  // última respuesta.
  function pedirPlan(t: Tipo, n: number, f: "contado" | "cuotas") {
    if (espera.current) clearTimeout(espera.current);
    const mio = ++turno.current;
    if (f !== "cuotas" || n < 1) {
      setPlan(null);
      return;
    }
    setPlan({ estado: "cargando" });
    espera.current = setTimeout(async () => {
      const r = await cotizar({ [t]: n });
      if (mio !== turno.current) return;
      if (!r.ok) return setPlan({ estado: "sin", texto: r.error });
      const linea = r.cotizacion.lineas[0];
      if (linea?.plan) setPlan({ estado: "listo", plan: linea.plan });
      else setPlan({ estado: "sin", texto: TEXTO_SIN_PLAN[linea?.sinPlan ?? "error"] ?? TEXTO_SIN_PLAN.error });
    }, 350);
  }

  function cambiarForma(f: "contado" | "cuotas") {
    setForma(f);
    setPrecioManual(null);
    setAcepto(false);
    setMontoPagado("");
    pedirPlan(tipo, cantidad, f);
  }

  // Precio sugerido según etapa (preventa mientras quede cupo, luego regular).
  // Preferencial no tiene preventa.
  const preventaRestante = preventa ? (tipo === "vip" ? preventa.vip : tipo === "general" ? preventa.general : 0) : 0;
  const unitarioPreventa = preventa ? (tipo === "vip" ? preventa.precioVip : tipo === "general" ? preventa.precioGeneral : 0) : 0;
  const unitarioRegular = calcularTotal(tipo).total;
  const enPreventa = Math.min(cantidad, Math.max(0, preventaRestante));
  const enRegular = Math.max(0, cantidad - enPreventa);
  const sugerido = Math.round((enPreventa * unitarioPreventa + enRegular * unitarioRegular) * 100) / 100;

  const precio = precioManual ?? sugerido;
  const precioEditado = precioManual !== null;

  const enBolivares = metodoPago === "pago_movil" || metodoPago === "transferencia" || metodoPago === "efectivo_bs";
  const montoBs = enBolivares && tasaEurVes ? convertirABs(precio, tasaEurVes) : null;

  function cambiarTipo(t: Tipo) {
    setTipo(t);
    setPrecioManual(null);
    // Las sillas son de una sola zona: al cambiar de pestaña se vacían.
    if (t !== tipo) setSillas([]);
    pedirPlan(t, conAsiento(t) ? (t !== tipo ? 0 : sillas.length) : cantidadGeneral, forma);
  }

  const planListo = enCuotas && plan?.estado === "listo" ? plan.plan : null;
  const pagoHoy = planListo ? leerPagoInicial({ inicialUsd: planListo.inicial, enBs: enBolivares, tasa: tasaEurVes, texto: montoPagado }) : null;
  const siguiente = planListo?.cuotas.find((c) => !c.esInicial) ?? null;

  function onSubmit(formData: FormData) {
    setMensaje(null);
    if (conAsiento(tipo) && sillas.length === 0) {
      setMensaje({ tipo: "error", texto: "Toca una mesa y elige las sillas en el mapa antes de registrar la venta." });
      return;
    }
    startTransition(async () => {
      const res = await registrarVenta(formData);
      if (res.ok) {
        const fechas = res.plan?.cuotas.map((c) => `${c.esInicial ? "hoy" : fechaCorta(c.venceEl)} $${c.montoUsd.toFixed(2)}`).join(" · ");
        setMensaje({
          tipo: res.avisoEmail ? "error" : "ok",
          texto:
            res.avisoEmail ||
            (res.plan
              ? `Venta en cuotas registrada: ${res.cantidad} entrada${res.cantidad === 1 ? "" : "s"} por $${res.total.toFixed(2)} (${fechas}). Al cliente le llegó el correo con su plan y las condiciones. Finanzas confirma la inicial en Cobranza${res.plan.excedenteUsd > 0 ? " con “Llegó más dinero”" : ""}.`
              : `Venta registrada: ${res.cantidad} entrada${res.cantidad === 1 ? "" : "s"} por $${res.total.toFixed(2)}. Al comprador le llegó el correo de bienvenida. Pasa a Finanzas para verificar el pago.`),
        });
        (document.getElementById("venta-form") as HTMLFormElement)?.reset();
        setSillas([]);
        setCantidadGeneral(1);
        setPrecioManual(null);
        setForma("contado");
        setPlan(null);
        setMontoPagado("");
        setAcepto(false);
      } else {
        setMensaje({ tipo: "error", texto: res.error });
      }
    });
  }

  return (
    <form id="venta-form" action={onSubmit} className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex gap-2">
        {tipos.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => cambiarTipo(t)}
            className={`flex-1 rounded-md py-2 text-sm font-medium border ${
              tipo === t ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-300 text-neutral-600"
            }`}
          >
            {etiquetaTipo(t)}
          </button>
        ))}
      </div>
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="sillaIds" value={JSON.stringify(sillas.map((s) => s.id))} />
      <input type="hidden" name="precioEditado" value={precioEditado ? "1" : "0"} />

      {conAsiento(tipo) ? (
        <div>
          <label className="block text-sm font-medium mb-1">
            Sillas {etiquetaTipo(tipo)} (hasta {MAX_POR_COMPRA[tipo]})
          </label>
          <MapaVip
            key={tipo}
            zona={tipo}
            mesas={tipo === "vip" ? mesas : mesasPreferencial}
            seleccionadas={sillas}
            onCambiar={(s) => {
              setSillas(s);
              setPrecioManual(null);
              pedirPlan(tipo, s.length, forma);
            }}
            maximo={MAX_POR_COMPRA[tipo]}
            cupoGeneralRestante={cupoGeneralRestante}
          />
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium mb-1">Cantidad de entradas generales (hasta {MAX_POR_COMPRA.general})</label>
          <input
            name="cantidadGeneral"
            type="number"
            min={1}
            max={MAX_POR_COMPRA.general}
            value={cantidadGeneral}
            onChange={(e) => {
              const n = Math.max(1, Math.min(MAX_POR_COMPRA.general, Number(e.target.value) || 1));
              setCantidadGeneral(n);
              setPrecioManual(null);
              pedirPlan(tipo, n, forma);
            }}
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
          />
          <p className="text-xs text-neutral-400 mt-1">Se crea un ticket (y un QR) por cada entrada, todos al mismo correo.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Nombre del comprador</label>
          <input name="compradorNombre" required className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Teléfono (WhatsApp)</label>
          <input name="compradorTelefono" required className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Correo (para enviarle los QR)</label>
        <input name="compradorEmail" type="email" required className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Forma de pago</label>
        <div className="flex gap-2">
          {(["contado", "cuotas"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => cambiarForma(f)}
              className={`flex-1 rounded-md py-2 text-sm font-medium border ${
                forma === f ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-300 text-neutral-600"
              }`}
            >
              {f === "contado" ? "De contado" : "En cuotas (aparta con 40 %)"}
            </button>
          ))}
        </div>
        <input type="hidden" name="enCuotas" value={enCuotas ? "1" : "0"} />
        {enCuotas && (
          <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-950">
            {cantidad === 0 ? (
              <p className="text-xs">Elige las entradas para ver su plan.</p>
            ) : plan?.estado === "cargando" || plan === null ? (
              <p className="text-xs">Calculando el plan…</p>
            ) : plan.estado === "sin" ? (
              <p className="text-xs font-medium text-red-800">{plan.texto} Esta venta va de contado.</p>
            ) : (
              <>
                <p className="text-xs font-semibold mb-1">Su plan ({etiquetaTipo(tipo, cantidad)} · ${plan.plan.total.toFixed(2)})</p>
                <ul className="text-xs space-y-0.5 tabular-nums">
                  {plan.plan.cuotas.map((c) => (
                    <li key={c.orden} className="flex justify-between gap-2">
                      <span>{c.esInicial ? "Hoy · inicial" : `${c.etiqueta} · ${fechaCorta(c.venceEl)}`}</span>
                      <strong>${c.monto.toFixed(2)}</strong>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] mt-1 text-sky-900">
                  Hoy paga la inicial{enBolivares && tasaEurVes ? ` (Bs ${convertirABs(plan.plan.inicial, tasaEurVes).toLocaleString("es-VE")} a la tasa de hoy)` : ""}. Sus QR le llegan cuando completa el último pago.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Precio total (USD)</label>
          <input
            name="precio"
            type="number"
            step="0.01"
            required
            value={precio}
            readOnly={enCuotas}
            onChange={(e) => setPrecioManual(Number(e.target.value))}
            className={`w-full border border-neutral-300 rounded-md px-3 py-2 text-sm ${enCuotas ? "bg-neutral-100 text-neutral-600" : ""}`}
          />
          <p className="text-xs text-neutral-400 mt-1">
            {enCuotas ? (cantidad === 0 ? "Elige las entradas para ver el precio." : `En cuotas el precio es el de lista: $${sugerido.toFixed(2)}.`) : cantidad === 0
              ? "Elige las entradas para ver el precio sugerido."
              : enPreventa > 0 && enRegular > 0
              ? `${enPreventa} × $${unitarioPreventa.toFixed(2)} preventa + ${enRegular} × $${unitarioRegular.toFixed(2)} = $${sugerido.toFixed(2)}. Editable si negociaste otro precio.`
              : enPreventa > 0
              ? `${cantidad} × $${unitarioPreventa.toFixed(2)} (preventa) = $${sugerido.toFixed(2)}. Editable si negociaste otro precio.`
              : `${cantidad} × $${unitarioRegular.toFixed(2)} = $${sugerido.toFixed(2)}. Editable si negociaste otro precio.`}
            {precioEditado && !enCuotas && (
              <button type="button" onClick={() => setPrecioManual(null)} className="ml-2 underline">
                usar sugerido
              </button>
            )}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Método de pago</label>
          <select
            name="metodoPago"
            required
            value={metodoPago}
            onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
          >
            {METODOS.map((m) => (
              <option key={m.valor} value={m.valor} disabled={!m.activo}>
                {m.etiqueta}
                {!m.activo ? " — muy pronto" : ""}
              </option>
            ))}
          </select>
          {enBolivares && (
            <p className="text-xs text-neutral-500 mt-1">
              {enCuotas
                ? planListo && tasaEurVes
                  ? `Hoy paga la inicial: Bs ${convertirABs(planListo.inicial, tasaEurVes).toLocaleString("es-VE")} (tasa del día)`
                  : "Hoy paga solo la inicial."
                : montoBs !== null
                ? `≈ Bs ${montoBs.toLocaleString("es-VE")} (tasa del día)`
                : "Tasa del día aún no disponible — usa el monto en USD como referencia."}
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">{enCuotas ? "Referencia del pago inicial" : "Referencia del pago"}</label>
        <input name="referenciaPago" className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" placeholder="Últimos dígitos, número de confirmación…" />
      </div>

      {enCuotas && planListo && (
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3">
          <div>
            <label className="block text-sm font-medium mb-1">
              ¿Pagó más que la inicial? {enBolivares ? "Bolívares que pagó" : "Dólares que pagó"} <span className="font-normal text-neutral-400">(opcional)</span>
            </label>
            <input
              name="montoPagado"
              inputMode="decimal"
              value={montoPagado}
              onChange={(e) => setMontoPagado(e.target.value)}
              placeholder={
                enBolivares && tasaEurVes
                  ? `Vacío = la inicial justa (Bs ${convertirABs(planListo.inicial, tasaEurVes).toLocaleString("es-VE")})`
                  : `Vacío = la inicial justa ($${planListo.inicial.toFixed(2)})`
              }
              className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
            />
            {montoPagado.trim() && pagoHoy && (
              <p className={`text-xs mt-1 ${pagoHoy.ok ? "text-sky-900" : "text-red-700"}`}>
                {!pagoHoy.ok
                  ? pagoHoy.error
                  : pagoHoy.excedenteUsd > 0 && siguiente
                  ? `Pagó $${pagoHoy.pagadoUsd.toFixed(2)}: $${pagoHoy.excedenteUsd.toFixed(2)} de más. Finanzas lo aprueba con “Llegó más dinero” y la ${siguiente.etiqueta} baja a $${Math.max(0, siguiente.monto - pagoHoy.excedenteUsd).toFixed(2)}.`
                  : "Pagó la inicial justa."}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">¿Por dónde se hizo la venta?</label>
            <select name="canalVenta" defaultValue="whatsapp" className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm">
              <option value="whatsapp">WhatsApp</option>
              <option value="presencial">Presencial (punto de venta)</option>
              <option value="llamada">Llamada</option>
            </select>
          </div>
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
            <label className="flex items-start gap-2 text-sm text-amber-950">
              <input type="checkbox" name="aceptoCondiciones" value="1" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} className="mt-1" />
              <span>
                <strong>El cliente aceptó las condiciones del plan.</strong> Le expliqué que cada pago tiene su fecha y que si no paga a tiempo se anula
                la compra y lo abonado no se devuelve.{" "}
                <button type="button" onClick={() => setVerCondiciones((x) => !x)} className="underline">
                  {verCondiciones ? "Ocultar" : "Leerlas"}
                </button>
              </span>
            </label>
            {verCondiciones && (
              <ol className="mt-2 list-decimal pl-5 text-xs text-amber-950 space-y-1">
                {CONDICIONES.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ol>
            )}
            <p className="text-[11px] text-amber-900 mt-1">Al cliente le llega un correo con su plan, sus fechas y estas condiciones por escrito.</p>
          </div>
        </div>
      )}

      {mensaje && (
        <div
          role={mensaje.tipo === "ok" ? "status" : "alert"}
          className={`rounded-lg border px-3 py-2.5 text-sm font-medium ${
            mensaje.tipo === "ok" ? "bg-green-50 border-green-300 text-green-800" : "bg-red-50 border-red-300 text-red-800"
          }`}
        >
          {mensaje.texto}
        </div>
      )}

      <button
        type="submit"
        disabled={pending || cantidad === 0 || (enCuotas && (!planListo || !acepto || (pagoHoy !== null && !pagoHoy.ok)))}
        className="bg-neutral-900 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending
          ? "Registrando…"
          : enCuotas
          ? `Registrar venta en cuotas${cantidad > 1 ? ` (${cantidad} entradas)` : ""}`
          : cantidad > 1
          ? `Registrar venta (${cantidad} entradas)`
          : "Registrar venta"}
      </button>
    </form>
  );
}
