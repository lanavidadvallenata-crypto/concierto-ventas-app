// Venta en cuotas desde Ventas (Anita, 22 oct). Lo que se cuida: que la
// vendedora no pueda registrar menos que la inicial, que lo pagado de más se
// mida igual que en Cobranza, y que la inicial quede anotada por ella (así no
// puede aprobar su propia venta).

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearDoble, CONFIG_ENCENDIDA, type Doble } from "./doble-supabase.ts";
import { crearPlan, leerPlanPorGrupo, moverExcedente } from "../src/lib/abona618.ts";
import { planPara } from "../src/lib/cuotas.ts";
import { leerPagoInicial } from "../src/lib/venta-cuotas.ts";

const cli = (d: Doble) => d.cliente as SupabaseClient;

test("vacío = pagó la inicial justa, en dólares y en bolívares", () => {
  assert.deepEqual(leerPagoInicial({ inicialUsd: 56, enBs: false, tasa: null, texto: "" }), { ok: true, pagadoUsd: 56, pagadoBs: null, excedenteUsd: 0 });
  const bs = leerPagoInicial({ inicialUsd: 56, enBs: true, tasa: 988.97, texto: "  " });
  assert.ok(bs.ok);
  assert.equal(bs.pagadoBs, 55382.32);
  assert.equal(bs.excedenteUsd, 0);
});

test("el caso real: pagó $60 por una inicial de $56", () => {
  const usd = leerPagoInicial({ inicialUsd: 56, enBs: false, tasa: null, texto: "60" });
  assert.ok(usd.ok);
  assert.equal(usd.excedenteUsd, 4);
  const bs = leerPagoInicial({ inicialUsd: 56, enBs: true, tasa: 988.97, texto: "59.338,20" });
  assert.ok(bs.ok);
  assert.equal(bs.pagadoUsd, 60);
  assert.equal(bs.pagadoBs, 59338.2, "se guardan los bolívares exactos, que son los que se cruzan con el banco");
  assert.equal(bs.excedenteUsd, 4);
});

test("menos que la inicial no se puede registrar", () => {
  const r = leerPagoInicial({ inicialUsd: 56, enBs: false, tasa: null, texto: "50" });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /al menos la inicial/);
});

test("en bolívares sin tasa no se adivina", () => {
  assert.equal(leerPagoInicial({ inicialUsd: 56, enBs: true, tasa: null, texto: "" }).ok, false);
});

test("basura en el monto se rechaza con la explicación", () => {
  assert.equal(leerPagoInicial({ inicialUsd: 56, enBs: false, tasa: null, texto: "sesenta" }).ok, false);
});

test("la inicial de una venta de Ventas queda anotada POR la vendedora, con canal y nota", async () => {
  const d = crearDoble({ abona618_config: structuredClone(CONFIG_ENCENDIDA) });
  const calendario = planPara(140, "2026-10-22");
  assert.ok(calendario.hayPlan);
  const r = await crearPlan(cli(d), {
    grupoId: "g-ventas", total: 140, tipo: "preferencial", cantidad: 2, cuotas: calendario.cuotas, canal: "manual",
    creadoPor: "vendedora-1", metodoPago: "pago_movil", referenciaPago: "933179", montoBsInicial: 59338.2, tasaAplicada: 988.97,
    reportadoPor: "vendedora-1", canalReporte: "presencial", notaInicial: "Pagó $60.00: usar Llegó más dinero",
  });
  assert.equal(r.ok, true);
  const plan = (await leerPlanPorGrupo(cli(d), "g-ventas"))!;
  const inicial = plan.cuotas[0];
  assert.equal(inicial.reportadoPor, "vendedora-1", "así el control cruzado no la deja aprobar su propia venta");
  assert.equal(inicial.canalReporte, "presencial");
  assert.equal(inicial.montoBs, 59338.2);
  assert.equal(inicial.tasaAplicada, 988.97);
  assert.equal(plan.cuotas[1].reportadoEn, null, "solo la inicial viene anotada");

  // Y Finanzas, con los Bs anotados, mueve los $4 a la cuota siguiente.
  const m = await moverExcedente(cli(d), { cuotaId: inicial.id, recibidoBs: 59338.2, hoy: "2026-10-22" });
  assert.ok(m.ok, m.ok ? "" : m.error);
  const despues = (await leerPlanPorGrupo(cli(d), "g-ventas"))!;
  assert.deepEqual(despues.cuotas.map((c) => c.montoUsd), [60, 38, 42]);
});

test("una venta web sigue igual: la inicial la reportó el comprador", async () => {
  const d = crearDoble({ abona618_config: structuredClone(CONFIG_ENCENDIDA) });
  const calendario = planPara(140, "2026-10-22");
  assert.ok(calendario.hayPlan);
  await crearPlan(cli(d), {
    grupoId: "g-web", total: 140, tipo: "preferencial", cantidad: 2, cuotas: calendario.cuotas, canal: "web",
    metodoPago: "zelle", referenciaPago: "Z1", montoBsInicial: null, tasaAplicada: null,
  });
  const plan = (await leerPlanPorGrupo(cli(d), "g-web"))!;
  assert.equal(plan.cuotas[0].reportadoPor, null);
  assert.equal(plan.cuotas[0].canalReporte, null);
});
