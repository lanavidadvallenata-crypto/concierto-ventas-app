// Compra mixta (Anita, 28 oct): varias zonas en una sola compra de Ventas.
// Lo que se cuida: que la compra de una sola zona siga exactamente igual,
// que la mixta cobre lo que es (cada ticket a su precio, un solo plan sobre
// el total), que el tope de VIP en cuotas cuente solo las VIP, y que si algo
// falla no quede ninguna silla apartada de más.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detalleMixto, esMixta, partesDe, resumenCompra, tipoParaPlan, zonaPrincipal } from "../src/lib/precios.ts";
import { registrarVentaInterna } from "../src/lib/registrar-venta.ts";
import { leerMezcla, planDeCompra, tiposDe } from "../src/lib/compra-mixta.ts";
import { mensajeCotizacion, pagosDeJunta, type Cotizacion } from "../src/lib/cotizador.ts";
import { crearDoble, CONFIG_ENCENDIDA } from "./doble-supabase.ts";

test("una compra de una sola zona se describe igual que siempre", () => {
  assert.equal(resumenCompra(["vip", "vip"], " × "), "2 × VIP");
  assert.equal(resumenCompra(["general"], " × "), "1 × General");
  assert.equal(resumenCompra(["general", "general", "general"], " "), "3 Generales");
  assert.equal(resumenCompra(["preferencial", "preferencial"], " "), "2 Preferencial");
  assert.equal(detalleMixto(["vip", "vip"]), null, "el correo de una sola zona no cambia");
  assert.equal(esMixta(["general", "general"]), false);
});

test("una compra mixta se describe con todas sus zonas, VIP primero", () => {
  const tipos = ["general", "preferencial", "preferencial"];
  assert.deepEqual(partesDe(tipos), [
    { tipo: "preferencial", cantidad: 2 },
    { tipo: "general", cantidad: 1 },
  ]);
  assert.equal(esMixta(tipos), true);
  assert.equal(resumenCompra(tipos, " × "), "2 Preferenciales + 1 General");
  assert.equal(detalleMixto(tipos), "3 entradas: 2 Preferenciales y 1 General");
  assert.equal(detalleMixto(["general", "vip", "preferencial"]), "3 entradas: 1 VIP, 1 Preferencial y 1 General");
  assert.equal(zonaPrincipal(tipos), "preferencial");
  assert.equal(zonaPrincipal(["general", "vip"]), "vip");
});

test("el plan de una compra mixta con VIP se guarda con SOLO sus VIP: el tope cuenta exacto", () => {
  assert.deepEqual(tipoParaPlan([{ tipo: "vip", cantidad: 2 }, { tipo: "general", cantidad: 3 }]), { tipo: "vip", cantidad: 2 });
  assert.deepEqual(tipoParaPlan([{ tipo: "preferencial", cantidad: 2 }, { tipo: "general", cantidad: 1 }]), { tipo: "preferencial", cantidad: 2 });
  assert.deepEqual(tipoParaPlan([{ tipo: "general", cantidad: 4 }]), { tipo: "general", cantidad: 4 });
  assert.deepEqual(tiposDe([{ tipo: "preferencial", cantidad: 2 }, { tipo: "general", cantidad: 1 }]), ["preferencial", "preferencial", "general"]);
});

// ---------------------------------------------------------------- registrar

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function base() {
  return crearDoble({
    eventos: [{ id: "ev1", aforo_general_total: 4500 }],
    mesas_vip: [
      { id: "m-vip", zona: "vip", fila: "A", numero: 1 },
      { id: "m-pref", zona: "preferencial", fila: "1", numero: 1 },
    ],
    sillas_vip: [
      { id: UUID(1), mesa_id: "m-vip", numero: 1, estado: "disponible" },
      { id: UUID(2), mesa_id: "m-pref", numero: 1, estado: "disponible" },
      { id: UUID(3), mesa_id: "m-pref", numero: 2, estado: "disponible" },
      { id: UUID(4), mesa_id: "m-pref", numero: 3, estado: "vendida" },
    ],
    // La preventa está agotada (como hoy): 30 VIP y 40 Generales vendidas en
    // esa etapa. Sin esto el doble cobraría la General a $22 de preventa.
    tickets: [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `pv${i}`, tipo: "vip", etapa: "preventa", estado_pago: "verificado", grupo_id: "viejo" })),
      ...Array.from({ length: 40 }, (_, i) => ({ id: `pg${i}`, tipo: "general", etapa: "preventa", estado_pago: "verificado", grupo_id: "viejo" })),
    ],
    abona618_config: [...CONFIG_ENCENDIDA],
    planes_pago: [],
  });
}

