import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearMontoBs } from "../src/lib/formato.ts";

test("los bolívares se leen como se escriben en Venezuela", () => {
  // "12.500" es doce mil quinientos, no doce y medio. Antes se guardaba 12,5.
  assert.equal(parsearMontoBs("12.500"), 12500);
  assert.equal(parsearMontoBs("12.500,00"), 12500);
  assert.equal(parsearMontoBs("12.500,50"), 12500.5);
  assert.equal(parsearMontoBs("1.234.567,89"), 1234567.89);
  assert.equal(parsearMontoBs("12500,5"), 12500.5);
  assert.equal(parsearMontoBs("12500.50"), 12500.5);
  assert.equal(parsearMontoBs("12500"), 12500);
  assert.equal(parsearMontoBs("Bs 23.534,75"), 23534.75);
  assert.equal(parsearMontoBs(" 4.095,00 "), 4095);
  // Ambiguos resueltos a favor del uso real: 3 dígitos después de un solo
  // separador son miles, salvo "0.xxx".
  assert.equal(parsearMontoBs("12.5"), 12.5);
  assert.equal(parsearMontoBs("0.500"), 0.5);
  assert.equal(parsearMontoBs("12,50"), 12.5);
  // Basura: null, nunca un número inventado.
  assert.equal(parsearMontoBs(""), null);
  assert.equal(parsearMontoBs("abc"), null);
  assert.equal(parsearMontoBs("12.500.00"), 1250000, "dos puntos: los dos son de miles");
  assert.equal(parsearMontoBs("-5"), null);
  assert.equal(parsearMontoBs("0"), null);
  assert.equal(parsearMontoBs("1,2,3"), 123, "dos comas: miles, aunque raras");
});
