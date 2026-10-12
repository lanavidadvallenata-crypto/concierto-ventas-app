// Pruebas de la capa de datos de Abona618 contra un doble de Supabase en
// memoria. Lo que se está cuidando aquí es que un error de la base, un reporte
// falso o dos personas de Finanzas aprobando a la vez no terminen en una
// entrada entregada sin pagar.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearDoble, CONFIG_ENCENDIDA, type Doble } from "./doble-supabase.ts";
import {
  leerConfig,
  contarVipEnPlan,
  planOfrecible,
  crearPlan,
  leerPlanPorGrupo,
  planConSaldo,
  reportarCuota,
  verificarCuota,
} from "../src/lib/abona618.ts";
import { planPara } from "../src/lib/cuotas.ts";

const HOY = "2026-10-12";
const cli = (d: Doble) => d.cliente as SupabaseClient;

function doblePlanListo(opciones: { tipo?: "vip" | "general"; total?: number } = {}) {
  const d = crearDoble({ abona618_config: structuredClone(CONFIG_ENCENDIDA) });
  const total = opciones.total ?? 140;
  const plan = planPara(total, HOY);
  assert.ok(plan.hayPlan);
  return { d, total, cuotas: plan.cuotas, tipo: opciones.tipo ?? "vip" as const };
}

test("sin tabla de configuración el módulo queda APAGADO", async () => {
  const d = crearDoble();
  const config = await leerConfig(cli(d));
  assert.equal(config.activo, false);

  const r = await planOfrecible(cli(d), { tipo: "general", cantidad: 1, total: 30, hoy: HOY });
  assert.equal(r.plan.hayPlan, false);
  assert.equal(r.plan.hayPlan === false && r.plan.motivo, "apagado");
});

test("si la lectura de la configuración falla, tampoco se ofrece el plan", async () => {
  const d = crearDoble({ abona618_config: structuredClone(CONFIG_ENCENDIDA) });
  d.fallar.abona618_config = "conexión caída";
  const r = await planOfrecible(cli(d), { tipo: "general", cantidad: 1, total: 30, hoy: HOY });
  assert.equal(r.plan.hayPlan, false, "un error de base nunca debe abrir el crédito");
});

test("si el conteo de VIP falla, no se compromete una silla más", async () => {
  const d = crearDoble({ abona618_config: structuredClone(CONFIG_ENCENDIDA), planes_pago: [] });
  d.fallar.planes_pago = "timeout";
  assert.equal(await contarVipEnPlan(cli(d)), Number.MAX_SAFE_INTEGER);
  const r = await planOfrecible(cli(d), { tipo: "vip", cantidad: 1, total: 140, hoy: HOY });
  assert.equal(r.plan.hayPlan, false);
  assert.equal(r.plan.hayPlan === false && r.plan.motivo, "tope_vip");
});

test("el conteo de VIP solo suma los planes que están ocupando una silla", async () => {
  const d = crearDoble({
    abona618_config: structuredClone(CONFIG_ENCENDIDA),
    planes_pago: [
      { id: "p1", tipo: "vip", estado: "al_dia", cantidad: 4 },
      { id: "p2", tipo: "vip", estado: "en_mora", cantidad: 2 },
      { id: "p3", tipo: "vip", estado: "completado", cantidad: 1 },
      { id: "p4", tipo: "vip", estado: "vencido", cantidad: 10 },
      { id: "p5", tipo: "vip", estado: "anulado", cantidad: 10 },
      { id: "p6", tipo: "general", estado: "al_dia", cantidad: 20 },
    ],
  });
  assert.equal(await contarVipEnPlan(cli(d)), 7, "vencidos y anulados ya devolvieron su silla");
});

test("el tope de VIP se lee de la base, y se puede SUBIR sin desplegar", async () => {
  const base = (tope: number, enPlan: number) =>
    crearDoble({
      abona618_config: [{ id: 1, activo: true, tope_vip: tope, aviso_tope_vip: tope - 10, aviso_tope_enviado_en: null }],
      planes_pago: [{ id: "p1", tipo: "vip", estado: "al_dia", cantidad: enPlan }],
    });

  const lleno = await planOfrecible(cli(base(100, 100)), { tipo: "vip", cantidad: 1, total: 140, hoy: HOY });
  assert.equal(lleno.plan.hayPlan, false);
  assert.equal(lleno.plan.hayPlan === false && lleno.plan.motivo, "tope_vip");

  // Este es el caso que pidió Anita: avisarle a los 90 y poder extender.
  const extendido = await planOfrecible(cli(base(150, 100)), { tipo: "vip", cantidad: 1, total: 140, hoy: HOY });
  assert.equal(extendido.plan.hayPlan, true, "subir el tope en la base tiene que abrir cupos");
  assert.equal(extendido.config.topeVip, 150);

  // Y bajarlo también tiene que cerrar.
  const reducido = await planOfrecible(cli(base(50, 50)), { tipo: "vip", cantidad: 1, total: 140, hoy: HOY });
  assert.equal(reducido.plan.hayPlan, false);
});

