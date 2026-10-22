import { requerirPerfil } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import { obtenerTasaActual } from "@/lib/tasa";
import Nav from "@/components/Nav";
import PendientesList, { type CompraPendiente } from "./PendientesList";
import TasaCambio from "./TasaCambio";
import BuscarComprador from "./BuscarComprador";
import AprobadasList, { type FilaAprobada } from "./AprobadasList";
import AutoRefresh from "@/app/dashboard/AutoRefresh";
import { seleccionarTodo } from "@/lib/db";
import type { Tipo } from "@/lib/precios";

export default async function FinanzasPage() {
  const perfil = await requerirPerfil();

  if (perfil.rol !== "finanzas" && perfil.rol !== "admin") {
    return (
      <>
        <Nav perfil={perfil} />
        <main className="max-w-3xl mx-auto w-full px-4 py-6">
          <p className="text-sm text-neutral-500">No tienes permiso para ver esta sección.</p>
        </main>
      </>
    );
  }

  const service = createServiceClient();

  // Consulta simple, sin relaciones embebidas (ver src/lib/asiento.ts).
  type TicketPendiente = {
    id: string; grupo_id: string | null; comprador_nombre: string; comprador_telefono: string; comprador_email: string | null;
    tipo: string; precio: number | string; precio_bs: number | string | null; tasa_aplicada: number | string | null; etapa: string | null;
    canal: string | null; metodo_pago: string; referencia_pago: string | null; vendido_por: string | null; silla_id: string | null; created_at: string;
  };
  const { data: pendientes, error: ticketsError } = await seleccionarTodo<TicketPendiente>(
    service,
    "tickets",
    "id, grupo_id, comprador_nombre, comprador_telefono, comprador_email, tipo, precio, precio_bs, tasa_aplicada, etapa, canal, metodo_pago, referencia_pago, vendido_por, silla_id, created_at",
    (q) => q.eq("estado_pago", "pendiente").order("created_at", { ascending: true })
  );

  if (ticketsError) {
    console.error("Error cargando pagos pendientes:", ticketsError);
  }

  const tickets = pendientes ?? [];
  const tasaActual = await obtenerTasaActual(service);

  const vendedorIds = [...new Set(tickets.map((t) => t.vendido_por).filter(Boolean))] as string[];
  const sillaIds = [...new Set(tickets.map((t) => t.silla_id).filter(Boolean))] as string[];

  const [{ data: vendedores }, { data: sillas }] = await Promise.all([
    vendedorIds.length
      ? service.from("perfiles").select("id, nombre").in("id", vendedorIds)
      : Promise.resolve({ data: [] as { id: string; nombre: string }[] }),
    sillaIds.length
      ? service.from("sillas_vip").select("id, numero, mesa_id").in("id", sillaIds)
      : Promise.resolve({ data: [] as { id: string; numero: number; mesa_id: string }[] }),
  ]);

  const mesaIds = [...new Set((sillas ?? []).map((s) => s.mesa_id).filter(Boolean))];
  const { data: mesas } = mesaIds.length
    ? await service.from("mesas_vip").select("id, numero, fila").in("id", mesaIds)
    : { data: [] as { id: string; numero: number; fila: string }[] };

  const vendedorPorId = new Map((vendedores ?? []).map((v) => [v.id, v.nombre]));
  const mesaPorId = new Map((mesas ?? []).map((m) => [m.id, m]));
  const sillaPorId = new Map((sillas ?? []).map((s) => [s.id, s]));

  // Agrupar por compra (grupo_id). Tickets viejos sin grupo: cada uno es su compra.
  const compras = new Map<string, CompraPendiente>();
  for (const t of tickets) {
    const gid = (t.grupo_id as string | null) ?? (t.id as string);
    const silla = t.silla_id ? sillaPorId.get(t.silla_id) : null;
    const mesa = silla ? mesaPorId.get(silla.mesa_id) : null;
    const asiento = silla && mesa ? `${mesa.fila}${mesa.numero}·S${silla.numero}` : null;
    const precio = Number(t.precio);
    const precioBs = t.precio_bs == null ? null : Number(t.precio_bs);
    const existente = compras.get(gid);
    if (existente) {
      existente.cantidad += 1;
      existente.total = Math.round((existente.total + precio) * 100) / 100;
      existente.totalBs = existente.totalBs != null && precioBs != null ? Math.round((existente.totalBs + precioBs) * 100) / 100 : existente.totalBs;
      if (asiento) existente.asientos.push(asiento);
      if (t.etapa === "preventa") existente.enPreventa += 1;
      continue;
    }
    compras.set(gid, {
      id: t.id as string,
      grupoId: gid,
      compradorNombre: t.comprador_nombre as string,
      compradorTelefono: t.comprador_telefono as string,
      compradorEmail: (t.comprador_email as string | null) ?? null,
      tipo: t.tipo as Tipo,
      cantidad: 1,
      total: precio,
      totalBs: precioBs,
      tasaAplicada: t.tasa_aplicada == null ? null : Number(t.tasa_aplicada),
      enPreventa: t.etapa === "preventa" ? 1 : 0,
      canal: (t.canal as string) ?? (t.vendido_por ? "manual" : "web"),
      metodoPago: t.metodo_pago as string,
      referenciaPago: (t.referencia_pago as string | null) ?? null,
      vendidoPor: (t.vendido_por as string | null) ?? null,
      vendedorNombre: t.vendido_por ? (vendedorPorId.get(t.vendido_por) ?? "—") : null,
      asientos: asiento ? [asiento] : [],
      creadoEn: t.created_at as string,
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Las compras en plan de cuotas NO van en esta cola.
  //
  // Sus tickets se quedan en "pendiente" durante semanas, así que se quedaban
  // aquí para siempre, y mostradas mal: el monto era el total de la compra
  // ($60) cuando el comprador había transferido su inicial ($24), y el botón
  // ofrecía "Verificar y enviar 2 QR", que es exactamente lo que el candado
  // de Abona618 NO va a hacer. Finanzas buscaba en el banco un monto que no
  // existe y creía estar entregando entradas.
  //
  // El cobro de cuotas tiene su propia pantalla, con el monto de cada cuota,
  // quién lo anotó y por dónde llegó. Aquí solo queda el aviso de cuántas hay.
  // ───────────────────────────────────────────────────────────────────────
  const gruposPendientes = [...compras.keys()];
  const { data: planesVivos, error: errorPlanes } = gruposPendientes.length
    ? await service
        .from("planes_pago")
        .select("grupo_id, estado")
        .in("grupo_id", gruposPendientes)
        .in("estado", ["al_dia", "en_mora"])
    : { data: [] as { grupo_id: string; estado: string }[], error: null };

  // FALLA CERRADO. Si no se pudo saber cuáles compras tienen plan, la cola NO
  // se muestra: antes el error se descartaba y las compras en cuotas
  // aparecían aquí como ventas de contado por su total, con el botón de
  // "Verificar y enviar QR" a un clic. El candado del servidor también lo
  // frena, pero no hay por qué ofrecer el botón.
  if (errorPlanes) console.error("Finanzas: no se pudo leer qué compras tienen plan —", errorPlanes.message);
  const enPlan = new Set((planesVivos ?? []).map((p) => String(p.grupo_id)));
  const comprasEnPlan = errorPlanes ? [] : [...compras.values()].filter((c) => enPlan.has(c.grupoId));
  const lista = errorPlanes ? [] : [...compras.values()].filter((c) => !enPlan.has(c.grupoId));
  const totalPendienteUsd = lista.reduce((s, c) => s + c.total, 0);
  const entradasPendientes = lista.reduce((s, c) => s + c.cantidad, 0);

  // Auditoría solo para admin: compras ya verificadas, con quién las aprobó y
  // cuándo. Consulta aparte y acotada — no toca la cola de pendientes.
  const aprobadas: FilaAprobada[] = [];
  if (perfil.rol === "admin") {
    type TicketAprobado = {
      id: string; grupo_id: string | null; comprador_nombre: string; comprador_email: string | null;
      tipo: string; precio: number | string; precio_bs: number | string | null; metodo_pago: string;
      referencia_pago: string | null; canal: string | null; vendido_por: string | null;
      verificado_por: string | null; verificado_en: string | null; created_at: string;
    };
    const { data: verificados } = await service
      .from("tickets")
      .select(
        "id, grupo_id, comprador_nombre, comprador_email, tipo, precio, precio_bs, metodo_pago, referencia_pago, canal, vendido_por, verificado_por, verificado_en, created_at"
      )
      .eq("estado_pago", "verificado")
      .order("verificado_en", { ascending: false, nullsFirst: false })
      .limit(400);

    const filasVerificadas = (verificados ?? []) as TicketAprobado[];

    // Nombres de quien vendió y de quien aprobó: en una venta manual el control
    // anti-fraude es justamente que no sean la misma persona.
    const personaIds = [
      ...new Set(filasVerificadas.flatMap((t) => [t.vendido_por, t.verificado_por]).filter(Boolean)),
    ] as string[];
    const { data: personas } = personaIds.length
      ? await service.from("perfiles").select("id, nombre").in("id", personaIds)
      : { data: [] as { id: string; nombre: string }[] };
    const nombrePorId = new Map((personas ?? []).map((a) => [a.id, a.nombre]));

    const porGrupo = new Map<string, FilaAprobada>();
    for (const t of filasVerificadas) {
      const gid = t.grupo_id ?? t.id;
      const precio = Number(t.precio);
      const precioBs = t.precio_bs == null ? null : Number(t.precio_bs);
      const existente = porGrupo.get(gid);
      if (existente) {
        existente.cantidad += 1;
        existente.total = Math.round((existente.total + precio) * 100) / 100;
        existente.totalBs =
          existente.totalBs != null && precioBs != null
            ? Math.round((existente.totalBs + precioBs) * 100) / 100
            : existente.totalBs;
        continue;
      }
      porGrupo.set(gid, {
        grupoId: gid,
        ticketId: t.id,
        compradorNombre: t.comprador_nombre,
        compradorEmail: t.comprador_email,
        tipo: t.tipo as Tipo,
        cantidad: 1,
        total: precio,
        totalBs: precioBs,
        metodoPago: t.metodo_pago,
        referenciaPago: t.referencia_pago,
        canal: t.canal ?? "web",
        vendidoPor: t.vendido_por ? (nombrePorId.get(t.vendido_por) ?? "—") : null,
        aprobadoPor: t.verificado_por ? (nombrePorId.get(t.verificado_por) ?? "—") : null,
        mismoUsuario: !!t.vendido_por && t.vendido_por === t.verificado_por,
        aprobadoEn: t.verificado_en,
        creadoEn: t.created_at,
      });
    }
    aprobadas.push(...[...porGrupo.values()].slice(0, 40));
  }

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Verificación de pagos</h1>
            <p className="text-sm text-neutral-500">
              {lista.length === 0
                ? "Sin pagos pendientes"
                : `${lista.length} compra${lista.length === 1 ? "" : "s"} · ${entradasPendientes} entrada${entradasPendientes === 1 ? "" : "s"} · $${totalPendienteUsd.toFixed(2)} por verificar`}
            </p>
          </div>
          <AutoRefresh intervaloMs={30000} />
        </div>

        {comprasEnPlan.length > 0 && (
          <a
            href="/cobranza"
            className="rounded-xl border border-marca-secundario/30 bg-marca-secundario/5 px-4 py-3 flex items-center justify-between gap-3"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-marca-secundario">
                {comprasEnPlan.length} compra{comprasEnPlan.length === 1 ? "" : "s"} en plan de cuotas
              </span>
              <span className="block text-xs text-neutral-600 leading-snug">
                No salen en esta lista: su monto no es el total de la compra y no se entrega QR hasta completar. Se
                cobran y se aprueban en Cobranza.
              </span>
            </span>
            <span className="shrink-0 text-sm font-semibold text-marca-secundario">Ir →</span>
          </a>
        )}

        {errorPlanes ? (
          <p className="text-sm rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
            No se pudo leer la base de datos para separar las compras en cuotas de las de contado. La cola no se
            muestra para no aprobar una por error. Recarga en un momento.
          </p>
        ) : (
          <PendientesList compras={lista} miId={perfil.id} miRol={perfil.rol} tasaEurVes={tasaActual} />
        )}

        <BuscarComprador esAdmin={perfil.rol === "admin"} />

        {perfil.rol === "admin" && <AprobadasList filas={aprobadas} />}

        <TasaCambio tasaActual={tasaActual} />
      </main>
    </>
  );
}
