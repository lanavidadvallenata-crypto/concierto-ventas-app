// Corregir un pago mal anotado sin rechazarlo (Anita, 30 oct). Caso real:
// Marian, cuota de $21 a tasa 992,80 → Bs 20.848,80, anotada como
// Bs 2.084.880 (sin la coma). Lo que se cuida: que el pago siga donde estaba
// (por confirmar o confirmado), que quede quién lo cambió y qué decía antes,
// que lo confirmado solo lo toque un admin y que un pago que cubre dos cuotas
// se corrija entero.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearDoble, type Doble } from "./doble-supabase.ts";
import {
  bsParaEscribir,
  corregirPago,
  cuotasDelMismoPago,
  lineaDeCorreccion,
  metodosParaCorregir,
  montoNoCuadra,
  repartirEnBs,
  type CuotaDePago,
} from "../src/lib/correccion-pago.ts";
import { parsearMontoBs } from "../src/lib/formato.ts";

const TASA = 992.8;
const cli = (d: Doble) => d.cliente as SupabaseClient;
const EQUIPO = { id: "u-yoselin", nombre: "Yoselin", esAdmin: false };
const ADMIN = { id: "u-anita", nombre: "Anita", esAdmin: true };

// ---------------------------------------------------------------- puras

test("el monto bien escrito cuadra; el de la coma corrida no", () => {
  assert.equal(montoNoCuadra(20848.8, 21, TASA), null);
  const malo = montoNoCuadra(2084880, 21, TASA);
  assert.ok(malo);
  assert.equal(malo.usdEquivalente, 2100);
  assert.equal(malo.esperadoBs, 20848.8);
  // Por debajo también: Bs 2.084,88 por una cuota de $21.
  assert.ok(montoNoCuadra(2084.88, 21, TASA));
});

test("tolera la diferencia de tasa de un día a otro (±15 %)", () => {
  assert.equal(montoNoCuadra(20848.8 * 1.1, 21, TASA), null);
  assert.equal(montoNoCuadra(20848.8 * 0.9, 21, TASA), null);
  assert.ok(montoNoCuadra(20848.8 * 1.2, 21, TASA));
});

test("sin tasa o sin monto no hay con qué comparar: no avisa", () => {
  assert.equal(montoNoCuadra(2084880, 21, null), null);
  assert.equal(montoNoCuadra(null, 21, TASA), null);
  assert.equal(montoNoCuadra(2084880, 0, TASA), null);
});

test("el prellenado se escribe como en Venezuela y se lee igual de vuelta", () => {
  assert.equal(bsParaEscribir(20848.8), "20.848,80");
  assert.equal(parsearMontoBs(bsParaEscribir(20848.8)), 20848.8);
  assert.equal(parsearMontoBs(bsParaEscribir(8935.2)), 8935.2);
});

test("repartir Bs entre cuotas cuadra al céntimo", () => {
  const partes = repartirEnBs(41697.6, [21, 21]);
  assert.deepEqual(partes, [20848.8, 20848.8]);
  const raras = repartirEnBs(1000.01, [1, 1, 1]);
  assert.equal(Math.round(raras.reduce((s, x) => s + x, 0) * 100), 100001);
  assert.deepEqual(repartirEnBs(50, []), []);
});

const base = (x: Partial<CuotaDePago> & { id: string }): CuotaDePago => ({
  montoUsd: 21,
  metodoPago: "pago_movil",
  referenciaPago: "123456",
  montoBs: 20848.8,
  reportadoEn: "2026-10-30T15:00:00Z",
  verificadoEn: null,
  nota: null,
  ...x,
});

test("mismo pago = misma referencia, mismo estado y anotadas juntas", () => {
  const todas = [
    base({ id: "a" }),
    base({ id: "b", reportadoEn: "2026-10-30T15:02:00Z" }),
    base({ id: "c", referenciaPago: "999999" }),
    base({ id: "d", verificadoEn: "2026-10-30T15:30:00Z" }),
    base({ id: "e", reportadoEn: "2026-10-30T15:10:00Z" }),
  ];
  assert.deepEqual(cuotasDelMismoPago(todas, "a").map((c) => c.id), ["a", "b"]);
  assert.deepEqual(cuotasDelMismoPago(todas, "c").map((c) => c.id), ["c"]);
  assert.deepEqual(cuotasDelMismoPago(todas, "nada"), []);
});

