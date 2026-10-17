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

// Cobranza: cuándo se reportó un pago, en hora de Venezuela (17 oct).
import { cuandoCaracas } from "../src/lib/formato.ts";

test("cuándo se reportó un pago: hoy, ayer o fecha, en hora de Venezuela", () => {
  // 19:42 UTC = 3:42 p. m. en Caracas (UTC-4).
  assert.equal(cuandoCaracas("2026-10-17T19:42:00Z", "2026-10-17"), "hoy 3:42 p. m.");
  assert.equal(cuandoCaracas("2026-10-16T14:05:00Z", "2026-10-17"), "ayer 10:05 a. m.");
  assert.equal(cuandoCaracas("2026-10-15T19:42:00Z", "2026-10-17"), "15 oct · 3:42 p. m.");
  // 02:30 UTC del 18 todavía es el 17 a las 10:30 p. m. en Venezuela.
  assert.equal(cuandoCaracas("2026-10-18T02:30:00Z", "2026-10-17"), "hoy 10:30 p. m.");
  // Ayer cruzando de mes.
  assert.equal(cuandoCaracas("2026-10-31T15:00:00Z", "2026-11-01"), "ayer 11:00 a. m.");
  assert.equal(cuandoCaracas("no-es-fecha", "2026-10-17"), "");
});