const comprador = {
  compradorNombre: "Cliente Prueba",
  compradorTelefono: "04140000000",
  compradorEmail: "cliente@prueba.com",
  metodoPago: "zelle" as const,
  referenciaPago: "ABC123",
  precioTotalManual: null,
  vendidoPor: "vendedora",
  canal: "manual" as const,
  verificarDeInmediato: false,
};

test("una compra mixta crea UNA compra: cada ticket con su zona, su silla y su precio", async () => {
  const d = base();
  const r = await registrarVentaInterna(d.cliente as never, {
    ...comprador,
    tipo: "preferencial",
    sillaIds: [],
    cantidad: 0,
    partes: [
      { tipo: "preferencial", sillaIds: [UUID(2), UUID(3)], cantidad: 2 },
      { tipo: "general", sillaIds: [], cantidad: 1 },
    ],
  });
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(r.cantidad, 3);
  assert.equal(r.total, 170);
  const tickets = d.tablas.tickets.filter((t) => t.grupo_id !== "viejo");
  assert.equal(tickets.length, 3);
  assert.equal(new Set(tickets.map((t) => t.grupo_id)).size, 1, "un solo código de compra");
  assert.deepEqual(tickets.map((t) => [t.tipo, t.silla_id, t.precio]), [
    ["preferencial", UUID(2), 70],
    ["preferencial", UUID(3), 70],
    ["general", null, 30],
  ]);
  assert.deepEqual(d.tablas.sillas_vip.filter((s) => s.estado === "reservada").map((s) => s.id), [UUID(2), UUID(3)]);
});

test("una compra de una sola zona sigue saliendo igual", async () => {
  const d = base();
  const r = await registrarVentaInterna(d.cliente as never, { ...comprador, tipo: "vip", sillaIds: [UUID(1)], cantidad: 1 });
  assert.ok(r.ok);
  assert.equal(r.total, 140);
  assert.deepEqual(d.tablas.tickets.filter((t) => t.grupo_id !== "viejo").map((t) => [t.tipo, t.silla_id, t.precio]), [["vip", UUID(1), 140]]);
});

test("si una silla de la mezcla ya no está, no queda NINGUNA apartada", async () => {
  const d = base();
  const r = await registrarVentaInterna(d.cliente as never, {
    ...comprador,
    tipo: "vip",
    sillaIds: [],
    cantidad: 0,
    partes: [
      { tipo: "vip", sillaIds: [UUID(1)], cantidad: 1 },
      { tipo: "preferencial", sillaIds: [UUID(2), UUID(4)], cantidad: 2 },
    ],
  });
  assert.equal(r.ok, false);
  assert.equal(d.tablas.tickets.filter((t) => t.grupo_id !== "viejo").length, 0);
  assert.deepEqual(d.tablas.sillas_vip.filter((s) => s.estado === "reservada"), [], "la VIP y la Preferencial se soltaron");
});

test("una silla VIP mandada como Preferencial no pasa, ni dentro de una mezcla", async () => {
  const d = base();
  const r = await registrarVentaInterna(d.cliente as never, {
    ...comprador,
    tipo: "preferencial",
    sillaIds: [],
    cantidad: 0,
    partes: [
      { tipo: "preferencial", sillaIds: [UUID(1)], cantidad: 1 },
      { tipo: "general", sillaIds: [], cantidad: 1 },
    ],
  });
  assert.equal(r.ok, false);
  assert.equal(d.tablas.sillas_vip.find((s) => s.id === UUID(1))?.estado, "disponible");
});