test("la nota dice quién, cuándo (hora de Venezuela) y qué decía antes", () => {
  const l = lineaDeCorreccion(
    "Yoselin",
    { metodoPago: "pago_movil", referenciaPago: "123456", montoBsTotal: 2084880 },
    new Date("2026-10-30T15:13:00Z")
  );
  assert.match(l, /^Corregido por Yoselin el 30\/10/);
  assert.match(l, /11:13/);
  assert.match(l, /antes: Pago móvil · ref\. 123456 · Bs 2\.084\.880,00/);
});

test("el método solo cambia dentro de la misma moneda", () => {
  assert.deepEqual(metodosParaCorregir("pago_movil", "web"), ["pago_movil", "transferencia"]);
  assert.deepEqual(metodosParaCorregir("pago_movil", "manual"), ["pago_movil", "transferencia", "efectivo_bs"]);
  assert.deepEqual(metodosParaCorregir("zelle", "web"), ["zelle", "binance"]);
  assert.deepEqual(metodosParaCorregir("cortesia", "cortesia"), []);
  assert.deepEqual(metodosParaCorregir("inventado", "web"), []);
});

// ------------------------------------------------------- con el doble

function planDeMarian(opciones: { verificada?: boolean; inicialJunta?: boolean } = {}) {
  const verificadoEn = opciones.verificada ? "2026-10-30T15:30:00Z" : null;
  const inicial = opciones.inicialJunta
    ? { reportado_en: "2026-10-30T15:00:00Z", verificado_en: verificadoEn, metodo_pago: "pago_movil", referencia_pago: "123456", monto_bs: 1042440 }
    : { reportado_en: "2026-10-15T15:00:00Z", verificado_en: "2026-10-15T16:00:00Z", metodo_pago: "zelle", referencia_pago: "ABC123", monto_bs: null };
  return crearDoble({
    cuotas: [
      { id: "q0", plan_id: "p1", orden: 1, monto_usd: 21, nota: null, ...inicial },
      {
        id: "q1", plan_id: "p1", orden: 2, monto_usd: 21, nota: "Pagó desde la cuenta de su mamá.",
        reportado_en: "2026-10-30T15:01:00Z", verificado_en: verificadoEn,
        metodo_pago: "pago_movil", referencia_pago: "123456", monto_bs: opciones.inicialJunta ? 1042440 : 2084880,
      },
      { id: "q2", plan_id: "p1", orden: 3, monto_usd: 21, nota: null, reportado_en: null, verificado_en: null, metodo_pago: null, referencia_pago: null, monto_bs: null },
    ],
  });
}
const fila = (d: Doble, id: string) => d.tablas.cuotas.find((c) => c.id === id)!;

test("Marian: el equipo corrige Bs 2.084.880 → 20.848,80 y el pago sigue por confirmar", async () => {
  const d = planDeMarian();
  const r = await corregirPago(cli(d), { cuotaId: "q1", metodoPago: "pago_movil", referenciaPago: "123456", montoBs: 20848.8, quien: EQUIPO });
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.cambio);
  const q1 = fila(d, "q1");
  assert.equal(q1.monto_bs, 20848.8);
  assert.equal(q1.verificado_en, null);
  assert.equal(q1.reportado_en, "2026-10-30T15:01:00Z");
  // La nota anterior se conserva y se agrega la corrección.
  assert.match(String(q1.nota), /^Pagó desde la cuenta de su mamá\. Corregido por Yoselin/);
  assert.match(String(q1.nota), /Bs 2\.084\.880,00/);
  // Las otras cuotas no se tocan.
  assert.equal(fila(d, "q0").referencia_pago, "ABC123");
  assert.equal(fila(d, "q2").reportado_en, null);
});

test("corregir la referencia de pago móvil la deja como la guarda Finanzas", async () => {
  const d = planDeMarian();
  const r = await corregirPago(cli(d), { cuotaId: "q1", metodoPago: "pago_movil", referenciaPago: " 65-4321 ", montoBs: 2084880, quien: EQUIPO });
  assert.equal(r.ok, true);
  assert.equal(fila(d, "q1").referencia_pago, "654321");
});