test("taquilla no recibe plan ni con el módulo encendido", async () => {
  const d = crearDoble({ abona618_config: structuredClone(CONFIG_ENCENDIDA) });
  const r = await planOfrecible(cli(d), { tipo: "general", cantidad: 1, total: 30, canal: "taquilla", hoy: HOY });
  assert.equal(r.plan.hayPlan, false);
  assert.equal(r.plan.hayPlan === false && r.plan.motivo, "taquilla");
});

test("crear un plan deja la inicial reportada y el resto limpio", async () => {
  const { d, total, cuotas, tipo } = doblePlanListo();
  const r = await crearPlan(cli(d), {
    grupoId: "g-1", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "pago_movil", referenciaPago: "123456", montoBsInicial: 9876.54, tasaAplicada: 176.37,
  });
  assert.equal(r.ok, true);

  const guardado = await leerPlanPorGrupo(cli(d), "g-1");
  assert.ok(guardado);
  assert.equal(guardado.cuotas.length, 3);
  assert.equal(guardado.pagado, 0, "reportado no es pagado: Finanzas no ha visto el dinero");
  assert.equal(guardado.saldo, 140);
  assert.equal(guardado.proxima?.orden, 1);

  const inicial = guardado.cuotas[0];
  assert.ok(inicial.reportadoEn, "la inicial sí queda reportada");
  assert.equal(inicial.verificadoEn, null);
  assert.equal(inicial.referenciaPago, "123456");
  for (const c of guardado.cuotas.slice(1)) {
    assert.equal(c.reportadoEn, null, "las cuotas futuras no pueden nacer reportadas");
    assert.equal(c.metodoPago, null);
  }
});

test("si fallan las cuotas, el plan se borra en vez de quedar sin cobrar", async () => {
  const { d, total, cuotas, tipo } = doblePlanListo();
  d.fallar.cuotas = "violación de check";
  const r = await crearPlan(cli(d), {
    grupoId: "g-2", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "zelle", referenciaPago: "a@b.com", montoBsInicial: null, tasaAplicada: null,
  });
  assert.equal(r.ok, false);
  assert.equal((d.tablas.planes_pago ?? []).length, 0, "un plan sin cuotas es una compra que nadie va a cobrar");
});

test("el camino completo: inicial, cuota, pago final y recién ahí los QR", async () => {
  const { d, total, cuotas, tipo } = doblePlanListo();
  await crearPlan(cli(d), {
    grupoId: "g-3", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "transferencia", referenciaPago: "000111", montoBsInicial: null, tasaAplicada: null,
  });
  const plan0 = (await leerPlanPorGrupo(cli(d), "g-3"))!;

  // 1 · Finanzas verifica la inicial. NO se entrega nada.
  const v1 = await verificarCuota(cli(d), { cuotaId: plan0.cuotas[0].id, verificadoPor: "finanzas-1" });
  assert.ok(v1.ok);
  assert.equal(v1.completo, false, "con el 40 % pagado no se puede entregar el QR");
  assert.equal(v1.plan.pagado, 56);
  assert.equal(v1.plan.saldo, 84);
  assert.equal(v1.plan.proxima?.etiqueta, "Cuota 01");

  // 2 · El comprador reporta la cuota 01 y Finanzas la verifica.
  const r2 = await reportarCuota(cli(d), {
    cuotaId: plan0.cuotas[1].id, metodoPago: "pago_movil", referenciaPago: "222333", montoBs: 4000, tasa: 176,
  });
  assert.equal(r2.ok, true);
  const v2 = await verificarCuota(cli(d), { cuotaId: plan0.cuotas[1].id, verificadoPor: "finanzas-1" });
  assert.ok(v2.ok);
  assert.equal(v2.completo, false);
  assert.equal(v2.plan.pagado, 98);

  // 3 · El pago final. Ahora sí.
  const v3 = await verificarCuota(cli(d), { cuotaId: plan0.cuotas[2].id, verificadoPor: "finanzas-1" });
  assert.ok(v3.ok);
  assert.equal(v3.completo, true, "con el 100 % verificado se entregan los QR");
  assert.equal(v3.plan.pagado, 140);
  assert.equal(v3.plan.saldo, 0);
  assert.equal(v3.plan.estado, "completado");
  assert.equal(v3.plan.proxima, null);
  assert.ok(d.tablas.planes_pago[0].completado_en, "queda la hora en que se completó");
});

