import { requerirPerfil } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import { calcularTotal } from "@/lib/precios";
import Nav from "@/components/Nav";
import type { DiaVenta } from "./VentasChart";
import { seleccionarTodo } from "@/lib/db";
import { ETAPAS } from "@/lib/precios";
import { leerConfig, resumenPlanes } from "@/lib/abona618";
import { obtenerTasaActual } from "@/lib/tasa";
import { hoyEnVenezuela } from "@/lib/cuotas";
import VistaDashboard, { type DatosEmbudo } from "./VistaDashboard";
import {
  calcularRitmo,
  comprasPorHora,
  desdeDelPeriodo,
  diasHastaEvento,
  leerPeriodo,
  leerResumen,
  leerZona,
  mediana,
  minutosDesde,
  restarDias,
} from "@/lib/embudo";

// Sin `revalidate`: esta página lee la sesión (cookies) y por eso Next la
// trata como dinámica siempre — el "revalidate = 10" de antes no hacía nada y
// confundía. El refresco real lo hace <AutoRefresh /> cada 20 s en el cliente.

const METODO_ETIQUETA: Record<string, string> = {
  pago_movil: "Pago móvil",
  transferencia: "Transferencia",
  zelle: "Zelle",
  binance: "Binance",
  efectivo_usd: "Efectivo $",
  efectivo_bs: "Efectivo Bs",
};

const METODOS_ORDEN = ["transferencia", "zelle", "binance", "pago_movil", "efectivo_usd", "efectivo_bs"] as const;

