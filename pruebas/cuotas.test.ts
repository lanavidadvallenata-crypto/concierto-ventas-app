// Barrido de Abona618: recorre todas las fechas de compra posibles y todos los
// montos que el sistema puede cotizar, y verifica que no haya una sola cuota
// mal calculada. Correr con: npm test
//
// Lo que se está cuidando aquí no es la aritmética bonita, es que nadie reciba
// un correo diciendo que debe $84.01 cuando el sistema esperaba $84.00, y que
// nunca se genere una cuota que vence antes de que el comprador pueda pagarla.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fechaCorta,
  FECHAS_PAGO,
  INICIAL,
  MARGEN_MIN_DIAS,
  DIAS_GRACIA,
  TOPE_VIP_EN_PLAN,
  diasEntre,
  sumarDias,
  graciaHasta,
  liberaEl,
  repartir,
  planPara,
  fechasVigentes,
  hayCuotasDisponibles,
  fechaLarga,
  hoyEnVenezuela,
} from "../src/lib/cuotas.ts";

const EVENTO = "2026-12-04";

// Todos los días desde que arrancó la venta hasta después del evento.
const DIAS: string[] = [];
for (let i = 0; i <= 80; i++) DIAS.push(sumarDias("2026-09-25", i));

// Precios reales ($30 y $140) por cantidades, más preventa y mesas completas.
const TOTALES: number[] = [];
for (const unitario of [20, 22, 30, 100, 110, 140]) {
  for (const cantidad of [1, 2, 3, 5, 7, 10, 20]) TOTALES.push(Math.round(unitario * cantidad * 100) / 100);
}
TOTALES.push(1400, 4200, 33.33, 99.99, 0.03, 0.04, 0.07);

test("la aritmética de fechas no depende de la zona del servidor", () => {
  assert.equal(diasEntre("2026-11-16", "2026-11-25"), 9);
  assert.equal(diasEntre("2026-11-25", "2026-11-16"), -9);
  assert.equal(diasEntre("2026-11-30", "2026-12-01"), 1, "cruce de mes");
  assert.equal(diasEntre("2026-12-31", "2027-01-01"), 1, "cruce de año");
  assert.equal(diasEntre("2024-02-28", "2024-03-01"), 2, "año bisiesto");
  assert.equal(sumarDias("2026-11-30", 1), "2026-12-01");
  assert.equal(hoyEnVenezuela(new Date("2026-11-26T02:30:00Z")), "2026-11-25",
    "02:30 UTC es todavía el 25 en Venezuela — si esto falla, las cuotas vencen 4 horas antes");
  assert.equal(hoyEnVenezuela(new Date("2026-11-25T04:30:00Z")), "2026-11-25");
});

test("las fechas aprobadas caen en los días que se decidieron", () => {
  assert.deepEqual([...FECHAS_PAGO], ["2026-11-16", "2026-11-25"]);
  assert.equal(fechaLarga("2026-11-16"), "lunes 16 de noviembre");
  assert.equal(fechaLarga("2026-11-25"), "miércoles 25 de noviembre");
  // Los dos días de gracia del pago final tienen que ser días de banco.
  assert.equal(fechaLarga(sumarDias("2026-11-25", 1)), "jueves 26 de noviembre");
  assert.equal(fechaLarga(graciaHasta("2026-11-25")), "viernes 27 de noviembre");
  assert.equal(fechaLarga(liberaEl("2026-11-25")), "sábado 28 de noviembre");
  // Y tiene que quedar margen real para revender.
  assert.ok(diasEntre(liberaEl("2026-11-25"), EVENTO) >= 6,
    "la entrada liberada necesita al menos 6 días para revenderse");
});

test("el reparto suma exacto, siempre", () => {
  for (const total of TOTALES) {
    for (const n of [1, 2]) {
      const resto = 1 - INICIAL;
      const pcs = [INICIAL, ...Array(n).fill(resto / n)];
      const partes = repartir(total, pcs);
      const suma = Math.round(partes.reduce((s, x) => s + x, 0) * 100) / 100;
      assert.equal(suma, Math.round(total * 100) / 100, `total ${total} en ${n + 1} pagos`);
      for (const p of partes) {
        assert.ok(Number.isFinite(p), `parte no finita en ${total}`);
        assert.equal(p, Math.round(p * 100) / 100, `parte con más de 2 decimales en ${total}`);
      }
    }
  }
});

