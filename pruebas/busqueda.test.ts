import { test } from "node:test";
import assert from "node:assert/strict";
import { coincide, normalizar } from "../src/lib/busqueda.ts";

const edimar = {
  textos: ["Edimar Salas", "edimarsalas93@gmail.com", "4F2A9C1B", "WFCT22S8TYL7"],
  telefonos: ["04120700435"],
};

test("normalizar quita acentos y mayúsculas", () => {
  assert.equal(normalizar("  González ÁLVAREZ "), "gonzalez alvarez");
});

test("encuentra por nombre, en cualquier orden y sin acentos", () => {
  assert.ok(coincide(edimar, "edimar"));
  assert.ok(coincide(edimar, "Salas Edimar"));
  assert.ok(coincide({ textos: ["Orianyelis Mercado González"], telefonos: [] }, "gonzalez"));
  assert.ok(!coincide(edimar, "edimar perez"));
});

test("encuentra por correo, código de compra y referencia", () => {
  assert.ok(coincide(edimar, "edimarsalas93"));
  assert.ok(coincide(edimar, "4f2a9c1b"));
  assert.ok(coincide(edimar, "WFCT22S8TYL7"));
  assert.ok(coincide(edimar, "wfct22"));
});

test("encuentra por teléfono con o sin 0, con 58 y con guiones", () => {
  assert.ok(coincide(edimar, "0412-0700435"));
  assert.ok(coincide(edimar, "4120700435"));
  assert.ok(coincide(edimar, "+58 412 0700435"));
  assert.ok(coincide(edimar, "0700435"));
  assert.ok(!coincide(edimar, "04121111111"));
});

test("una referencia numérica corta se busca como texto", () => {
  const pm = { textos: ["Ana", "602268"], telefonos: ["04246752632"] };
  assert.ok(coincide(pm, "602268"));
});

test("búsqueda vacía no filtra", () => {
  assert.ok(coincide(edimar, ""));
  assert.ok(coincide(edimar, "   "));
});
