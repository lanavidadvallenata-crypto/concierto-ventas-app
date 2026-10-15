// Mesa y sillas apartadas en el correo y en la página de compra (15 oct).
// Lo que se cuida: que diga exactamente lo que la persona compró, en orden y
// agrupado por mesa, y que ante cualquier duda NO diga nada en vez de decir
// algo incompleto.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lineasDeAsientos, obtenerAsientos, resumirAsientos } from "../src/lib/asiento.ts";
import { crearDoble } from "./doble-supabase.ts";

function dobleConMapa() {
  return crearDoble({
    mesas_vip: [
      { id: "pref-1-4", fila: "1", numero: 4, zona: "preferencial" },
      { id: "pref-1-5", fila: "1", numero: 5, zona: "preferencial" },
      { id: "vip-a-2", fila: "A", numero: 2, zona: "vip" },
    ],
    sillas_vip: [
      { id: "s3", mesa_id: "pref-1-4", numero: 3 },
      { id: "s4", mesa_id: "pref-1-4", numero: 4 },
      { id: "s5", mesa_id: "pref-1-4", numero: 5 },
      { id: "s51", mesa_id: "pref-1-5", numero: 1 },
      { id: "v7", mesa_id: "vip-a-2", numero: 7 },
      { id: "huerfana", mesa_id: "no-existe", numero: 9 },
    ],
  });
}

test("Preferencial: una línea por mesa, sillas en orden y con 'y' al final", () => {
  const lineas = resumirAsientos("preferencial", [
    { fila: "1", mesaNumero: 5, sillaNumero: 1 },
    { fila: "1", mesaNumero: 4, sillaNumero: 5 },
    { fila: "1", mesaNumero: 4, sillaNumero: 3 },
    { fila: "1", mesaNumero: 4, sillaNumero: 4 },
  ]);
  assert.deepEqual(lineas, ["Preferencial · Fila 1 · Mesa 4 · Sillas 3, 4 y 5", "Preferencial · Fila 1 · Mesa 5 · Silla 1"]);
});

test("VIP sin prefijo; dos sillas se unen con 'y'", () => {
  assert.deepEqual(
    resumirAsientos("vip", [
      { fila: "B", mesaNumero: 1, sillaNumero: 2 },
      { fila: "A", mesaNumero: 10, sillaNumero: 8 },
      { fila: "A", mesaNumero: 10, sillaNumero: 7 },
    ]),
    ["Fila A · Mesa 10 · Sillas 7 y 8", "Fila B · Mesa 1 · Silla 2"]
  );
});

test("lee de la base y arma las líneas de la compra", async () => {
  const d = dobleConMapa();
  const lineas = await lineasDeAsientos(d.cliente as never, "preferencial", ["s5", "s3", "s4", "s51", "s3"]);
  assert.deepEqual(lineas, ["Preferencial · Fila 1 · Mesa 4 · Sillas 3, 4 y 5", "Preferencial · Fila 1 · Mesa 5 · Silla 1"]);
});

test("General, o una compra sin sillas, no muestra nada", async () => {
  const d = dobleConMapa();
  assert.deepEqual(await lineasDeAsientos(d.cliente as never, "general", ["s3"]), []);
  assert.deepEqual(await lineasDeAsientos(d.cliente as never, "vip", [null, null]), []);
});

test("si falta una silla o su mesa, no se muestra nada (nunca a medias)", async () => {
  const d = dobleConMapa();
  assert.equal(await obtenerAsientos(d.cliente as never, ["s3", "no-existe"]), null);
  assert.equal(await obtenerAsientos(d.cliente as never, ["s3", "huerfana"]), null);
  assert.deepEqual(await lineasDeAsientos(d.cliente as never, "preferencial", ["s3", "huerfana"]), []);
});

test("si la base no responde, no se muestra nada y no se rompe el correo", async () => {
  const d = dobleConMapa();
  d.fallar["sillas_vip"] = "timeout";
  assert.deepEqual(await lineasDeAsientos(d.cliente as never, "vip", ["v7"]), []);
  const d2 = dobleConMapa();
  d2.fallar["mesas_vip"] = "timeout";
  assert.deepEqual(await lineasDeAsientos(d2.cliente as never, "vip", ["v7"]), []);
});