test("barrido completo: ninguna cuota inválida en ninguna fecha ni monto", () => {
  let conPlan = 0;
  let sinPlan = 0;
  for (const hoy of DIAS) {
    for (const total of TOTALES) {
      const plan = planPara(total, hoy);
      if (!plan.hayPlan) {
        sinPlan++;
        assert.equal(plan.motivo, "sin_margen");
        continue;
      }
      conPlan++;

      // Suma exacta.
      const suma = Math.round(plan.cuotas.reduce((s, c) => s + c.monto, 0) * 100) / 100;
      assert.equal(suma, Math.round(total * 100) / 100, `${hoy} · ${total}: las cuotas no suman el total`);

      // La inicial es el 40 % limpio: el residuo del redondeo va al final.
      assert.equal(plan.inicial, Math.round(total * INICIAL * 100) / 100, `${hoy} · ${total}: inicial distinta del 40 %`);
      assert.equal(Math.round((plan.inicial + plan.saldo) * 100) / 100, Math.round(total * 100) / 100);

      // Ninguna cuota de monto cero o negativo: eso sería un cobro imposible.
      for (const c of plan.cuotas) {
        assert.ok(c.monto > 0, `${hoy} · ${total}: cuota ${c.orden} en ${c.monto}`);
      }

      // Ninguna cuota vence antes de hoy, y las intermedias dan margen.
      for (const c of plan.cuotas) {
        if (c.esInicial) {
          assert.equal(c.venceEl, hoy, "la inicial vence el día de la compra");
        } else {
          assert.ok(diasEntre(hoy, c.venceEl) >= MARGEN_MIN_DIAS,
            `${hoy} · cuota ${c.orden} vence en ${diasEntre(hoy, c.venceEl)} días`);
        }
      }

      // Fechas en orden estricto y sin repetir.
      for (let i = 1; i < plan.cuotas.length; i++) {
        assert.ok(diasEntre(plan.cuotas[i - 1].venceEl, plan.cuotas[i].venceEl) > 0,
          `${hoy} · ${total}: fechas fuera de orden`);
      }

      // Nunca más pagos que fechas + inicial.
      assert.ok(plan.cuotas.length >= 2 && plan.cuotas.length <= FECHAS_PAGO.length + 1);

      // Una sola etiqueta "Pago final", y es la última.
      const finales = plan.cuotas.filter((c) => c.etiqueta === "Pago final");
      assert.equal(finales.length, 1);
      assert.equal(finales[0].orden, plan.cuotas.length);

      // El plazo y la liberación siempre antes del evento.
      assert.ok(diasEntre(plan.graciaHasta, EVENTO) > 0, `${hoy}: la gracia vence después del evento`);
      assert.ok(diasEntre(plan.liberaEl, EVENTO) > 0, `${hoy}: se libera después del evento`);
    }
  }
  assert.ok(conPlan > 0 && sinPlan > 0, "el barrido tiene que cubrir los dos lados del corte");
});

test("los cortes del crédito deslizante caen donde se decidió", () => {
  const pagos = (hoy: string) => {
    const p = planPara(140, hoy);
    return p.hayPlan ? p.cuotas.length : 0;
  };
  assert.equal(pagos("2026-10-12"), 3, "comprando hoy: tres pagos");
  assert.equal(pagos("2026-11-11"), 3, "último día con tres pagos");
  assert.equal(pagos("2026-11-12"), 2, "desde aquí el 16 ya no da margen");
  assert.equal(pagos("2026-11-20"), 2, "último día con plan");
  assert.equal(pagos("2026-11-21"), 0, "desde aquí todo es de contado");
  assert.equal(pagos("2026-12-04"), 0, "el día del evento no hay plan");

  // El corte no puede moverse en silencio: es la fecha del último cartel.
  assert.equal(fechasVigentes("2026-11-20").length, 1);
  assert.equal(hayCuotasDisponibles("2026-11-20"), true);
  assert.equal(hayCuotasDisponibles("2026-11-21"), false);
});

test("el 60 % se junta cuando queda una sola fecha", () => {
  const p = planPara(140, "2026-11-12");
  assert.ok(p.hayPlan);
  assert.equal(p.cuotas.length, 2);
  assert.equal(p.cuotas[0].monto, 56);
  assert.equal(p.cuotas[1].monto, 84);
  assert.equal(p.cuotas[1].venceEl, "2026-11-25");
});

test("taquilla el día del evento no ofrece plan", () => {
  const p = planPara(140, "2026-10-12", { canal: "taquilla" });
  assert.equal(p.hayPlan, false);
  assert.equal(p.hayPlan === false && p.motivo, "taquilla");
});

