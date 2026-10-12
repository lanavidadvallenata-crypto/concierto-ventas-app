// Pruebas de la capa de datos de Abona618 contra un doble de Supabase en
// memoria. Lo que se está cuidando aquí es que un error de la base, un reporte
// falso o dos personas de Finanzas aprobando a la vez no terminen en una
// entrada entregada sin pagar.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearDoble, CONFIG_ENCENDIDA, CONFIG_APAGADA_FILA, type Doble } from "./doble-supabase.ts";
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

test("sin tabla de configuración el módulo queda cerrado, con motivo de ERROR", async () => {
  const d = crearDoble();
  const config = await leerConfig(cli(d));
  assert.equal(config.activo, false);
  assert.equal(config.error, true, "hay que poder distinguir 'no pude leer' de 'está apagado'");

  const r = await planOfrecible(cli(d), { tipo: "general", cantidad: 1, total: 30, hoy: HOY });
  assert.equal(r.plan.hayPlan, false);
  assert.equal(r.plan.hayPlan === false && r.plan.motivo, "error");
});

test("con el interruptor en false el motivo es APAGADO, y eso jamás se honra", async () => {
  const d = crearDoble({ abona618_config: structuredClone(CONFIG_APAGADA_FILA) });
  const config = await leerConfig(cli(d));
  assert.equal(config.activo, false);
  assert.equal(config.error, false, "la lectura funcionó: está apagado a propósito");

  const r = await planOfrecible(cli(d), { tipo: "vip", cantidad: 1, total: 140, hoy: HOY });
  assert.equal(r.plan.hayPlan === false && r.plan.motivo, "apagado");
  assert.equal(r.vipEnPlan, null, "con el módulo apagado no se mide nada: null, no cero");
});

test("si la lectura de la configuración falla, tampoco se ofrece el plan", async () => {
  const d = crearDoble({ abona618_config: structuredClone(CONFIG_ENCENDIDA) });
  d.fallar.abona618_config = "conexión caída";
  const r = await planOfrecible(cli(d), { tipo: "general", cantidad: 1, total: 30, hoy: HOY });
  assert.equal(r.plan.hayPlan, false, "un error de base nunca debe abrir el crédito");
});

