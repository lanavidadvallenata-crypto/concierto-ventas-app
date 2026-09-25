import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cotizarCompra, cotizar, disponibilidadEtapas, MAX_POR_COMPRA, type Etapa, type Tipo } from "@/lib/precios";
import { metodoEsEnBs, type Canal, type MetodoPago } from "@/lib/pagos";
import { obtenerTasaActual, convertirABs, repartirBs } from "@/lib/tasa";

export type DatosVentaInterna = {
  tipo: Tipo;
  sillaIds: string[]; // VIP: una por ticket
  cantidad: number; // General
  compradorNombre: string;
  compradorTelefono: string;
  compradorEmail: string | null;
  metodoPago: MetodoPago;
  referenciaPago: string | null;
  // Precio TOTAL de la compra si el vendedor lo editó (negoció). null = el de la etapa.
  precioTotalManual: number | null;
  // Taquilla vende siempre a precio regular (no consume preventa).
  etapaForzada?: Etapa;
  vendidoPor: string;
  canal: Canal;
  // Taquilla: queda verificada de una (el vendedor tiene el dinero en la mano).
  verificarDeInmediato: boolean;
  // Piso de precio negociado como fracción del cotizado (ej. 0.5 = no menos
  // del 50 %). undefined = sin piso (admin).
  pisoPrecio?: number;
  // Monto exacto cobrado en Bs cuando el vendedor lo escribió en bolívares:
  // se guarda tal cual (no se reconvierte y pierde céntimos).
  totalBsManual?: number | null;
  // Entradas de cortesía (patrocinios): ocupan aforo igual que cualquier
  // ticket, pero se guardan a precio 0 para no inflar la recaudación ni el
  // ticket promedio de boletería. El monto del patrocinio vive en su tabla.
  cortesia?: boolean;
};

export type ResultadoVentaInterna =
  | { ok: true; grupoId: string; ticketIds: string[]; cantidad: number; total: number; totalBs: number | null }
  | { ok: false; error: string };

