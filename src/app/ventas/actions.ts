"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { enviarCorreoPendiente } from "@/lib/enviar-qr";
import { lineasDeAsientos } from "@/lib/asiento";
import { conAsiento, cotizarCompra, MAX_POR_COMPRA, TIPOS, type Tipo } from "@/lib/precios";
import { metodoEsEnBs, metodosParaCanal, normalizarReferencia, validarReferencia, type MetodoPago } from "@/lib/pagos";
import { registrarVentaInterna } from "@/lib/registrar-venta";
import { crearPlan, planOfrecible } from "@/lib/abona618";
import { CONDICIONES, CONDICIONES_VERSION, usd } from "@/lib/cuotas";
import { leerPagoInicial, TEXTO_SIN_PLAN } from "@/lib/venta-cuotas";
import { obtenerTasaActual } from "@/lib/tasa";

const ventaSchema = z.object({
  tipo: z.enum(TIPOS as [Tipo, ...Tipo[]]),
  sillaIds: z.string().optional(), // JSON array de uuids (VIP / Preferencial)
  cantidadGeneral: z.coerce.number().int().min(1).max(MAX_POR_COMPRA.general).optional(),
  compradorNombre: z.string().trim().min(2, "Escribe el nombre del comprador."),
  compradorTelefono: z.string().trim().min(7, "Escribe un teléfono válido."),
  compradorEmail: z.string().trim().toLowerCase().email("Correo inválido — es la única forma de enviar el QR de entrada."),
  precio: z.coerce.number().positive(),
  // "1" solo si el vendedor editó el precio a mano; si no, se usa la
  // cotización del servidor (el precio en pantalla puede estar desactualizado).
  precioEditado: z.string().optional(),
  metodoPago: z.enum(["pago_movil", "transferencia", "zelle", "binance", "efectivo_usd", "efectivo_bs"]),
  referenciaPago: z.string().trim().optional(),
  // Venta en cuotas (Anita, 22 oct): "1" = en cuotas. Va con la casilla de
  // condiciones, por dónde se hizo la venta y, si pagó de más, cuánto pagó.
  enCuotas: z.string().optional(),
  aceptoCondiciones: z.string().optional(),
  canalVenta: z.enum(["whatsapp", "presencial", "llamada"]).optional(),
  montoPagado: z.string().trim().max(30).optional(),
});

export type RegistrarVentaResult =
  | {
      ok: true;
      avisoEmail?: string;
      cantidad: number;
      total: number;
      /** Solo en ventas en cuotas: lo que quedó, para decírselo a la vendedora. */
      plan?: { cuotas: { etiqueta: string; montoUsd: number; venceEl: string; esInicial: boolean }[]; excedenteUsd: number };
    }
  | { ok: false; error: string };

// Mismo patrón que requiereFinanzas/requiereAdmin.
async function requiereVentas() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, error: "Tu sesión expiró — vuelve a entrar." };

  const service = createServiceClient();
  const { data: perfil } = await service.from("perfiles").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.activo || (perfil.rol !== "ventas" && perfil.rol !== "finanzas" && perfil.rol !== "admin")) {
    return { user: null, error: "No tienes permiso para registrar ventas." };
  }
  return { user, error: null };
}

export async function registrarVenta(formData: FormData): Promise<RegistrarVentaResult> {
  const { user, error: authError } = await requiereVentas();
  if (!user) return { ok: false, error: authError! };

  const parsed = ventaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos del formulario — falta o sobra algo." };
  }
  const v = parsed.data;

  if (!metodosParaCanal("manual").some((m) => m.valor === v.metodoPago && m.activo)) {
    return { ok: false, error: "Ese método de pago no está disponible." };
  }

  let sillaIds: string[] = [];
  if (conAsiento(v.tipo)) {
    try {
      const arr = JSON.parse(v.sillaIds ?? "[]");
      sillaIds = Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
    } catch {
      sillaIds = [];
    }
    if (sillaIds.length === 0) return { ok: false, error: "Selecciona al menos una silla en el mapa." };
  }

  const service = createServiceClient();
  if (v.enCuotas === "1") return registrarVentaEnCuotas(service, user.id, v, sillaIds);

  const { data: perfil } = await service.from("perfiles").select("rol").eq("id", user.id).maybeSingle();
  const esAdmin = perfil?.rol === "admin";
  const res = await registrarVentaInterna(service, {
    tipo: v.tipo,
    sillaIds,
    cantidad: v.cantidadGeneral ?? 1,
    compradorNombre: v.compradorNombre,
    compradorTelefono: v.compradorTelefono,
    compradorEmail: v.compradorEmail,
    metodoPago: v.metodoPago,
    referenciaPago: v.referenciaPago || null,
    precioTotalManual: v.precioEditado === "1" ? v.precio : null,
    // Ventas/finanzas pueden negociar hasta 30 % de descuento; admin sin tope.
    pisoPrecio: esAdmin ? undefined : 0.7,
    vendidoPor: user.id,
    canal: "manual",
    verificarDeInmediato: false,
  });
  if (!res.ok) return res;

  revalidatePath("/ventas");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
  revalidatePath("/comprar");

  let avisoEmail: string | undefined;
  const asientos = await lineasDeAsientos(service, v.tipo, sillaIds);
  try {
    await enviarCorreoPendiente({
      destinatario: v.compradorEmail,
      nombreComprador: v.compradorNombre,
      cantidad: res.cantidad,
      tipo: v.tipo,
      totalUsd: res.total,
      totalBs: res.totalBs,
      referencia: v.referenciaPago || null,
      grupoId: res.grupoId,
      asientos,
    });
  } catch {
    avisoEmail = "La venta quedó registrada, pero el correo de bienvenida no se pudo enviar — avísale al comprador por WhatsApp que su pago está en verificación.";
  }

  return { ok: true, avisoEmail, cantidad: res.cantidad, total: res.total };
}

