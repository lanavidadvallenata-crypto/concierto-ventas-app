// Preventa General cerrada para siempre (Anita, 14 oct). El cupo bajó de 50
// a 41 porque se anulan 9 entradas de preventa que pasan a Preferencial, y de
// 41 a 40 (19 oct) por 1 más (Orianyelis Mercado). Lo
// que se cuida: que la web no vuelva a ofrecer $22 ni antes ni después de
// esa anulación.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cotizar, disponibilidadEtapas, ETAPAS } from "../src/lib/precios.ts";

// Doble mínimo: solo responde el conteo de tickets de la etapa.
function conConteo(n: number) {
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    neq: () => Promise.resolve({ count: n, error: null }),
  };
  return { from: () => consulta } as never;
}

test("el cupo de preventa General es 40", () => {
  const preventa = ETAPAS.find((e) => e.id === "preventa");
  assert.equal(preventa?.cupo?.general, 40);
});

test("con 41 vendidas (hoy) y con 40 (después de anular la de Orianyelis), la General sale a $30", async () => {
  for (const vendidas of [41, 40]) {
    const disp = await disponibilidadEtapas(conConteo(vendidas), "general");
    assert.equal(disp.find((d) => d.etapa === "preventa")?.restante, 0, `con ${vendidas} vendidas no queda preventa`);
    const c = cotizar(disp, 1);
    assert.equal(c.total, 30, `con ${vendidas} vendidas el precio es $30`);
    assert.ok(c.lineas.every((l) => l.etapa === "regular"));
  }
});