// Lógica común de Ventas (manual) y Taquilla: reserva sillas, cotiza por
// etapa, inserta N tickets con el mismo grupo_id.
export async function registrarVentaInterna(service: SupabaseClient, d: DatosVentaInterna): Promise<ResultadoVentaInterna> {
  const { data: evento } = await service.from("eventos").select("id, aforo_general_total").limit(1).single();
  if (!evento) return { ok: false, error: "No se encontró el evento en la base de datos." };

  const sillaIds = d.tipo === "vip" ? [...new Set(d.sillaIds)] : [];
  const cantidad = d.tipo === "vip" ? sillaIds.length : Math.floor(d.cantidad);

  if (cantidad < 1) return { ok: false, error: d.tipo === "vip" ? "Elige al menos una silla en el mapa." : "La cantidad debe ser al menos 1." };
  if (cantidad > MAX_POR_COMPRA[d.tipo]) {
    return { ok: false, error: `Máximo ${MAX_POR_COMPRA[d.tipo]} ${d.tipo === "vip" ? "sillas" : "entradas generales"} por venta.` };
  }

  if (d.tipo === "vip") {
    // Reserva atómica silla por silla; si alguna falla, se liberan las tomadas.
    const tomadas: string[] = [];
    for (const id of sillaIds) {
      const { data: silla, error } = await service
        .from("sillas_vip")
        .update({ estado: "reservada", reservado_hasta: null })
        .eq("id", id)
        .eq("estado", "disponible")
        .select("id")
        .maybeSingle();
      if (error || !silla) {
        if (tomadas.length) await service.from("sillas_vip").update({ estado: "disponible" }).in("id", tomadas);
        return { ok: false, error: "Una de las sillas ya no está disponible — alguien más la tomó. Elige otra." };
      }
      tomadas.push(silla.id);
    }
  } else {
    const { count: generalVendidos } = await service
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("tipo", "general")
      .neq("estado_pago", "rechazado");
    const cupoRestante = evento.aforo_general_total - (generalVendidos ?? 0);
    if (cupoRestante < cantidad) {
      return { ok: false, error: cupoRestante <= 0 ? "Se agotaron los cupos generales." : `Solo quedan ${cupoRestante} entradas generales.` };
    }
  }

  const cotizacion = d.etapaForzada
    ? cotizar(
        (await disponibilidadEtapas(service, d.tipo)).filter((x) => x.etapa === d.etapaForzada).map((x) => ({ ...x, restante: null })),
        cantidad
      )
    : (await cotizarCompra(service, d.tipo, cantidad)).cotizacion;

  // Precio de lista por ticket: el total de su etapa (el fee, cuando la etapa
  // lo cobra aparte, ya viene sumado en l.total).
  const preciosLista = cotizacion.lineas.map((l) => l.total);
  const totalLista = Math.round(preciosLista.reduce((s, p) => s + p, 0) * 100) / 100;

  // Precio negociado: se reparte proporcionalmente entre los tickets para que
  // la suma dé exacto el total que cobró el vendedor.
  let preciosPorTicket = d.cortesia ? preciosLista.map(() => 0) : preciosLista;
  if (!d.cortesia && d.precioTotalManual != null && d.precioTotalManual > 0 && Math.abs(d.precioTotalManual - totalLista) > 0.005) {
    if (d.pisoPrecio != null && d.precioTotalManual < totalLista * d.pisoPrecio) {
      if (sillaIds.length) await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).in("id", sillaIds);
      return {
        ok: false,
        error: `El precio no puede ser menor al ${Math.round(d.pisoPrecio * 100)} % del precio de lista ($${totalLista.toFixed(2)}). Un admin puede registrar descuentos mayores.`,
      };
    }
    const factor = d.precioTotalManual / totalLista;
    preciosPorTicket = preciosLista.map((p) => Math.round(p * factor * 100) / 100);
    const suma = preciosPorTicket.reduce((s, p) => s + p, 0);
    preciosPorTicket[preciosPorTicket.length - 1] = Math.round((preciosPorTicket[preciosPorTicket.length - 1] + (d.precioTotalManual - suma)) * 100) / 100;
  }
  const total = Math.round(preciosPorTicket.reduce((s, p) => s + p, 0) * 100) / 100;

  const enBs = !d.cortesia && metodoEsEnBs(d.metodoPago);
  const tasa = enBs ? await obtenerTasaActual(service) : null;
  const totalBs = enBs ? (d.totalBsManual ?? (tasa ? convertirABs(total, tasa) : null)) : null;
  const bsPorTicket = repartirBs(preciosPorTicket, totalBs);

  const grupoId = randomUUID();
  const ahora = new Date().toISOString();
  const filas = cotizacion.lineas.map((linea, i) => ({
    evento_id: evento.id,
    grupo_id: grupoId,
    canal: d.canal,
    etapa: linea.etapa,
    tipo: d.tipo,
    silla_id: d.tipo === "vip" ? sillaIds[i] : null,
    comprador_nombre: d.compradorNombre,
    comprador_telefono: d.compradorTelefono,
    comprador_email: d.compradorEmail,
    precio: preciosPorTicket[i],
    moneda: "USD",
    precio_bs: bsPorTicket[i],
    tasa_aplicada: enBs && tasa ? tasa : null,
    metodo_pago: d.metodoPago,
    referencia_pago: d.referenciaPago,
    vendido_por: d.vendidoPor,
    ...(d.verificarDeInmediato
      ? { estado_pago: "verificado", verificado_por: d.vendidoPor, verificado_en: ahora }
      : {}),
  }));

  const { data: insertados, error: insertError } = await service.from("tickets").insert(filas).select("id");

  if (insertError || !insertados) {
    if (sillaIds.length) await service.from("sillas_vip").update({ estado: "disponible", reservado_hasta: null }).in("id", sillaIds);
    console.error("Error registrando venta interna:", insertError?.message);
    if (insertError?.code === "23505") {
      return { ok: false, error: "Una de las sillas ya tiene una compra registrada por otra persona. Elige otra." };
    }
    return { ok: false, error: `No se pudo registrar la venta (${insertError?.message ?? "error"}) — intenta de nuevo.` };
  }

  if (d.verificarDeInmediato && sillaIds.length) {
    await service.from("sillas_vip").update({ estado: "vendida" }).in("id", sillaIds);
  }

  return {
    ok: true,
    grupoId,
    ticketIds: insertados.map((t) => t.id as string),
    cantidad,
    total,
    totalBs,
  };
}