type ServiceClient = ReturnType<typeof createServiceClient>;
type DatosVenta = z.infer<typeof ventaSchema>;

/**
 * Venta en cuotas registrada por una vendedora (Anita, 22 oct). Antes había
 * que salir a lanavidadvallenata.com y comprar como si fuera el cliente, y
 * cuando no se hacía así la venta quedaba de contado con sus QR (Rene,
 * Orianyelis). Es el mismo plan que arma la web — mismo calendario, mismas
 * condiciones, mismo tope VIP — con tres diferencias que importan:
 *
 * - La inicial queda anotada POR la vendedora, así el control cruzado de
 *   Cobranza no la deja aprobar su propia venta.
 * - El cliente no marcó la casilla: la marca la vendedora, y al cliente le
 *   llega el correo con su calendario y las condiciones por escrito.
 * - Si pagó más que la inicial, se guardan los bolívares reales y una nota:
 *   Finanzas lo aprueba con "Llegó más dinero" y la próxima cuota baja sola.
 *
 * No se negocia el precio: el plan sale del precio de lista, igual que en la web.
 */
async function registrarVentaEnCuotas(service: ServiceClient, vendedoraId: string, v: DatosVenta, sillaIds: string[]): Promise<RegistrarVentaResult> {
  if (v.aceptoCondiciones !== "1") {
    return { ok: false, error: "Marca la casilla: el cliente tiene que haber aceptado las condiciones del plan." };
  }
  if (v.precioEditado === "1") {
    return { ok: false, error: "En cuotas no se cambia el precio: el plan sale del precio de lista. Usa \"usar sugerido\"." };
  }
  if (!v.canalVenta) return { ok: false, error: "Elige por dónde se hizo la venta." };
  const metodo = v.metodoPago as MetodoPago;
  const esEfectivo = metodo === "efectivo_usd" || metodo === "efectivo_bs";
  const referencia = v.referenciaPago ? normalizarReferencia(metodo, v.referenciaPago) : "";
  if (!esEfectivo) {
    if (!referencia) return { ok: false, error: "Escribe la referencia del pago inicial: es lo que Finanzas busca en el banco." };
    const errorRef = validarReferencia(metodo, referencia);
    if (errorRef) return { ok: false, error: errorRef };
  }

  const cantidad = conAsiento(v.tipo) ? sillaIds.length : (v.cantidadGeneral ?? 1);
  const enBs = metodoEsEnBs(metodo);

  // Se mira ANTES de apartar nada: si no hay plan, no se crea la venta.
  const { cotizacion } = await cotizarCompra(service, v.tipo, cantidad);
  const previa = await planOfrecible(service, { tipo: v.tipo, cantidad, total: cotizacion.total, canal: "manual" });
  if (!previa.plan.hayPlan) return { ok: false, error: TEXTO_SIN_PLAN[previa.plan.motivo] ?? TEXTO_SIN_PLAN.error };

  const tasa = enBs ? await obtenerTasaActual(service) : null;
  const pago = leerPagoInicial({ inicialUsd: previa.plan.inicial, enBs, tasa, texto: v.montoPagado });
  if (!pago.ok) return { ok: false, error: pago.error };
  // Lo pagado de más se descuenta de la cuota siguiente al aprobar ("Llegó
  // más dinero"). Si alcanza para esa cuota entera, el sistema no lo mueve:
  // mejor saberlo ahora que con la venta hecha.
  const siguientePrevia = previa.plan.cuotas.find((c) => !c.esInicial);
  if (pago.excedenteUsd > 0 && siguientePrevia && pago.excedenteUsd >= siguientePrevia.monto - 0.009) {
    return {
      ok: false,
      error: `Pagó ${usd(pago.pagadoUsd)}: alcanza para la inicial y la ${siguientePrevia.etiqueta} completa. Ese caso no va por aquí: consúltalo con Finanzas antes de registrarlo.`,
    };
  }

  const res = await registrarVentaInterna(service, {
    tipo: v.tipo,
    sillaIds,
    cantidad,
    compradorNombre: v.compradorNombre,
    compradorTelefono: v.compradorTelefono,
    compradorEmail: v.compradorEmail,
    metodoPago: metodo,
    referenciaPago: referencia || null,
    precioTotalManual: null,
    vendidoPor: vendedoraId,
    canal: "manual",
    verificarDeInmediato: false,
  });
  if (!res.ok) return res;

  // Deshace la venta si el plan no se pudo guardar: sin plan sería una venta
  // de contado pendiente por el total, que no es lo que se le vendió.
  async function deshacer(motivo: string): Promise<RegistrarVentaResult> {
    await service.from("tickets").update({ estado_pago: "rechazado" }).eq("grupo_id", res.ok ? res.grupoId : "").eq("estado_pago", "pendiente");
    if (sillaIds.length) await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).in("id", sillaIds);
    revalidar();
    return { ok: false, error: `${motivo} No quedó nada registrado: vuelve a intentarlo.` };
  }

  // El total real de la venta (la etapa pudo cambiar en estos segundos).
  const ahora = res.total === cotizacion.total ? previa : await planOfrecible(service, { tipo: v.tipo, cantidad: res.cantidad, total: res.total, canal: "manual" });
  if (!ahora.plan.hayPlan) return deshacer(TEXTO_SIN_PLAN[ahora.plan.motivo] ?? TEXTO_SIN_PLAN.error);
  const plan = ahora.plan;
  const pagoFinal = plan.inicial === previa.plan.inicial ? pago : leerPagoInicial({ inicialUsd: plan.inicial, enBs, tasa, texto: v.montoPagado });
  if (!pagoFinal.ok) return deshacer(pagoFinal.error);

  const creado = await crearPlan(service, {
    grupoId: res.grupoId,
    total: res.total,
    tipo: v.tipo,
    cantidad: res.cantidad,
    cuotas: plan.cuotas,
    canal: "manual",
    creadoPor: vendedoraId,
    condicionesVersion: CONDICIONES_VERSION,
    metodoPago: metodo,
    referenciaPago: referencia || null,
    montoBsInicial: pagoFinal.pagadoBs,
    tasaAplicada: enBs ? tasa : null,
    reportadoPor: vendedoraId,
    canalReporte: v.canalVenta,
    notaInicial:
      pagoFinal.excedenteUsd > 0
        ? `Pagó ${usd(pagoFinal.pagadoUsd)}${pagoFinal.pagadoBs != null ? ` (Bs ${pagoFinal.pagadoBs.toLocaleString("es-VE", { minimumFractionDigits: 2 })})` : ""}: ${usd(pagoFinal.excedenteUsd)} más que la inicial. Al aprobar, usa "Llegó más dinero".`
        : null,
  });
  if (!creado.ok) {
    console.error(`Ventas en cuotas: no se pudo crear el plan del grupo ${res.grupoId} — se deshace la venta.`);
    return deshacer("No se pudo guardar el plan de cuotas.");
  }

  revalidar();

  // Lo que va a quedar cuando Finanzas confirme el pago: si pagó de más, la
  // inicial es lo que pagó y la cuota siguiente baja lo mismo.
  const calendario = plan.cuotas.map((c) => ({ etiqueta: c.etiqueta, montoUsd: c.monto, venceEl: c.venceEl, esInicial: c.esInicial }));
  const iSiguiente = calendario.findIndex((c) => !c.esInicial);
  if (pagoFinal.excedenteUsd > 0 && iSiguiente > 0 && calendario[iSiguiente].montoUsd - pagoFinal.excedenteUsd >= 0.01) {
    calendario[0] = { ...calendario[0], montoUsd: pagoFinal.pagadoUsd };
    calendario[iSiguiente] = {
      ...calendario[iSiguiente],
      montoUsd: Math.round((calendario[iSiguiente].montoUsd - pagoFinal.excedenteUsd) * 100) / 100,
    };
  }
  let avisoEmail: string | undefined;
  const asientos = await lineasDeAsientos(service, v.tipo, sillaIds);
  try {
    await enviarCorreoPendiente({
      destinatario: v.compradorEmail,
      nombreComprador: v.compradorNombre,
      cantidad: res.cantidad,
      tipo: v.tipo,
      totalUsd: res.total,
      referencia: referencia || null,
      grupoId: res.grupoId,
      plan: { inicialUsd: pagoFinal.pagadoUsd, inicialBs: pagoFinal.pagadoBs, calendario, condiciones: CONDICIONES },
      asientos,
    });
  } catch {
    avisoEmail = "La venta en cuotas quedó registrada, pero el correo con su plan no salió: mándale por WhatsApp sus fechas y las condiciones.";
  }

  return { ok: true, avisoEmail, cantidad: res.cantidad, total: res.total, plan: { cuotas: calendario, excedenteUsd: pagoFinal.excedenteUsd } };
}

function revalidar() {
  revalidatePath("/ventas");
  revalidatePath("/finanzas");
  revalidatePath("/cobranza");
  revalidatePath("/dashboard");
  revalidatePath("/comprar");
}
