import { test } from "node:test";
import assert from "node:assert/strict";
import { mensajeCotizacion, sumarPorFecha, validarPedido, type Cotizacion, type LineaCotizada } from "../src/lib/cotizador.ts";
import { aPlanPublico, planPara } from "../src/lib/cuotas.ts";

const HOY = "2026-10-20"; // hasta el 30 oct: 3 pagos (hoy, a los 14 y a los 28 días)
const TASA = 1000;

function linea(tipo: "vip" | "preferencial" | "general", cantidad: number, total: number, hoy = HOY): LineaCotizada {
  const p = planPara(total, hoy, { tipo, cantidad });
  return {
    tipo,
    cantidad,
    total,
    plan: p.hayPlan ? aPlanPublico(p) : null,
    sinPlan: p.hayPlan ? null : p.motivo,
    disponibles: 50,
  };
}

test("validarPedido: cantidades, máximos por compra y pedido vacío", () => {
  assert.deepEqual(validarPedido({ preferencial: 2, general: 1 }), {
    ok: true,
    lineas: [
      { tipo: "preferencial", cantidad: 2 },
      { tipo: "general", cantidad: 1 },
    ],
  });
  assert.equal(validarPedido({}).ok, false);
  assert.equal(validarPedido({ preferencial: 9 }).ok, false); // máx 8 (mesas de 8 desde el 24 oct)
  assert.equal(validarPedido({ preferencial: 8 }).ok, true); // una mesa completa sí
  assert.equal(validarPedido({ general: 1.5 }).ok, false);
  assert.equal(validarPedido({ vip: -1 }).ok, false);
});

test("caso Aide: 2 Preferenciales + 1 General = $68 hoy, $51 a los 14 días, $51 a los 28", () => {
  const lineas = [linea("preferencial", 2, 140), linea("general", 1, 30)];
  // Cada compra por separado, como la cobra la web.
  assert.deepEqual(lineas[0].plan!.cuotas.map((c) => c.monto), [56, 42, 42]);
  assert.deepEqual(lineas[1].plan!.cuotas.map((c) => c.monto), [12, 9, 9]);

  const porFecha = sumarPorFecha(lineas, HOY, TASA);
  assert.deepEqual(
    porFecha.map((p) => [p.venceEl, p.usd, p.esHoy]),
    [
      ["2026-10-20", 68, true],
      ["2026-11-03", 51, false],
      ["2026-11-17", 51, false],
    ]
  );
  assert.equal(porFecha[0].bs, 68000);
});

test("desde el 31 oct son 2 pagos: mitad hoy y mitad a los 14 días, aunque caiga sábado", () => {
  const l = linea("preferencial", 1, 70, "2026-10-31");
  assert.deepEqual(l.plan!.cuotas.map((c) => [c.venceEl, c.monto]), [
    ["2026-10-31", 35],
    ["2026-11-14", 35],
  ]);
});

test("sin plan, la compra entera se suma a hoy", () => {
  const l: LineaCotizada = { tipo: "vip", cantidad: 1, total: 140, plan: null, sinPlan: "tope_vip", disponibles: 3 };
  const porFecha = sumarPorFecha([l, linea("general", 1, 30)], HOY, null);
  assert.equal(porFecha[0].usd, 152); // 140 + 12
  assert.equal(porFecha[0].bs, null);
});

test("el mensaje: montos correctos, sin gracia, sin 'La Navidad', sin número de cuotas", () => {
  const lineas = [linea("preferencial", 2, 140), linea("general", 1, 30)];
  const c: Cotizacion = { hoy: HOY, tasaEurVes: TASA, lineas, porFecha: sumarPorFecha(lineas, HOY, TASA), totalUsd: 170 };
  const m = mensajeCotizacion(c);
  assert.match(m, /2 entradas Preferenciales \(\$140\.00\): hoy \$56\.00 · 3 de noviembre \$42\.00 · 17 de noviembre \$42\.00/);
  assert.match(m, /1 entrada General \(\$30\.00\): hoy \$12\.00/);
  assert.match(m, /Total hoy: \$68\.00 \(Bs 68\.000,00 a la tasa BCV de hoy\)/);
  assert.match(m, /2 compras separadas .* \$56\.00 y \$12\.00/);
  assert.match(m, /Total el 3 de noviembre: \$51\.00\./);
  assert.match(m, /Navidad Vallenata/);
  assert.doesNotMatch(m, /La Navidad/);
  assert.doesNotMatch(m, /gracia|prórroga|días extra/i);
  assert.doesNotMatch(m, /\b[23] cuotas\b/);
});

test("con una sola compra no repite las fechas al final", () => {
  const lineas = [linea("vip", 1, 140, "2026-11-05")];
  const c: Cotizacion = { hoy: "2026-11-05", tasaEurVes: null, lineas, porFecha: sumarPorFecha(lineas, "2026-11-05", null), totalUsd: 140 };
  const m = mensajeCotizacion(c);
  assert.match(m, /1 entrada VIP \(\$140\.00\): hoy \$70\.00 · 19 de noviembre \$70\.00/);
  assert.match(m, /Total hoy: \$70\.00\./);
  assert.doesNotMatch(m, /Total el/);
  assert.doesNotMatch(m, /compras separadas/);
});