test("el tope de VIP en plan no se puede pasar ni por una silla", () => {
  const base = { tipo: "vip" as const, canal: "web" };
  const libre = planPara(140, "2026-10-12", { ...base, vipEnPlan: 0, cantidad: 1 });
  assert.equal(libre.hayPlan, true);

  const justo = planPara(140, "2026-10-12", { ...base, vipEnPlan: TOPE_VIP_EN_PLAN - 1, cantidad: 1 });
  assert.equal(justo.hayPlan, true, "la silla 100 todavía entra");

  const pasado = planPara(140, "2026-10-12", { ...base, vipEnPlan: TOPE_VIP_EN_PLAN, cantidad: 1 });
  assert.equal(pasado.hayPlan, false);
  assert.equal(pasado.hayPlan === false && pasado.motivo, "tope_vip");

  // Una compra de varias sillas no puede colarse por encima del tope.
  const grupo = planPara(1400, "2026-10-12", { ...base, vipEnPlan: TOPE_VIP_EN_PLAN - 5, cantidad: 10 });
  assert.equal(grupo.hayPlan, false, "5 cupos libres no alcanzan para 10 sillas");

  // General no tiene tope.
  const general = planPara(600, "2026-10-12", { tipo: "general", vipEnPlan: 999, cantidad: 20 });
  assert.equal(general.hayPlan, true);
});

test("un total inválido falla ruidosamente en vez de cobrar mal", () => {
  assert.throws(() => planPara(0, "2026-10-12"), /Total inválido/);
  assert.throws(() => planPara(-140, "2026-10-12"), /Total inválido/);
  assert.throws(() => diasEntre("no-es-fecha", "2026-11-25"), /Fecha inválida/);
  // Menos de un céntimo por pago: imposible con los precios reales, pero una
  // cuota de $0.00 rompería el insert de la compra completa.
  assert.throws(() => repartir(0.02, [0.4, 0.3, 0.3]), /demasiado bajo/);
  for (const t of [0.03, 0.04, 0.05, 0.07, 0.11]) {
    const partes = repartir(t, [0.4, 0.3, 0.3]);
    assert.equal(Math.round(partes.reduce((s, x) => s + x, 0) * 100) / 100, t, `suma de ${t}`);
    for (const p of partes) assert.ok(p >= 0.01, `${t} dejó un pago en ${p}`);
  }
});

test("honrar un plan por el tope salta SOLO el tope, nunca el calendario", () => {
  // Esto empezó siendo `ignorarMargen`, y estaba mal: del 12 al 15 de
  // noviembre resucitaba la fecha del 16 que el margen mínimo ya había
  // descartado, así que al comprador se le ofrecían 2 pagos y se le guardaban
  // 3, con una cuota que vencía en tres días y que nunca había visto.
  for (const hoy of ["2026-10-12", "2026-11-12", "2026-11-13", "2026-11-15", "2026-11-20"]) {
    const ofrecido = planPara(140, hoy, { tipo: "vip", vipEnPlan: 0, cantidad: 1 });
    const honrado = planPara(140, hoy, { tipo: "vip", vipEnPlan: 999, cantidad: 1, ignorarTope: true });
    assert.ok(ofrecido.hayPlan && honrado.hayPlan, hoy);
    assert.deepEqual(
      honrado.cuotas.map((c) => [c.etiqueta, c.monto, c.venceEl]),
      ofrecido.cuotas.map((c) => [c.etiqueta, c.monto, c.venceEl]),
      `${hoy}: lo que se guarda tiene que ser idéntico a lo que se ofreció`
    );
  }

  // Y honrar el tope no abre el calendario: pasado el corte no hay plan, ni
  // siquiera para quien ya pagó. Ese caso se atiende a mano.
  const tarde = planPara(140, "2026-11-21", { tipo: "vip", vipEnPlan: 999, cantidad: 1, ignorarTope: true });
  assert.equal(tarde.hayPlan, false);
  assert.equal(tarde.hayPlan === false && tarde.motivo, "sin_margen");

  // El tope sí se salta, que es para lo único que sirve la opción.
  const lleno = planPara(140, "2026-10-12", { tipo: "vip", vipEnPlan: 100, cantidad: 1 });
  assert.equal(lleno.hayPlan, false);
  assert.equal(planPara(140, "2026-10-12", { tipo: "vip", vipEnPlan: 100, cantidad: 1, ignorarTope: true }).hayPlan, true);
});

test("una fecha malformada falla ruidosamente en vez de apuntar a otro día", () => {
  // "26-11-16" daba una cuota con 36.490 días de atraso (año 26, no 2026), y
  // "2026-02-30" se convertía en silencio en el 3 de marzo.
  const malas = [
    "26-11-16", "2026-2-3", "2026-11-31", "2026-02-30", "2026-13-01", "2026-00-10",
    "2026-11-00", "2026-11-25-01", " 2026-11-25", "2026-11-25 ", "2026-11-25T00:00:00Z",
    "2026-0x0B-25", "2026-11-1e1", "basura", "", "2026/11/25",
  ];
  for (const m of malas) {
    assert.throws(() => diasEntre("2026-10-12", m), /Fecha (inválida|inexistente)/, `debería rechazar "${m}"`);
    assert.throws(() => sumarDias(m, 1), /Fecha (inválida|inexistente)/, `debería rechazar "${m}"`);
    assert.throws(() => fechaCorta(m), /Fecha (inválida|inexistente)/, `fechaCorta("${m}") decía "undefined de undefined"`);
  }
  // Las buenas siguen pasando, incluido el 29 de febrero de un año bisiesto.
  for (const b of ["2026-11-16", "2026-11-25", "2024-02-29", "2026-01-01", "2026-12-31"]) {
    assert.equal(sumarDias(b, 0), b);
  }
});