test("si el conteo de VIP falla, el motivo es ERROR y no 'tope lleno'", async () => {
  const d = crearDoble({ abona618_config: structuredClone(CONFIG_ENCENDIDA), planes_pago: [] });
  d.fallar.planes_pago = "timeout";
  assert.equal(await contarVipEnPlan(cli(d)), null, "null es 'no se pudo medir', no un número");

  const r = await planOfrecible(cli(d), { tipo: "vip", cantidad: 1, total: 140, hoy: HOY });
  assert.equal(r.plan.hayPlan, false);
  // Esta distinción es la que impide que un timeout termine en crédito: el
  // checkout honra "tope_vip" y nunca honra "error".
  assert.equal(r.plan.hayPlan === false && r.plan.motivo, "error");
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
    cuotaId: plan0.cuotas[1].id, grupoId: "g-3", metodoPago: "pago_movil", referenciaPago: "222333", montoBs: 4000, tasa: 176,
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

test("verificar dos veces la misma cuota es idempotente, no un error", async () => {
  const { d, total, cuotas, tipo } = doblePlanListo();
  await crearPlan(cli(d), {
    grupoId: "g-4", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "binance", referenciaPago: "818097513", montoBsInicial: null, tasaAplicada: null,
  });
  const plan = (await leerPlanPorGrupo(cli(d), "g-4"))!;

  const a = await verificarCuota(cli(d), { cuotaId: plan.cuotas[0].id, verificadoPor: "finanzas-1" });
  const b = await verificarCuota(cli(d), { cuotaId: plan.cuotas[0].id, verificadoPor: "finanzas-2" });
  assert.ok(a.ok);
  assert.ok(b.ok, "el reintento no es un error: tiene que poder recalcular");
  assert.equal(a.yaEstaba, false);
  assert.equal(b.yaEstaba, true, "la segunda sabe que no fue ella: así nadie manda el correo dos veces");
  assert.equal(b.plan.pagado, a.plan.pagado, "y el saldo no se cuenta dos veces");
});

test("CARRERA REAL: dos cuotas distintas a la vez completan el plan UNA sola vez", async () => {
  // La prueba anterior se llamaba "dos personas a la vez" y hacía await de una
  // y después de la otra: eso probaba un reintento, no una carrera. El caso
  // peligroso es otro — dos cuotas DISTINTAS del mismo plan — y si las dos
  // devuelven completo:true, el comprador recibe los QR dos veces.
  const { d, total, cuotas, tipo } = doblePlanListo();
  await crearPlan(cli(d), {
    grupoId: "g-carrera", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "pago_movil", referenciaPago: "1", montoBsInicial: null, tasaAplicada: null,
  });
  const plan = (await leerPlanPorGrupo(cli(d), "g-carrera"))!;
  await verificarCuota(cli(d), { cuotaId: plan.cuotas[0].id, verificadoPor: "f1" });

  const [x, y] = await Promise.all([
    verificarCuota(cli(d), { cuotaId: plan.cuotas[1].id, verificadoPor: "f1" }),
    verificarCuota(cli(d), { cuotaId: plan.cuotas[2].id, verificadoPor: "f2" }),
  ]);
  assert.ok(x.ok && y.ok);
  const entregas = [x, y].filter((r) => r.ok && r.completo).length;
  assert.equal(entregas, 1, `el plan se completó ${entregas} veces; los QR saldrían ${entregas} veces`);

  const final = (await leerPlanPorGrupo(cli(d), "g-carrera"))!;
  assert.equal(final.saldo, 0);
  assert.equal(final.estado, "completado");
});

test("el candado del QR no se suelta en un plan VENCIDO ni ANULADO", async () => {
  // Esta era la inversión peor del módulo: planConSaldo devolvía null para los
  // planes vencidos y anulados, o sea "no hay plan, aprueba normal". Un plan
  // vencido tiene sus tickets todavía en pendiente y sigue en la cola de
  // Finanzas: aprobarlo entregaría la entrada completa a quien dejó de pagar.
  for (const estado of ["vencido", "anulado", "en_mora", "al_dia"]) {
    const { d, total, cuotas, tipo } = doblePlanListo();
    await crearPlan(cli(d), {
      grupoId: "g-est", total, tipo, cantidad: 1, cuotas, canal: "web",
      metodoPago: "pago_movil", referenciaPago: "1", montoBsInicial: null, tasaAplicada: null,
    });
    d.tablas.planes_pago[0].estado = estado;
    const cand = await planConSaldo(cli(d), "g-est");
    assert.ok(cand, `con saldo y estado "${estado}" el candado tiene que seguir puesto`);
  }
});

test("verificar un pago sobre un plan muerto no lo resucita", async () => {
  for (const estado of ["anulado", "vencido"]) {
    const { d, total, cuotas, tipo } = doblePlanListo();
    await crearPlan(cli(d), {
      grupoId: "g-res", total, tipo, cantidad: 1, cuotas, canal: "web",
      metodoPago: "pago_movil", referenciaPago: "1", montoBsInicial: null, tasaAplicada: null,
    });
    const plan = (await leerPlanPorGrupo(cli(d), "g-res"))!;
    await verificarCuota(cli(d), { cuotaId: plan.cuotas[0].id, verificadoPor: "f" });
    await verificarCuota(cli(d), { cuotaId: plan.cuotas[1].id, verificadoPor: "f" });
    d.tablas.planes_pago[0].estado = estado;

    const r = await verificarCuota(cli(d), { cuotaId: plan.cuotas[2].id, verificadoPor: "f" });
    assert.equal(r.ok, false, `un plan ${estado} no puede pasar a completado: su silla ya se revendió`);
    assert.equal(d.tablas.planes_pago[0].estado, estado, "y su estado no se toca");
  }
});

test("un fallo parcial deja la cuota verificada, y el reintento SÍ repara", async () => {
  // El caso real: el UPDATE de la cuota se escribe y la lectura del plan se
  // cae por timeout. Antes esto devolvía "esa cuota ya la verificó otra
  // persona" en el reintento y se quedaba ahí: un plan pagado al 100 % que el
  // sistema creía incompleto, sin forma de arreglarlo desde la interfaz.
  const { d, total, cuotas, tipo } = doblePlanListo();
  await crearPlan(cli(d), {
    grupoId: "g-parcial", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "pago_movil", referenciaPago: "1", montoBsInicial: null, tasaAplicada: null,
  });
  const plan = (await leerPlanPorGrupo(cli(d), "g-parcial"))!;
  for (const c of plan.cuotas.slice(0, 2)) await verificarCuota(cli(d), { cuotaId: c.id, verificadoPor: "f" });

  d.fallarDespues["planes_pago:select"] = "statement timeout";
  const roto = await verificarCuota(cli(d), { cuotaId: plan.cuotas[2].id, verificadoPor: "f" });
  assert.equal(roto.ok, false, "se informa el fallo");

  delete d.fallarDespues["planes_pago:select"];
  const reintento = await verificarCuota(cli(d), { cuotaId: plan.cuotas[2].id, verificadoPor: "f" });
  assert.ok(reintento.ok, "el reintento no puede responder 'ya la verificó otra persona' y rendirse");
  assert.equal(reintento.completo, true, "tiene que completar el plan que quedó a medias");
  assert.equal(reintento.plan.estado, "completado");
  assert.equal(reintento.plan.saldo, 0);
});

test("no se puede reportar un pago sobre la compra de otra persona", async () => {
  const { d, total, cuotas, tipo } = doblePlanListo();
  await crearPlan(cli(d), {
    grupoId: "g-mio", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "pago_movil", referenciaPago: "1", montoBsInicial: null, tasaAplicada: null,
  });
  const plan2 = planPara(30, HOY);
  assert.ok(plan2.hayPlan);
  await crearPlan(cli(d), {
    grupoId: "g-ajeno", total: 30, tipo: "general", cantidad: 1, cuotas: plan2.cuotas, canal: "web",
    metodoPago: "pago_movil", referenciaPago: "2", montoBsInicial: null, tasaAplicada: null,
  });
  const ajeno = (await leerPlanPorGrupo(cli(d), "g-ajeno"))!;

  const r = await reportarCuota(cli(d), {
    cuotaId: ajeno.cuotas[1].id, grupoId: "g-mio",
    metodoPago: "zelle", referenciaPago: "INTRUSO", montoBs: null, tasa: null,
  });
  assert.equal(r.ok, false, "el id de una cuota no puede ser la única llave");
  const despues = (await leerPlanPorGrupo(cli(d), "g-ajeno"))!;
  assert.equal(despues.cuotas[1].referenciaPago, null, "y la cuota ajena queda intacta");
});

test("dos planes para la misma compra: el segundo choca, no se duplica", async () => {
  const { d, total, cuotas, tipo } = doblePlanListo();
  const base = {
    grupoId: "g-dup", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "pago_movil", referenciaPago: "1", montoBsInicial: null, tasaAplicada: null,
  };
  assert.equal((await crearPlan(cli(d), base)).ok, true);
  assert.equal((await crearPlan(cli(d), base)).ok, false, "grupo_id es unique en la base");
  assert.equal(d.tablas.planes_pago.length, 1);
});

test("crearPlan escribe el estado y el sello de aceptación, sin depender de defaults", async () => {
  const { d, total, cuotas, tipo } = doblePlanListo();
  await crearPlan(cli(d), {
    grupoId: "g-sello", total, tipo, cantidad: 1, cuotas, canal: "web",
    metodoPago: "pago_movil", referenciaPago: "1", montoBsInicial: null, tasaAplicada: null,
  });
  const fila = d.tablas.planes_pago[0];
  assert.equal(fila.estado, "al_dia", "contarVipEnPlan filtra por estado: no puede llegar undefined");
  assert.ok(fila.acepto_condiciones_en, "el correo de anulación cita esta fecha");
  assert.equal(fila.condiciones_version, "v1");
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
    cuotaId: plan.cuotas[0].id, grupoId: "g-5", metodoPago: "zelle", referenciaPago: "MALA", montoBs: null, tasa: null,
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
