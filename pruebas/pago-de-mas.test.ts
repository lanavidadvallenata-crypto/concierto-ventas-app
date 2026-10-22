// "Llegó más dinero" (Anita, 22 oct): un comprador pagó $60 por una inicial
// de $56 en 2 Preferencial. La diferencia se mueve a la cuota siguiente para
// que el sistema la recuerde solo. Lo que se cuida aquí: que el plan siga
// sumando su total, que nunca se mueva lo que no corresponde y que un fallo a
// mitad de camino no deje el plan descuadrado.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearDoble, CONFIG_ENCENDIDA, type Doble } from "./doble-supabase.ts";
import { crearPlan, leerPlanPorGrupo, moverExcedente, reportarCuota, verificarCuota } from "../src/lib/abona618.ts";
import { planPara } from "../src/lib/cuotas.ts";

const HOY = "2026-10-22";
const cli = (d: Doble) => d.cliente as SupabaseClient;
const suma = (ns: number[]) => Math.round(ns.reduce((s, n) => s + n, 0) * 100) / 100;

async function planDe140(opciones: { tasa?: number | null } = {}) {
  const d = crearDoble({ abona618_config: structuredClone(CONFIG_ENCENDIDA) });
  const calendario = planPara(140, HOY);
  assert.ok(calendario.hayPlan);
  const tasa = opciones.tasa ?? null;
  const r = await crearPlan(cli(d), {
    grupoId: "g-60", total: 140, tipo: "preferencial", cantidad: 2, cuotas: calendario.cuotas, canal: "web",
    metodoPago: tasa ? "pago_movil" : "zelle", referenciaPago: "933179", montoBsInicial: tasa ? 56 * tasa : null, tasaAplicada: tasa,
  });
  assert.equal(r.ok, true);
  const plan = (await leerPlanPorGrupo(cli(d), "g-60"))!;
  return { d, plan };
}

test("el calendario del caso real: $56 hoy, $42 el 30 oct y $42 el 16 nov", async () => {
  const { plan } = await planDe140();
  assert.deepEqual(plan.cuotas.map((c) => c.montoUsd), [56, 42, 42]);
});

test("llegan $60 por la inicial de $56: la inicial queda en $60 y la siguiente baja a $38", async () => {
  const { d, plan } = await planDe140();
  const [inicial, cuota1, final] = plan.cuotas;

  const r = await moverExcedente(cli(d), { cuotaId: inicial.id, recibidoUsd: 60, hoy: HOY });
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(r.excedente, 4);
  assert.deepEqual(r.hacia, { etiqueta: cuota1.etiqueta, antes: 42, despues: 38 });

  const despues = (await leerPlanPorGrupo(cli(d), "g-60"))!;
  assert.deepEqual(despues.cuotas.map((c) => c.montoUsd), [60, 38, 42]);
  assert.equal(suma(despues.cuotas.map((c) => c.montoUsd)), 140, "el plan sigue sumando su total: así completa y entrega los QR");
  assert.equal(despues.cuotas[2].montoUsd, final.montoUsd, "la última no se toca");
  assert.match(despues.cuotas[0].nota ?? "", /\$4\.00 de más/);
  assert.match(despues.cuotas[1].nota ?? "", /Bajó de \$42\.00 a \$38\.00/);

  // Y al aprobarla, lo cobrado es lo que llegó al banco.
  const v = await verificarCuota(cli(d), { cuotaId: inicial.id, verificadoPor: "finanzas-1" });
  assert.ok(v.ok);
  assert.equal(v.plan.pagado, 60);
  assert.equal(v.plan.saldo, 80);
  assert.equal(v.plan.proxima?.montoUsd, 38, "el próximo recordatorio pide $38, no $42");
});

test("en bolívares se convierte con la tasa guardada en la cuota y se guardan los Bs reales", async () => {
  const { d, plan } = await planDe140({ tasa: 200 });
  const r = await moverExcedente(cli(d), { cuotaId: plan.cuotas[0].id, recibidoBs: 12000, hoy: HOY });
  assert.ok(r.ok, r.ok ? "" : r.error);
  const despues = (await leerPlanPorGrupo(cli(d), "g-60"))!;
  assert.deepEqual(despues.cuotas.map((c) => c.montoUsd), [60, 38, 42]);
  assert.equal(despues.cuotas[0].montoBs, 12000, "los Bs que se cruzan con el banco son los que llegaron");
});