test("repartir rechaza lo que podría colgar el proceso o perder plata", () => {
  // Con porcentajes que no suman 1 el ajuste del residuo iteraba una vez por
  // céntimo de déficit: repartir(1e9, [1,1,1]) no retornaba nunca. Esta
  // función está exportada y corre dentro de server actions.
  assert.throws(() => repartir(4200, [1, 1, 1]), /tienen que sumar 1/);
  assert.throws(() => repartir(140, [0.4, 0.3]), /tienen que sumar 1/);
  assert.throws(() => repartir(140, []), /perdería el total/);
  assert.throws(() => repartir(140, [0.4, NaN, 0.6]), /sumar 1|no finito/);
  assert.throws(() => repartir(NaN, [0.4, 0.3, 0.3]), /no finito/);
  assert.throws(() => repartir(Infinity, [0.4, 0.3, 0.3]), /no finito/);

  // Y que no tarde: 1e9 con porcentajes válidos tiene que ser instantáneo.
  const t = Date.now();
  repartir(1e9, [0.4, 0.3, 0.3]);
  assert.ok(Date.now() - t < 200, "el reparto no puede depender del tamaño del total");
});

test("un total no finito no produce un plan con montos NaN", () => {
  assert.throws(() => planPara(Infinity, "2026-10-12"), /Total inválido/);
  assert.throws(() => planPara(-Infinity, "2026-10-12"), /Total inválido/);
  assert.throws(() => planPara(NaN, "2026-10-12"), /Total inválido/);
});

test("los totales de carrito mixto entre etapas también suman exacto", () => {
  // El barrido de arriba genera precio × cantidad, y así no produce los
  // totales de una compra que cruza la preventa y el precio regular — que son
  // justo los que dejan residuo binario. 242 = 11 generales a caballo entre
  // $22 y $30 daba 241.99999999999997 al sumar en crudo.
  const UNITARIOS = [20, 22, 30, 100, 110, 140];
  const mixtos = new Set<number>();
  for (const a of UNITARIOS) {
    for (const b of UNITARIOS) {
      for (let n = 1; n <= 20; n++) {
        for (let k = 0; k <= n; k++) mixtos.add(Math.round((a * k + b * (n - k)) * 100) / 100);
      }
    }
  }
  let revisados = 0;
  for (const total of mixtos) {
    if (total <= 0) continue;
    for (const hoy of ["2026-10-12", "2026-11-12"]) {
      const p = planPara(total, hoy);
      assert.ok(p.hayPlan);
      // Suma CRUDA, sin redondear antes de comparar: así se detecta el residuo
      // binario que la primera versión de esta prueba escondía.
      const cruda = p.cuotas.reduce((s, c) => s + c.monto, 0);
      assert.ok(
        Math.abs(cruda - total) < 0.005,
        `${total} en ${p.cuotas.length} pagos suma ${cruda}`
      );
      assert.equal(Math.round(cruda * 100) / 100, total, `${total} redondeado`);
      revisados++;
    }
  }
  assert.ok(revisados > 1400, `solo se revisaron ${revisados} combinaciones`);

  // Los 23 totales alcanzables que dejan residuo binario al sumar en crudo.
  // Son inocuos porque todo el código redondea antes de comparar, pero quedan
  // fijados aquí: la primera pantalla o reporte que compare sin redondear
  // daría un plan como incompleto estando pagado.
  const CON_RESIDUO = [126, 222, 228, 232, 238, 242, 252, 434, 436, 444, 446, 454, 456, 464, 466, 474, 476, 484, 486, 494, 496, 504, 506];
  let conResiduo = 0;
  for (const total of CON_RESIDUO) {
    const p = planPara(total, "2026-10-12");
    assert.ok(p.hayPlan);
    const cruda = p.cuotas.reduce((s, c) => s + c.monto, 0);
    if (cruda !== total) conResiduo++;
    assert.equal(Math.round(cruda * 100) / 100, total, `${total} tiene que cuadrar redondeado`);
  }
  assert.ok(conResiduo > 0, "si ninguno deja residuo, esta lista dejó de ser representativa");
});

test("el plazo de gracia nunca se calcula distinto en dos sitios", () => {
  for (const f of FECHAS_PAGO) {
    assert.equal(diasEntre(f, graciaHasta(f)), DIAS_GRACIA);
    assert.equal(diasEntre(graciaHasta(f), liberaEl(f)), 1);
  }
});
