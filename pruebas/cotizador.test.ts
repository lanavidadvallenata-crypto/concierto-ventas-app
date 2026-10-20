import { test } from "node:test";
import assert from "node:assert/strict";
import { mensajeCotizacion, sumarPorFecha, validarPedido, type Cotizacion, type LineaCotizada } from "../src/lib/cotizador.ts";
import { aPlanPublico, planPara } from "../src/lib/cuotas.ts";

const HOY = "2026-10-20"; // antes del 27 oct: 3 pagos (hoy, 30 oct, 16 nov)
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
  assert.equal(validarPedido({ preferencial: 7 }).ok, false); // máx 6
  assert.equal(validarPedido({ general: 1.5 }).ok, false);
  assert.equal(validarPedido({ vip: -1 }).ok, false);
});

test("caso Aide: 2 Preferenciales + 1 General = $68 hoy, $51 el 30 oct, $51 el 16 nov", () => {
  const lineas = [linea("preferencial", 2, 140), linea("general", 1, 30)];
  // Cada compra por separado, como la cobra la web.
  assert.deepEqual(lineas[0].plan!.cuotas.map((c) => c.monto), [56, 42, 42]);
  assert.deepEqual(lineas[1].plan!.cuotas.map((c) => c.monto), [12, 9, 9]);

  const porFecha = sumarPorFecha(lineas, HOY, TASA);
  assert.deepEqual(
    porFecha.map((p) => [p.venceEl, p.usd, p.esHoy]),
    [
      ["2026-10-20", 68, true],
      ["2026-10-30", 51, false],
      ["2026-11-16", 51, false],
    ]
  );
  assert.equal(porFecha[0].bs, 68000);
});

test("desde el 28 oct son 2 pagos: 40 % hoy y 60 % el 16 nov", () => {
  const l = linea("preferencial", 1, 70, "2026-10-28");
  assert.deepEqual(l.plan!.cuotas.map((c) => [c.venceEl, c.monto]), [
    ["2026-10-28", 28],
    ["2026-11-16", 42],
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
  assert.match(m, /2 entradas Preferenciales \(\$140\.00\): hoy \$56\.00 · 30 de octubre \$42\.00 · 16 de noviembre \$42\.00/);
  assert.match(m, /1 entrada General \(\$30\.00\): hoy \$12\.00/);
  assert.match(m, /Total hoy: \$68\.00 \(Bs 68\.000,00 a la tasa BCV de hoy\)/);
  assert.match(m, /2 compras separadas .* \$56\.00 y \$12\.00/);
  assert.match(m, /Total el 30 de octubre: \$51\.00\./);
  assert.match(m, /Navidad Vallenata/);
  assert.doesNotMatch(m, /La Navidad/);
  assert.doesNotMatch(m, /gracia|prórroga|días extra/i);
  assert.doesNotMatch(m, /\b[23] cuotas\b/);
});

test("con una sola compra no repite las fechas al final", () => {
  const lineas = [linea("vip", 1, 140, "2026-10-28")];
  const c: Cotizacion = { hoy: "2026-10-28", tasaEurVes: null, lineas, porFecha: sumarPorFecha(lineas, "2026-10-28", null), totalUsd: 140 };
  const m = mensajeCotizacion(c);
  assert.match(m, /1 entrada VIP \(\$140\.00\): hoy \$56\.00 · 16 de noviembre \$84\.00/);
  assert.match(m, /Total hoy: \$56\.00\./);
  assert.doesNotMatch(m, /Total el/);
  assert.doesNotMatch(m, /compras separadas/);
});