const CANAL_ETIQUETA: Record<string, string> = { web: "Web", manual: "Manual", taquilla: "Taquilla", patrocinio: "Patrocinios", cortesia: "Cortesías" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ p?: string; z?: string; v?: string }> }) {
  const perfil = await requerirPerfil();
  const params = await searchParams;

  if (perfil.rol !== "ventas" && perfil.rol !== "finanzas" && perfil.rol !== "admin") {
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

  type TicketResumen = {
    tipo: string;
    precio: number | string;
    metodo_pago: string;
    estado_pago: string;
    created_at: string;
    verificado_en: string | null;
    canal: string | null;
    etapa: string | null;
    grupo_id: string | null;
    precio_bs: number | string | null;
  };

  // Embudo (29 oct): período y zona vienen en la dirección (?p=hoy|7d|todo&z=vip…)
  // para que el refresco automático los conserve.
  const hoy = hoyEnVenezuela();
  const periodo = leerPeriodo(params.p);
  const zonaFiltro = leerZona(params.z);

  // La configuración va primero porque el resumen de planes necesita el tope
  // vigente: si alguien lo subió de 100, la tarjeta tiene que medir contra el
  // número de verdad y no contra la constante del código.
  const config = await leerConfig(service);
  const [{ data: tickets, error: ticketsError }, { data: evento }, { data: mesas }, planes, tasaEurVes, rpcEmbudo, { data: gruposPlan }] = await Promise.all([
    seleccionarTodo<TicketResumen>(service, "tickets", "tipo, precio, metodo_pago, estado_pago, created_at, verificado_en, canal, etapa, grupo_id, precio_bs"),
    service.from("eventos").select("aforo_general_total").limit(1).single(),
    // El aforo con asiento se cuenta por zona (VIP y Preferencial comparten
    // tablas y se distinguen por mesas_vip.zona).
    service.from("mesas_vip").select("zona, sillas_total"),
    resumenPlanes(service, config),
    obtenerTasaActual(service),
    // Una sola consulta con todo el embudo (supabase/medicion_embudo_29oct.sql).
    // Si el SQL todavía no se corrió, viene con error y el panel lo dice.
    service.rpc("resumen_embudo", { p_desde: desdeDelPeriodo(periodo, hoy), p_hasta: new Date().toISOString(), p_zona: zonaFiltro }),
    // Todas las compras con plan (también las completadas): sus tickets se
    // confirman al último pago y no sirven para medir la verificación.
    seleccionarTodo<{ grupo_id: string }>(service, "planes_pago", "grupo_id"),
  ]);
  if (rpcEmbudo.error) console.warn("Dashboard: resumen_embudo no disponible:", rpcEmbudo.error.message);
  if (ticketsError) console.error("Error cargando tickets para el dashboard:", ticketsError);

  const todos = tickets ?? [];
  const cupoPreventa = ETAPAS.find((e) => e.id === "preventa")?.cupo ?? { vip: 0, general: 0 };
  const verificados = todos.filter((t) => t.estado_pago === "verificado");
  const pendientes = todos.filter((t) => t.estado_pago === "pendiente");

  const vipVerificados = verificados.filter((t) => t.tipo === "vip");
  const preferencialVerificados = verificados.filter((t) => t.tipo === "preferencial");
  const generalVerificados = verificados.filter((t) => t.tipo === "general");

  const ingresoTotal = verificados.reduce((s, t) => s + Number(t.precio), 0);

  // Las compras con plan en curso NO van en "esperando verificación". De una
  // compra de $140 en cuotas entraron $56 y los tickets siguen en `pendiente`
  // hasta el último pago: sumar los $140 aquí infla lo que Finanzas cree que
  // tiene por revisar, y la plata que de verdad entró no aparecía en ninguna
  // parte. Esa va en la tarjeta de Abona618, y el total real de los dos
  // caminos es `enBanco`.
  const gruposConPlan = new Set(planes.gruposEnCurso);
  const pendientesSueltos = pendientes.filter((t) => !t.grupo_id || !gruposConPlan.has(String(t.grupo_id)));
  const ingresoPendiente = pendientesSueltos.reduce((s, t) => s + Number(t.precio), 0);
  const enBanco = Math.round((ingresoTotal + planes.enCurso.cobradoUsd) * 100) / 100;
  const ingresoVip = vipVerificados.reduce((s, t) => s + Number(t.precio), 0);
  const ingresoPreferencial = preferencialVerificados.reduce((s, t) => s + Number(t.precio), 0);
  const ingresoGeneral = generalVerificados.reduce((s, t) => s + Number(t.precio), 0);

  const aforoGeneral = evento?.aforo_general_total ?? 4500;
  const sillasPorZona = (zona: string) =>
    (mesas ?? []).filter((m) => ((m.zona as string | null) ?? "vip") === zona).reduce((s, m) => s + Number(m.sillas_total ?? 0), 0);
  const aforoVip = mesas ? sillasPorZona("vip") : 300;
  const aforoPreferencial = mesas ? sillasPorZona("preferencial") : 0;
  const hayPreferencial = aforoPreferencial > 0 || preferencialVerificados.length > 0;
  const metaIngresos =
    aforoVip * calcularTotal("vip").total +
    aforoPreferencial * calcularTotal("preferencial").total +
    aforoGeneral * calcularTotal("general").total;

  // Por método se suman los bolívares REALES de cada ticket (`precio_bs`): lo
  // que de verdad entró ese día, a la tasa de ese día. Convertir el total de
  // hoy daría un número más redondo y falso — la plata entró a lo largo de
  // semanas con tasas distintas.
  const porMetodo = new Map<string, { cantidad: number; monto: number; bs: number }>();
  for (const t of verificados) {
    const actual = porMetodo.get(t.metodo_pago) ?? { cantidad: 0, monto: 0, bs: 0 };
    actual.cantidad += 1;
    actual.monto += Number(t.precio);
    if (t.precio_bs != null) actual.bs += Number(t.precio_bs);
    porMetodo.set(t.metodo_pago, actual);
  }
  const maxMonto = Math.max(1, ...[...porMetodo.values()].map((v) => v.monto));

  const porCanal = new Map<string, { cantidad: number; monto: number }>();
  for (const t of verificados) {
    const c = (t.canal as string) ?? "web";
    const actual = porCanal.get(c) ?? { cantidad: 0, monto: 0 };
    actual.cantidad += 1;
    actual.monto += Number(t.precio);
    porCanal.set(c, actual);
  }
  const preventaVendida = todos.filter((t) => t.etapa === "preventa" && t.estado_pago !== "rechazado");
  const preventaVip = preventaVendida.filter((t) => t.tipo === "vip").length;
  const preventaGeneral = preventaVendida.filter((t) => t.tipo === "general").length;

  // Por día, con desglose por tipo e ingreso: al tocar una barra el gráfico
  // dice si ese día lo hizo VIP o General, no solo cuántas entradas salieron.
  const porDia = new Map<string, DiaVenta>();
  for (const t of verificados) {
    const dia = new Date(t.created_at).toLocaleDateString("sv-SE", { timeZone: "America/Caracas" });
    const actual = porDia.get(dia) ?? { fecha: dia, total: 0, vip: 0, preferencial: 0, general: 0, usd: 0 };
    actual.total += 1;
    if (t.tipo === "vip") actual.vip += 1;
    else if (t.tipo === "preferencial") actual.preferencial += 1;
    else actual.general += 1;
    actual.usd = Math.round((actual.usd + Number(t.precio)) * 100) / 100;
    porDia.set(dia, actual);
  }
  const dias = [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-14);

  // Ocupación por zona (Anita, 17 oct: "dice 3 Preferencial vendidos y van
  // muchas más"). "Vendidos" contaba solo lo pagado al 100 %; las compras en
  // cuotas siguen en `pendiente` hasta el último pago y no aparecían, aunque
  // sus sillas ya están tomadas. Ahora el número grande es lo OCUPADO y abajo
  // se separa qué está pagado, qué va en cuotas y qué espera a Finanzas.
  const ocupacion = (tipo: string) => {
    const pagadas = verificados.filter((t) => t.tipo === tipo).length;
    const enCuotas = pendientes.filter((t) => t.tipo === tipo && t.grupo_id && gruposConPlan.has(String(t.grupo_id))).length;
    const porVerificar = pendientesSueltos.filter((t) => t.tipo === tipo).length;
    return { pagadas, enCuotas, porVerificar, ocupadas: pagadas + enCuotas + porVerificar };
  };
  const ocVip = ocupacion("vip");
  const ocPreferencial = ocupacion("preferencial");
  const ocGeneral = ocupacion("general");

  const vendidosTotal = verificados.length;
  const aforoTotalEntradas = aforoVip + aforoPreferencial + aforoGeneral;
  const pctVendido = aforoTotalEntradas > 0 ? Math.round((vendidosTotal / aforoTotalEntradas) * 1000) / 10 : 0;

  // ---- Ritmo (29 oct): entradas ocupadas por día en los últimos 7 días contra
  // las que hacen falta por día para llenar cada zona el 4 de diciembre.
  const diasRestantes = diasHastaEvento(hoy);
  const desde7 = restarDias(hoy, 6);
  const diaVe = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Caracas" });
  const vivos = todos.filter((t) => t.estado_pago !== "rechazado");
  const ultimos7 = (tipo?: string) => vivos.filter((t) => (!tipo || t.tipo === tipo) && diaVe(t.created_at) >= desde7).length;
  const ritmoDe = (tipo: string, oc: { ocupadas: number }, aforo: number) =>
    calcularRitmo({ ocupadas: oc.ocupadas, aforo, ultimos7: ultimos7(tipo), diasRestantes });
  const ritmoTotal = calcularRitmo({
    ocupadas: ocVip.ocupadas + ocPreferencial.ocupadas + ocGeneral.ocupadas,
    aforo: aforoTotalEntradas,
    ultimos7: ultimos7(),
    diasRestantes,
  });

  // ---- Compras (no entradas): primer ticket de cada grupo, sin cortesías ni patrocinios.
  const CANALES_VENTA = new Set(["web", "manual", "taquilla"]);
  const primeraPorGrupo = new Map<string, TicketResumen>();
  for (const t of vivos) {
    if (!t.grupo_id || !CANALES_VENTA.has(t.canal ?? "web")) continue;
    const previo = primeraPorGrupo.get(t.grupo_id);
    if (!previo || t.created_at < previo.created_at) primeraPorGrupo.set(t.grupo_id, t);
  }
  const compras = [...primeraPorGrupo.values()];
  const comprasHoy = compras.filter((t) => diaVe(t.created_at) === hoy).length;
  const desde14 = restarDias(hoy, 13);
  const porHora = comprasPorHora(compras.filter((t) => diaVe(t.created_at) >= desde14).map((t) => t.created_at));

  // ---- Verificación de contado: de "ya pagué" a confirmado, mediana de 14 días.
  // Sin compras en cuotas: sus tickets se confirman al ÚLTIMO pago, semanas después.
  const conPlan = new Set((gruposPlan ?? []).map((g) => String(g.grupo_id)));
  const tiemposVerif: number[] = [];
  const verifPorGrupo = new Map<string, { creado: string; verificado: string }>();
  for (const t of verificados) {
    if (!t.grupo_id || !t.verificado_en || conPlan.has(t.grupo_id) || !CANALES_VENTA.has(t.canal ?? "web")) continue;
    if (diaVe(t.created_at) < desde14) continue;
    const g = verifPorGrupo.get(t.grupo_id);
    if (!g) verifPorGrupo.set(t.grupo_id, { creado: t.created_at, verificado: t.verificado_en });
    else {
      if (t.created_at < g.creado) g.creado = t.created_at;
      if (t.verificado_en < g.verificado) g.verificado = t.verificado_en;
    }
  }
  for (const g of verifPorGrupo.values()) tiemposVerif.push((Date.parse(g.verificado) - Date.parse(g.creado)) / 60_000);
  const masViejoPendiente = pendientesSueltos.reduce<string | null>((m, t) => (!m || t.created_at < m ? t.created_at : m), null);

  const embudo: DatosEmbudo = {
    periodo,
    zona: zonaFiltro,
    resumen: rpcEmbudo.error ? null : leerResumen(rpcEmbudo.data),
    ritmo: ritmoTotal,
    comprasHoy,
    porHora,
    verificacionMin: mediana(tiemposVerif),
    verificacionMuestra: tiemposVerif.length,
    pendienteMasViejoMin: masViejoPendiente ? minutosDesde(masViejoPendiente) : null,
  };

  // Todo lo de arriba es la cuenta; lo de abajo solo la entrega a la vista.
  // El rediseño visual (23 oct) no cambió ni un cálculo: vive en VistaDashboard.
  return (
    <VistaDashboard
      perfil={perfil}
      hoy={hoy}
      vistaInicial={typeof params.v === "string" ? params.v : "hoy"}
      embudo={embudo}
      tasaEurVes={tasaEurVes}
      recaudado={{
        ingresoTotal,
        ingresoPendiente,
        pagosPorVerificar: pendientesSueltos.length,
        cuotasCobradas: planes.enCurso.cobradoUsd,
        enBanco,
        metaIngresos,
        vendidosTotal,
        aforoTotalEntradas,
        pctVendido,
        ocupadasTotal: ocVip.ocupadas + ocPreferencial.ocupadas + ocGeneral.ocupadas,
      }}
      zonas={[
        { id: "vip", etiqueta: "VIP", aforo: aforoVip, pagadoUsd: ingresoVip, ...ocVip, ritmo: ritmoDe("vip", ocVip, aforoVip) },
        ...(hayPreferencial
          ? [
              {
                id: "preferencial",
                etiqueta: "Preferencial",
                aforo: aforoPreferencial,
                pagadoUsd: ingresoPreferencial,
                ...ocPreferencial,
                ritmo: ritmoDe("preferencial", ocPreferencial, aforoPreferencial),
              },
            ]
          : []),
        { id: "general", etiqueta: "General", aforo: aforoGeneral, pagadoUsd: ingresoGeneral, ...ocGeneral, ritmo: ritmoDe("general", ocGeneral, aforoGeneral) },
      ]}
      preventa={{ vip: preventaVip, general: preventaGeneral, cupoVip: cupoPreventa.vip, cupoGeneral: cupoPreventa.general }}
      canales={["web", "manual", "taquilla", "patrocinio", "cortesia"].map((c) => {
        const d = porCanal.get(c) ?? { cantidad: 0, monto: 0 };
        return { id: c, etiqueta: CANAL_ETIQUETA[c], cantidad: d.cantidad, monto: d.monto, sinCobro: c === "patrocinio" || c === "cortesia" };
      })}
      metodos={METODOS_ORDEN.map((m) => {
        const d = porMetodo.get(m) ?? { cantidad: 0, monto: 0, bs: 0 };
        return { id: m, etiqueta: METODO_ETIQUETA[m], cantidad: d.cantidad, monto: d.monto, bs: d.bs, pct: Math.round((d.monto / maxMonto) * 100) };
      })}
      dias={dias}
      planes={planes}
      config={config}
    />
  );
}