test("dos personas de Finanzas aprobando la misma cuota: solo una pasa", async () => {
  const { d, total, cuotas, tipo } = doblePlanListo();
  await crearPlan(cli(d), {
    grupoId: "g-4", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "binance", referenciaPago: "818097513", montoBsInicial: null, tasaAplicada: null,
  });
  const plan = (await leerPlanPorGrupo(cli(d), "g-4"))!;

  const a = await verificarCuota(cli(d), { cuotaId: plan.cuotas[0].id, verificadoPor: "finanzas-1" });
  const b = await verificarCuota(cli(d), { cuotaId: plan.cuotas[0].id, verificadoPor: "finanzas-2" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, false, "la segunda no debe encontrar fila: si no, el correo sale dos veces");
});

test("un reporte tardío no borra los datos del pago que Finanzas ya confirmó", async () => {
  const { d, total, cuotas, tipo } = doblePlanListo();
  await crearPlan(cli(d), {
    grupoId: "g-5", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "pago_movil", referenciaPago: "BUENA", montoBsInicial: null, tasaAplicada: null,
  });
  const plan = (await leerPlanPorGrupo(cli(d), "g-5"))!;
  await verificarCuota(cli(d), { cuotaId: plan.cuotas[0].id, verificadoPor: "finanzas-1" });

  const r = await reportarCuota(cli(d), {
    cuotaId: plan.cuotas[0].id, metodoPago: "zelle", referenciaPago: "MALA", montoBs: null, tasa: null,
  });
  assert.equal(r.ok, false);
  const despues = (await leerPlanPorGrupo(cli(d), "g-5"))!;
  assert.equal(despues.cuotas[0].referenciaPago, "BUENA");
});

test("planConSaldo es el candado que protege el QR en Finanzas", async () => {
  const { d, total, cuotas, tipo } = doblePlanListo();
  await crearPlan(cli(d), {
    grupoId: "g-6", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "pago_movil", referenciaPago: "1", montoBsInicial: null, tasaAplicada: null,
  });

  // Una compra de contado no tiene plan: Finanzas aprueba como siempre.
  assert.equal(await planConSaldo(cli(d), "g-sin-plan"), null);
  assert.equal(await planConSaldo(cli(d), null), null);

  // Con saldo, aprobar significa "dar por pagada una cuota", no entregar.
  const conSaldo = await planConSaldo(cli(d), "g-6");
  assert.ok(conSaldo, "mientras haya saldo el candado tiene que estar puesto");

  const plan = (await leerPlanPorGrupo(cli(d), "g-6"))!;
  for (const c of plan.cuotas) await verificarCuota(cli(d), { cuotaId: c.id, verificadoPor: "f" });

  assert.equal(await planConSaldo(cli(d), "g-6"), null, "completado: el candado se suelta y el QR sale");
});

test("un plan que se pone al día sale del rojo", async () => {
  const { d, total, cuotas, tipo } = doblePlanListo();
  await crearPlan(cli(d), {
    grupoId: "g-7", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "pago_movil", referenciaPago: "1", montoBsInicial: null, tasaAplicada: null,
  });
  const plan = (await leerPlanPorGrupo(cli(d), "g-7"))!;
  d.tablas.planes_pago[0].estado = "en_mora";

  const v = await verificarCuota(cli(d), { cuotaId: plan.cuotas[0].id, verificadoPor: "f" });
  assert.ok(v.ok);
  assert.equal(v.plan.estado, "al_dia");
});

test("los montos guardados suman el total de la compra, sin centavos perdidos", async () => {
  for (const total of [30, 140, 22, 110, 420, 1400, 33.33, 99.99]) {
    const { d, cuotas, tipo } = doblePlanListo({ total });
    await crearPlan(cli(d), {
      grupoId: `g-${total}`, total, tipo, cantidad: 1, cuotas, canal: "web",
      metodoPago: "pago_movil", referenciaPago: "1", montoBsInicial: null, tasaAplicada: null,
    });
    const plan = (await leerPlanPorGrupo(cli(d), `g-${total}`))!;
    for (const c of plan.cuotas) await verificarCuota(cli(d), { cuotaId: c.id, verificadoPor: "f" });
    const final = (await leerPlanPorGrupo(cli(d), `g-${total}`))!;
    assert.equal(final.pagado, Math.round(total * 100) / 100, `total ${total}`);
    assert.equal(final.saldo, 0, `total ${total} dejó saldo`);
  }
});
