// Detalle de planes caídos (17 oct): quién, qué, cuánto abonó, cuándo y por
// qué. Lo que se cuida: que solo salgan los caídos, que el abonado sea solo
// lo confirmado en el banco, y que lo más reciente vaya primero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { listarCaidos } from "../src/lib/abona618.ts";
import { crearDoble } from "./doble-supabase.ts";

test("lista solo los caídos, con lo abonado confirmado y lo más reciente primero", async () => {
  const d = crearDoble({
    planes_pago: [
      { id: "p1", grupo_id: "g1", estado: "anulado", tipo: "preferencial", cantidad: 2, total_usd: 140, creado_en: "2026-10-13T15:00:00Z", anulado_en: "2026-10-13T18:00:00Z", anulado_por: "u1", notas: "Compra de prueba" },
      { id: "p2", grupo_id: "g2", estado: "vencido", tipo: "general", cantidad: 1, total_usd: 30, creado_en: "2026-10-14T15:00:00Z", anulado_en: "2026-10-16T12:00:00Z", anulado_por: "u2", notas: null },
      { id: "p3", grupo_id: "g3", estado: "al_dia", tipo: "vip", cantidad: 1, total_usd: 140, creado_en: "2026-10-15T15:00:00Z", anulado_en: null, anulado_por: null, notas: null },
    ],
    cuotas: [
      { plan_id: "p1", monto_usd: 56, verificado_en: "2026-10-13T16:00:00Z" },
      { plan_id: "p1", monto_usd: 42, verificado_en: null },
      { plan_id: "p2", monto_usd: 12, verificado_en: null },
      { plan_id: "p3", monto_usd: 56, verificado_en: "2026-10-15T16:00:00Z" },
    ],
    tickets: [
      { grupo_id: "g1", comprador_nombre: "Prueba Anita", comprador_email: "a@b.c", comprador_telefono: "04141234567" },
      { grupo_id: "g1", comprador_nombre: "Prueba Anita", comprador_email: "a@b.c", comprador_telefono: "04141234567" },
      { grupo_id: "g2", comprador_nombre: "Pedro", comprador_email: "p@b.c", comprador_telefono: null },
      { grupo_id: "g3", comprador_nombre: "Luis", comprador_email: "l@b.c", comprador_telefono: null },
    ],
  });
  const { caidos, error } = await listarCaidos(d.cliente as never);
  assert.equal(error, null);
  assert.deepEqual(caidos.map((c) => c.grupoId), ["g2", "g1"], "solo caídos, el más reciente primero");
  const g1 = caidos.find((c) => c.grupoId === "g1")!;
  assert.equal(g1.abonadoUsd, 56, "solo lo confirmado en el banco");
  assert.equal(g1.estado, "anulado");
  assert.equal(g1.compradorNombre, "Prueba Anita");
  assert.equal(g1.notas, "Compra de prueba");
  const g2 = caidos.find((c) => c.grupoId === "g2")!;
  assert.equal(g2.abonadoUsd, 0);
  assert.equal(g2.estado, "vencido");
});

test("sin caídos devuelve una lista vacía; si la base falla, lo dice", async () => {
  const vacio = crearDoble({ planes_pago: [], cuotas: [], tickets: [] });
  assert.deepEqual(await listarCaidos(vacio.cliente as never), { caidos: [], error: null });
  const roto = crearDoble({ planes_pago: [], cuotas: [], tickets: [] });
  roto.fallar["planes_pago"] = "timeout";
  const r = await listarCaidos(roto.cliente as never);
  assert.ok(r.error);
});