test("la misma zona dos veces en una compra no pasa", async () => {
  const d = base();
  const r = await registrarVentaInterna(d.cliente as never, {
    ...comprador,
    tipo: "general",
    sillaIds: [],
    cantidad: 0,
    partes: [
      { tipo: "general", sillaIds: [], cantidad: 1 },
      { tipo: "general", sillaIds: [], cantidad: 2 },
    ],
  });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------- el plan

test("el plan de una compra mixta es UNO, sobre el total", async () => {
  const d = base();
  const p = await planDeCompra(d.cliente as never, [{ tipo: "preferencial", cantidad: 2 }, { tipo: "general", cantidad: 1 }], {
    hoy: "2026-10-28",
  });
  assert.equal(p.total, 170);
  assert.ok(p.plan.hayPlan);
  assert.deepEqual(p.plan.cuotas.map((c) => [c.venceEl, c.monto]), [
    ["2026-10-28", 68],
    ["2026-11-11", 51],
    ["2026-11-25", 51],
  ]);
  assert.deepEqual(p.tipoPlan, { tipo: "preferencial", cantidad: 2 });
});

test("el tope de VIP en cuotas mira solo las VIP de la mezcla", async () => {
  const d = base();
  // 99 VIP ya en plan: cabe 1 VIP más, no 2. Las Generales no cuentan.
  d.tablas.planes_pago.push({ id: "p0", grupo_id: "g0", tipo: "vip", cantidad: 99, estado: "al_dia" });
  const una = await planDeCompra(d.cliente as never, [{ tipo: "vip", cantidad: 1 }, { tipo: "general", cantidad: 5 }], { hoy: "2026-10-28" });
  assert.ok(una.plan.hayPlan, "1 VIP + 5 Generales cabe");
  assert.deepEqual(una.tipoPlan, { tipo: "vip", cantidad: 1 });
  const dos = await planDeCompra(d.cliente as never, [{ tipo: "vip", cantidad: 2 }, { tipo: "general", cantidad: 1 }], { hoy: "2026-10-28" });
  assert.equal(dos.plan.hayPlan, false);
  assert.equal(dos.plan.hayPlan === false && dos.plan.motivo, "tope_vip");
});

test("una compra mixta de una sola zona da el mismo plan que antes", async () => {
  const d = base();
  const p = await planDeCompra(d.cliente as never, [{ tipo: "vip", cantidad: 1 }], { hoy: "2026-10-31" });
  assert.ok(p.plan.hayPlan);
  assert.deepEqual(p.plan.cuotas.map((c) => c.monto), [70, 70], "desde el 31 oct: mitad y mitad");
});

// ---------------------------------------------------------------- lo que manda la pantalla

test("leerMezcla valida como una venta normal", () => {
  const ok = leerMezcla(JSON.stringify([
    { tipo: "preferencial", sillaIds: [UUID(2), UUID(3), UUID(3)] },
    { tipo: "general", cantidad: 2 },
  ]));
  assert.ok(ok.ok);
  assert.deepEqual(ok.partes, [
    { tipo: "preferencial", sillaIds: [UUID(2), UUID(3)], cantidad: 2 },
    { tipo: "general", sillaIds: [], cantidad: 2 },
  ]);
  assert.equal(leerMezcla("no es json").ok, false);
  assert.equal(leerMezcla("[]").ok, false);
  assert.equal(leerMezcla(JSON.stringify([{ tipo: "palco", cantidad: 1 }])).ok, false);
  assert.equal(leerMezcla(JSON.stringify([{ tipo: "vip", sillaIds: [] }])).ok, false, "VIP sin sillas");
  assert.equal(leerMezcla(JSON.stringify([{ tipo: "general", cantidad: 21 }])).ok, false, "más de 20 generales");
  assert.equal(leerMezcla(JSON.stringify([{ tipo: "general", cantidad: 1 }, { tipo: "general", cantidad: 1 }])).ok, false, "zona repetida");
});

// ---------------------------------------------------------------- cotizar

test("Cotizar: una mezcla se cotiza y se le dice al cliente como UNA compra", () => {
  const junta = {
    total: 170,
    sinPlan: null,
    plan: {
      hayPlan: true as const,
      total: 170,
      inicial: 68,
      saldo: 102,
      cuotas: [
        { orden: 1, etiqueta: "Inicial", monto: 68, venceEl: "2026-10-28", esInicial: true },
        { orden: 2, etiqueta: "Cuota 01", monto: 51, venceEl: "2026-11-11", esInicial: false },
        { orden: 3, etiqueta: "Pago final", monto: 51, venceEl: "2026-11-25", esInicial: false },
      ],
    },
  };
  const c: Cotizacion = {
    hoy: "2026-10-28",
    tasaEurVes: 1000,
    lineas: [
      { tipo: "preferencial", cantidad: 2, total: 140, plan: null, sinPlan: null, disponibles: 10 },
      { tipo: "general", cantidad: 1, total: 30, plan: null, sinPlan: null, disponibles: 10 },
    ],
    junta,
    porFecha: pagosDeJunta(junta, "2026-10-28", 1000),
    totalUsd: 170,
  };
  assert.deepEqual(c.porFecha.map((p) => [p.venceEl, p.usd, p.esHoy]), [
    ["2026-10-28", 68, true],
    ["2026-11-11", 51, false],
    ["2026-11-25", 51, false],
  ]);
  const m = mensajeCotizacion(c);
  assert.match(m, /• 2 entradas Preferenciales \(\$140\.00\)/);
  assert.match(m, /Total: \$170\.00, todo en una sola compra:/);
  assert.match(m, /Hoy: \$68\.00 \(Bs 68\.000,00 a la tasa BCV de hoy\)/);
  assert.match(m, /11 de noviembre: \$51\.00/);
  assert.doesNotMatch(m, /compras separadas/);
  assert.doesNotMatch(m, /La Navidad/);
  assert.doesNotMatch(m, /gracia|prórroga/i);
});
