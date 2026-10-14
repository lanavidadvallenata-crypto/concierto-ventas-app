// Preventa General cerrada para siempre (Anita, 14 oct). El cupo bajó de 50
// a 41 porque se anulan 9 entradas de preventa que pasan a Preferencial. Lo
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

test("el cupo de preventa General es 41", () => {
  const preventa = ETAPAS.find((e) => e.id === "preventa");
  assert.equal(preventa?.cupo?.general, 41);
});

test("con 50 vendidas (hoy) y con 41 (después de anular las 9), la General sale a $30", async () => {
  for (const vendidas of [50, 41]) {
    const disp = await disponibilidadEtapas(conConteo(vendidas), "general");
    assert.equal(disp.find((d) => d.etapa === "preventa")?.restante, 0, `con ${vendidas} vendidas no queda preventa`);
    const c = cotizar(disp, 1);
    assert.equal(c.total, 30, `con ${vendidas} vendidas el precio es $30`);
    assert.ok(c.lineas.every((l) => l.etapa === "regular"));
  }
});