test("un pago ya confirmado: el equipo no puede, un admin sí", async () => {
  const d = planDeMarian({ verificada: true });
  const r1 = await corregirPago(cli(d), { cuotaId: "q1", metodoPago: "pago_movil", referenciaPago: "123456", montoBs: 20848.8, quien: EQUIPO });
  assert.equal(r1.ok, false);
  assert.ok(!r1.ok && /solo un admin/.test(r1.error));
  assert.equal(fila(d, "q1").monto_bs, 2084880);

  const r2 = await corregirPago(cli(d), { cuotaId: "q1", metodoPago: "pago_movil", referenciaPago: "123456", montoBs: 20848.8, quien: ADMIN });
  assert.equal(r2.ok, true);
  assert.equal(fila(d, "q1").monto_bs, 20848.8);
  assert.equal(fila(d, "q1").verificado_en, "2026-10-30T15:30:00Z");
  assert.match(String(fila(d, "q1").nota), /Corregido por Anita/);
});

test("un comprobante que cubre dos cuotas se corrige entero y se reparte", async () => {
  const d = planDeMarian({ inicialJunta: true });
  const r = await corregirPago(cli(d), { cuotaId: "q1", metodoPago: "pago_movil", referenciaPago: "123456", montoBs: 41697.6, quien: EQUIPO });
  assert.ok(r.ok && r.cuotas === 2);
  assert.equal(fila(d, "q0").monto_bs, 20848.8);
  assert.equal(fila(d, "q1").monto_bs, 20848.8);
  assert.match(String(fila(d, "q0").nota), /Bs 2\.084\.880,00/);
});

test("si ya decía eso, no escribe nada", async () => {
  const d = planDeMarian();
  d.llamadas.length = 0;
  const r = await corregirPago(cli(d), { cuotaId: "q1", metodoPago: "pago_movil", referenciaPago: "123456", montoBs: 2084880, quien: EQUIPO });
  assert.ok(r.ok && !r.cambio);
  assert.ok(!d.llamadas.some((l) => l.startsWith("update")));
  assert.equal(fila(d, "q1").nota, "Pagó desde la cuenta de su mamá.");
});

test("lo que no se puede corregir se dice claro y no toca nada", async () => {
  const d = planDeMarian();
  const sinReporte = await corregirPago(cli(d), { cuotaId: "q2", metodoPago: "pago_movil", referenciaPago: "123456", montoBs: 20848.8, quien: EQUIPO });
  assert.ok(!sinReporte.ok && /Anotar un pago/.test(sinReporte.error));

  const sinMonto = await corregirPago(cli(d), { cuotaId: "q1", metodoPago: "pago_movil", referenciaPago: "123456", montoBs: null, quien: EQUIPO });
  assert.ok(!sinMonto.ok && /bolívares/.test(sinMonto.error));

  const refMala = await corregirPago(cli(d), { cuotaId: "q1", metodoPago: "pago_movil", referenciaPago: "12", montoBs: 20848.8, quien: EQUIPO });
  assert.ok(!refMala.ok && /6 dígitos/.test(refMala.error));

  const noExiste = await corregirPago(cli(d), { cuotaId: "zz", metodoPago: "pago_movil", referenciaPago: "123456", montoBs: 20848.8, quien: EQUIPO });
  assert.equal(noExiste.ok, false);

  assert.equal(fila(d, "q1").monto_bs, 2084880);
});

test("pasar a Zelle borra el monto en Bs", async () => {
  const d = planDeMarian();
  const r = await corregirPago(cli(d), { cuotaId: "q1", metodoPago: "zelle", referenciaPago: "zx 99 ab", quien: EQUIPO });
  assert.equal(r.ok, true);
  assert.equal(fila(d, "q1").metodo_pago, "zelle");
  assert.equal(fila(d, "q1").referencia_pago, "ZX99AB");
  assert.equal(fila(d, "q1").monto_bs, null);
});

test("si alguien lo confirma mientras se corrige, no se pisa", async () => {
  const d = planDeMarian();
  const cliente = d.cliente as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> };
  const fromOriginal = cliente.from;
  cliente.from = (t: string) => {
    const api = fromOriginal(t);
    const update = api.update;
    // Justo antes de escribir, Finanzas confirma el pago en otra pantalla.
    api.update = (v: unknown) => {
      fila(d, "q1").verificado_en = "2026-10-30T15:20:00Z";
      return update(v);
    };
    return api;
  };
  const r = await corregirPago(cli(d), { cuotaId: "q1", metodoPago: "pago_movil", referenciaPago: "123456", montoBs: 20848.8, quien: EQUIPO });
  assert.ok(!r.ok && /se confirmó mientras/.test(r.error));
  assert.equal(fila(d, "q1").monto_bs, 2084880);
});
