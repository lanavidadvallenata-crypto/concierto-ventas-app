// Zona Preferencial (13 oct): el tercer tipo de entrada. Lo que se cuida
// aquí es la plata — que el precio sea el de la zona y que nadie compre una
// silla VIP a precio Preferencial mandando el tipo cambiado desde el
// navegador — y las etiquetas que ve el equipo en la puerta.

import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularTotal, conAsiento, cotizar, etiquetaTipo, MAX_POR_COMPRA, MAX_SILLAS_POR_COMPRA, TIPOS, type DisponibilidadEtapa } from "../src/lib/precios.ts";
import { describirAsiento, descripcionEntrada } from "../src/lib/asiento.ts";
import { sillasSonDeZona } from "../src/lib/mapa-vip.ts";
import { crearDoble } from "./doble-supabase.ts";

test("Preferencial vale $70 final, sin fee y sin preventa", () => {
  assert.deepEqual(calcularTotal("preferencial"), { base: 70, fee: 0, total: 70 });
  // En preventa el cupo es 0: aunque alguien pida "preventa", el precio no
  // puede bajar de los $70 porque la preventa nunca existió para esta zona.
  const disponibilidad: DisponibilidadEtapa[] = [
    { etapa: "preventa", nombreEtapa: "Preventa", restante: 0, baseUnitario: 70, feeRate: 0.1, totalUnitario: 77 },
    { etapa: "regular", nombreEtapa: "Precio regular", restante: null, baseUnitario: 70, feeRate: 0, totalUnitario: 70 },
  ];
  const c = cotizar(disponibilidad, 6);
  assert.equal(c.total, 420);
  assert.equal(c.fee, 0);
  assert.ok(c.lineas.every((l) => l.etapa === "regular"));
});

test("VIP y General no cambian", () => {
  assert.equal(calcularTotal("vip").total, 140);
  assert.equal(calcularTotal("general").total, 30);
  assert.equal(MAX_POR_COMPRA.vip, 10);
  assert.equal(MAX_POR_COMPRA.general, 20);
});

test("una mesa completa (8) es el tope por compra, y las sillas se validan contra el mayor tope", () => {
  assert.equal(MAX_POR_COMPRA.preferencial, 8);
  assert.equal(MAX_SILLAS_POR_COMPRA, 10);
});

test("con asiento: VIP y Preferencial; General no", () => {
  assert.equal(conAsiento("vip"), true);
  assert.equal(conAsiento("preferencial"), true);
  assert.equal(conAsiento("general"), false);
  assert.deepEqual([...TIPOS], ["vip", "preferencial", "general"]);
});

test("las etiquetas que ve el equipo", () => {
  assert.equal(etiquetaTipo("preferencial", 1), "Preferencial");
  assert.equal(etiquetaTipo("preferencial", 4), "Preferencial");
  assert.equal(etiquetaTipo("general", 1), "General");
  assert.equal(etiquetaTipo("general", 3), "Generales");
  assert.equal(etiquetaTipo("vip", 2), "VIP");

  const asiento = { fila: "1", mesaNumero: 4, sillaNumero: 3 };
  // En la puerta, "Fila 1" a secas se confunde con la primera fila del VIP.
  assert.equal(describirAsiento("preferencial", asiento), "Preferencial · Fila 1 · Mesa 4 · Silla 3");
  assert.equal(describirAsiento("vip", { fila: "A", mesaNumero: 4, sillaNumero: 3 }), "Fila A · Mesa 4 · Silla 3");
  assert.equal(descripcionEntrada("general", null), "Acceso general · sin asiento asignado");
  assert.equal(descripcionEntrada("preferencial", null), "Preferencial (silla no encontrada — revisar en Finanzas)");
});

function dobleConMapa() {
  return crearDoble({
    mesas_vip: [
      { id: "mesa-vip", fila: "A", numero: 1, zona: "vip" },
      { id: "mesa-pref", fila: "1", numero: 1, zona: "preferencial" },
    ],
    sillas_vip: [
      { id: "vip-1", mesa_id: "mesa-vip", numero: 1, estado: "disponible" },
      { id: "vip-2", mesa_id: "mesa-vip", numero: 2, estado: "disponible" },
      { id: "pref-1", mesa_id: "mesa-pref", numero: 1, estado: "disponible" },
    ],
  });
}

test("una silla VIP no se puede cobrar como Preferencial (ni al revés)", async () => {
  const d = dobleConMapa();
  const service = d.cliente as never;
  // El ataque: tipo "preferencial" ($70) con una silla de la zona VIP ($140).
  assert.equal(await sillasSonDeZona(service, ["vip-1"], "preferencial"), false);
  assert.equal(await sillasSonDeZona(service, ["pref-1"], "vip"), false);
  // Mezcladas tampoco: basta una de otra zona para rechazar toda la compra.
  assert.equal(await sillasSonDeZona(service, ["pref-1", "vip-2"], "preferencial"), false);
  // Lo legítimo pasa.
  assert.equal(await sillasSonDeZona(service, ["vip-1", "vip-2"], "vip"), true);
  assert.equal(await sillasSonDeZona(service, ["pref-1"], "preferencial"), true);
});

test("una silla que no existe, o ninguna silla, no pasa", async () => {
  const d = dobleConMapa();
  const service = d.cliente as never;
  assert.equal(await sillasSonDeZona(service, ["no-existe"], "vip"), false);
  assert.equal(await sillasSonDeZona(service, ["vip-1", "no-existe"], "vip"), false);
  assert.equal(await sillasSonDeZona(service, [], "vip"), false);
});

test("si la base no responde, no se vende", async () => {
  const d = dobleConMapa();
  d.fallar["sillas_vip"] = "timeout";
  assert.equal(await sillasSonDeZona(d.cliente as never, ["vip-1"], "vip"), false);
});