test("sin tasa guardada no adivina: pide el monto en dólares", async () => {
  const { d, plan } = await planDe140();
  const r = await moverExcedente(cli(d), { cuotaId: plan.cuotas[0].id, recibidoBs: 12000, hoy: HOY });
  assert.equal(r.ok, false);
});

for (const [caso, recibido, motivo] of [
  ["menos de la cuota", 50, /menos/],
  ["lo mismo que la cuota", 56, /lo mismo/],
  ["tanto que cubre la siguiente entera", 98, /completa/],
] as const) {
  test(`no mueve nada si llega ${caso}`, async () => {
    const { d, plan } = await planDe140();
    const r = await moverExcedente(cli(d), { cuotaId: plan.cuotas[0].id, recibidoUsd: recibido, hoy: HOY });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, motivo);
    const despues = (await leerPlanPorGrupo(cli(d), "g-60"))!;
    assert.deepEqual(despues.cuotas.map((c) => c.montoUsd), [56, 42, 42]);
  });
}

test("en el último pago no hay de dónde descontar: se devuelve la diferencia", async () => {
  const { d, plan } = await planDe140();
  const [inicial, cuota1, final] = plan.cuotas;
  for (const c of [inicial, cuota1]) await verificarCuota(cli(d), { cuotaId: c.id, verificadoPor: "f1" });
  await reportarCuota(cli(d), { cuotaId: final.id, grupoId: "g-60", metodoPago: "zelle", referenciaPago: "Z1", montoBs: null, tasa: null });
  const r = await moverExcedente(cli(d), { cuotaId: final.id, recibidoUsd: 45, hoy: HOY });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /último pago/);
});

test("si la siguiente ya tiene un pago anotado, no la toca", async () => {
  const { d, plan } = await planDe140();
  await reportarCuota(cli(d), { cuotaId: plan.cuotas[1].id, grupoId: "g-60", metodoPago: "zelle", referenciaPago: "Z2", montoBs: null, tasa: null });
  const r = await moverExcedente(cli(d), { cuotaId: plan.cuotas[0].id, recibidoUsd: 60, hoy: HOY });
  assert.equal(r.ok, false);
  const despues = (await leerPlanPorGrupo(cli(d), "g-60"))!;
  assert.deepEqual(despues.cuotas.map((c) => c.montoUsd), [56, 42, 42]);
});

test("una cuota ya aprobada no se mueve", async () => {
  const { d, plan } = await planDe140();
  await verificarCuota(cli(d), { cuotaId: plan.cuotas[0].id, verificadoPor: "f1" });
  const r = await moverExcedente(cli(d), { cuotaId: plan.cuotas[0].id, recibidoUsd: 60, hoy: HOY });
  assert.equal(r.ok, false);
});

test("si la siguiente cambia a mitad de camino, la primera se devuelve y el plan no se descuadra", async () => {
  const { d, plan } = await planDe140();
  const [inicial, cuota1] = plan.cuotas;
  // Alguien anota un pago en la Cuota 01 justo entre los dos UPDATE.
  const original = (d.cliente as { from: (t: string) => Record<string, unknown> }).from;
  let updatesCuotas = 0;
  (d.cliente as { from: unknown }).from = (tabla: string) => {
    const api = original(tabla);
    if (tabla !== "cuotas") return api;
    const update = api.update as (v: unknown) => unknown;
    api.update = (v: unknown) => {
      updatesCuotas += 1;
      if (updatesCuotas === 2) {
        const fila = d.tablas.cuotas.find((c) => c.id === cuota1.id)!;
        fila.reportado_en = "2026-10-22T15:00:00Z";
      }
      return update(v);
    };
    return api;
  };

  const r = await moverExcedente(cli(d), { cuotaId: inicial.id, recibidoUsd: 60, hoy: HOY });
  assert.equal(r.ok, false);
  const despues = (await leerPlanPorGrupo(cli(d), "g-60"))!;
  assert.deepEqual(despues.cuotas.map((c) => c.montoUsd), [56, 42, 42], "todo vuelve a como estaba");
  assert.equal(despues.cuotas[0].nota ?? null, inicial.nota ?? null, "ni la nota queda a medias");
});
