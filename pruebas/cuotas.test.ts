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

test("honrar un plan ya pagado no usa el margen mínimo, pero sí necesita una fecha", () => {
  // El caso real: compró a las 23:58 del 20 de noviembre con plan ofrecido, y
  // volvió con la referencia a las 00:03 del 21, cuando el plan ya cerró.
  assert.equal(planPara(140, "2026-11-21").hayPlan, false, "ofrecerlo: ya no");

  const honrado = planPara(140, "2026-11-21", { ignorarMargen: true });
  assert.ok(honrado.hayPlan, "honrarlo: sí, el comprador ya transfirió");
  assert.equal(honrado.cuotas.length, 2);
  assert.equal(honrado.cuotas[1].venceEl, "2026-11-25");
  assert.equal(Math.round(honrado.cuotas.reduce((s, c) => s + c.monto, 0) * 100) / 100, 140);

  // Un día antes del último vencimiento todavía se puede cobrar.
  assert.equal(planPara(140, "2026-11-24", { ignorarMargen: true }).hayPlan, true);

  // El día del vencimiento y después, no queda dónde cobrar: se atiende a
  // mano, no se inventa una fecha.
  assert.equal(planPara(140, "2026-11-25", { ignorarMargen: true }).hayPlan, false);
  assert.equal(planPara(140, "2026-12-01", { ignorarMargen: true }).hayPlan, false);

  // Y honrar no cambia el corte de lo que se OFRECE.
  assert.equal(fechasVigentes("2026-11-21").length, 0);
  assert.equal(fechasVigentes("2026-11-21", true).length, 1);
  assert.equal(hayCuotasDisponibles("2026-11-21"), false);
});

test("el plazo de gracia nunca se calcula distinto en dos sitios", () => {
  for (const f of FECHAS_PAGO) {
    assert.equal(diasEntre(f, graciaHasta(f)), DIAS_GRACIA);
    assert.equal(diasEntre(graciaHasta(f), liberaEl(f)), 1);
  }
});
