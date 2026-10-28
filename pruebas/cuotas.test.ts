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
  CONDICIONES,
  fechaCorta,
  TOPE_FINAL,
  DIAS_ENTRE_PAGOS,
  MAX_PAGOS,
  REPARTO,
  DIAS_GRACIA,
  TOPE_VIP_EN_PLAN,
  diasEntre,
  sumarDias,
  graciaHasta,
  liberaEl,
  repartir,
  planPara,
  planConFechasVistas,
  aPlanPublico,
  fechasDelPlan,
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

test("cada pago vence 14 días después del anterior, y ninguno pasa del 27 de noviembre", () => {
  // La regla de Anita del 28 de octubre. Antes se cobraba en las quincenas
  // (15 y 30) y quien compraba cerca de una volvía a pagar a los 3 días: el
  // que compró el 27 de octubre tenía cuota el 30.
  assert.equal(DIAS_ENTRE_PAGOS, 14);
  assert.equal(MAX_PAGOS, 3, "la inicial y dos cuotas");
  assert.equal(TOPE_FINAL, "2026-11-27");

  // El caso que la hizo cambiar: comprando el 27 de octubre.
  assert.deepEqual(fechasDelPlan("2026-10-27"), ["2026-11-10", "2026-11-24"]);
  // Fin de semana: se paga ese mismo día, no se corre al lunes (Anita, 28 oct).
  assert.deepEqual(fechasDelPlan("2026-10-31"), ["2026-11-14"]);
  assert.equal(fechaLarga("2026-11-14"), "sábado 14 de noviembre");

  for (const hoy of DIAS) {
    const f = fechasDelPlan(hoy);
    if (f.length === 0) continue;
    assert.ok(f.length <= MAX_PAGOS - 1, `${hoy}: ${f.length} cuotas, más de las permitidas`);
    assert.ok(diasEntre(f[f.length - 1], TOPE_FINAL) >= 0, `${hoy}: una cuota se pasó del tope`);
    let anterior = hoy;
    for (const d of f) {
      assert.equal(diasEntre(anterior, d), DIAS_ENTRE_PAGOS, `${hoy}: ${d} no queda a 14 días del pago anterior`);
      anterior = d;
    }
  }

  // El último pago posible, su gracia interna y el margen para revender.
  assert.equal(fechaLarga(TOPE_FINAL), "viernes 27 de noviembre");
  assert.equal(liberaEl(TOPE_FINAL), "2026-11-30");
  assert.ok(diasEntre(liberaEl(TOPE_FINAL), EVENTO) >= 4,
    "la entrada liberada necesita al menos 4 días para revenderse");
});

test("el reparto suma exacto, siempre", () => {
  for (const total of TOTALES) {
    for (const n of [1, 2]) {
      const pcs = [...REPARTO[n]];
      if (Math.round(total * 100) < pcs.length) {
        // No alcanza para un céntimo por pago. Imposible con los precios
        // reales; lo que se exige es que falle en voz alta y no que produzca
        // una cuota de $0.00 que reventaría el insert de la compra.
        assert.throws(() => repartir(total, pcs), /demasiado bajo/);
        continue;
      }
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
      // Totales de céntimos: su fallo se verifica en la prueba de totales
      // inválidos, no aquí, porque en las fechas sin plan ni se llega a repartir.
      if (Math.round(total * 100) < MAX_PAGOS) continue;
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

      // La inicial es limpia (40 % con dos cuotas, 50 % con una): el residuo
      // del redondeo va al final.
      // Por debajo de $1 deja de poder serlo: con 4 céntimos repartidos en 4
      // pagos hay que quitarle un céntimo a la inicial para que ningún pago
      // quede en cero, y un pago de $0.00 rompería el insert de la compra.
      // Ningún precio real se acerca a eso; se exige donde tiene sentido.
      if (Math.round(total * 100) >= 100) {
        const pct = REPARTO[plan.cuotas.length - 1][0];
        assert.equal(plan.inicial, Math.round(total * pct * 100) / 100, `${hoy} · ${total}: inicial distinta del ${pct * 100} %`);
      }
      assert.equal(Math.round((plan.inicial + plan.saldo) * 100) / 100, Math.round(total * 100) / 100);

      // Ninguna cuota de monto cero o negativo: eso sería un cobro imposible.
      for (const c of plan.cuotas) {
        assert.ok(c.monto > 0, `${hoy} · ${total}: cuota ${c.orden} en ${c.monto}`);
      }

      // Ninguna cuota vence antes de 14 días desde la compra.
      for (const c of plan.cuotas) {
        if (c.esInicial) {
          assert.equal(c.venceEl, hoy, "la inicial vence el día de la compra");
        } else {
          assert.ok(diasEntre(hoy, c.venceEl) >= DIAS_ENTRE_PAGOS,
            `${hoy} · cuota ${c.orden} vence en ${diasEntre(hoy, c.venceEl)} días`);
        }
      }

      // Fechas en orden estricto y sin repetir.
      for (let i = 1; i < plan.cuotas.length; i++) {
        assert.ok(diasEntre(plan.cuotas[i - 1].venceEl, plan.cuotas[i].venceEl) > 0,
          `${hoy} · ${total}: fechas fuera de orden`);
      }

      // Nunca más pagos que fechas + inicial.
      assert.ok(plan.cuotas.length >= 2 && plan.cuotas.length <= MAX_PAGOS);

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
  assert.equal(pagos("2026-10-12"), 3, "26 de octubre y 9 de noviembre");
  assert.equal(pagos("2026-10-28"), 3, "11 y 25 de noviembre");
  assert.equal(pagos("2026-10-30"), 3, "último día con tres pagos: 13 y 27 de noviembre");
  assert.equal(pagos("2026-10-31"), 2, "el segundo pago caería el 28: uno solo, mitad y mitad");
  assert.equal(pagos("2026-11-13"), 2, "último día con plan: paga el 27");
  assert.equal(pagos("2026-11-14"), 0, "a los 14 días ya pasa del tope: contado");
  assert.equal(pagos("2026-11-27"), 0, "el día del tope no hay plan");
  assert.equal(pagos("2026-12-04"), 0, "el día del evento no hay plan");

  // El corte no puede moverse en silencio: Ventas y Cotizar dicen "desde el
  // 14 de noviembre todo es de contado".
  assert.equal(fechasDelPlan("2026-11-13").length, 1);
  assert.equal(hayCuotasDisponibles("2026-11-13"), true);
  assert.equal(hayCuotasDisponibles("2026-11-14"), false);
});

test("con una sola cuota es mitad y mitad", () => {
  const p = planPara(140, "2026-11-05");
  assert.ok(p.hayPlan);
  assert.equal(p.cuotas.length, 2);
  assert.equal(p.cuotas[0].monto, 70);
  assert.equal(p.cuotas[1].monto, 70);
  assert.equal(p.cuotas[1].venceEl, "2026-11-19");
  assert.equal(p.cuotas[1].etiqueta, "Pago final");
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
  assert.throws(() => repartir(0.03, [0.4, 0.2, 0.2, 0.2]), /demasiado bajo/, "3 céntimos no caben en 4 pagos");
  assert.throws(() => planPara(0.02, "2026-10-12"), /demasiado bajo/, "2 céntimos no caben en 3 pagos");
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
  for (const hoy of ["2026-10-12", "2026-10-27", "2026-10-28", "2026-11-05", "2026-11-13"]) {
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

  // Cuáles totales dejan residuo binario al sumar en crudo depende del
  // reparto, y el reparto ya cambió una vez (40/30/30 → 40/20/20/20). Con una
  // lista fija de totales esta prueba se vuelve mentira en silencio el día que
  // vuelva a cambiar, así que se calculan sobre la marcha.
  //
  // El residuo en sí es inocuo porque todo el código redondea antes de
  // comparar. Lo que se cuida es que siga siendo inocuo: el día que una
  // pantalla o un reporte compare en crudo, un plan pagado al 100 % se vería
  // como incompleto y el comprador no recibiría su QR.
  const conResiduo: number[] = [];
  for (const total of mixtos) {
    if (total <= 0) continue;
    const p = planPara(total, "2026-10-12");
    assert.ok(p.hayPlan);
    const cruda = p.cuotas.reduce((s, c) => s + c.monto, 0);
    if (cruda !== total) conResiduo.push(total);
    assert.equal(Math.round(cruda * 100) / 100, total, `${total} tiene que cuadrar redondeado`);
  }
  assert.ok(
    conResiduo.length <= mixtos.size / 10,
    `${conResiduo.length} de ${mixtos.size} totales dejan residuo: el reparto está perdiendo precisión`
  );
});

test("el plazo de gracia nunca se calcula distinto en dos sitios", () => {
  for (const f of ["2026-10-15", "2026-10-30", "2026-11-16"]) {
    assert.equal(diasEntre(f, graciaHasta(f)), DIAS_GRACIA);
    assert.equal(diasEntre(graciaHasta(f), liberaEl(f)), 1);
  }
});

test("cada cuota tiene su propio plazo: no se espera a la fecha final", () => {
  // Regla de Anita (12 oct): si falla la cuota del 16 de noviembre, la compra
  // se anula en ese momento y la entrada vuelve a la venta. Esperar al 27
  // dejaría la silla muerta nueve días con alguien que ya dejó de pagar.
  const p = planPara(140, "2026-10-12");
  assert.ok(p.hayPlan);
  assert.equal(p.cuotas.length, 3);

  const [inicial, cuota01, final] = p.cuotas;

  assert.equal(inicial.monto, 56, "40 % limpio");
  assert.deepEqual([cuota01.monto, final.monto], [42, 42], "el 60 % en dos partes iguales");

  assert.equal(cuota01.venceEl, "2026-10-26", "14 días después de la compra");
  assert.equal(cuota01.graciaHasta, "2026-10-28", "dos días de plazo desde su propia fecha");
  assert.equal(cuota01.liberaEl, "2026-10-29", "y se anula al día siguiente, no en diciembre");

  assert.equal(final.venceEl, "2026-11-09", "14 días después de la cuota anterior");
  assert.equal(final.graciaHasta, "2026-11-11");
  assert.equal(final.liberaEl, "2026-11-12");

  // Dos semanas de diferencia: eso es lo que se gana liberando por cuota en
  // vez de esperar al último pago.
  assert.equal(diasEntre(cuota01.liberaEl, final.liberaEl), 14);

  // Y cada cuota libera después de su propio vencimiento, nunca antes.
  for (const c of p.cuotas) {
    assert.equal(diasEntre(c.venceEl, c.graciaHasta), DIAS_GRACIA);
    assert.equal(diasEntre(c.graciaHasta, c.liberaEl), 1);
  }
});

test("las condiciones dicen que se anula al fallar CUALQUIER cuota", () => {
  const texto = CONDICIONES.join(" ");
  assert.match(texto, /no se espera a la fecha final/i, "la regla tiene que estar escrita, no solo programada");
  assert.match(texto, /no se devuelve/i);
  assert.match(texto, /cada 14 días/i, "el comprador tiene que saber cuándo le toca pagar");
});

test("el plazo de gracia NO aparece en nada que vea el comprador", () => {
  // Regla de Anita (12 oct): "los dos días de gracia no se dan en público, se
  // manejan en privado, porque si no esperan hasta el último día y piden más
  // prórroga". La gracia sigue existiendo por dentro — DIAS_GRACIA, graciaHasta
  // y liberaEl son el margen del equipo — pero el comprador ve su fecha y nada
  // más. Esta prueba cuida el texto que él lee.
  const texto = CONDICIONES.join(" ");
  assert.doesNotMatch(texto, /gracia/i, "las condiciones no pueden nombrar la gracia");
  assert.doesNotMatch(texto, /plazo/i, "ni insinuarla con la palabra plazo");
  assert.doesNotMatch(texto, /d[ií]as (extra|m[áa]s|adicionales)/i);
  assert.doesNotMatch(texto, new RegExp(`${DIAS_GRACIA} d[ií]as`), "ni decir cuántos días son");

  // Y la gracia por dentro sigue intacta: son dos cosas distintas.
  assert.equal(DIAS_GRACIA, 2);
  assert.equal(diasEntre("2026-10-15", graciaHasta("2026-10-15")), 2);
});

test("se honra el calendario que el comprador VIO, no el de hoy, si sigue siendo válido", () => {
  // Entre ver la pantalla y volver con la referencia pasan hasta 15 minutos.
  // Si en medio cruzó la medianoche, planPara de hoy da otro calendario (o
  // ninguno): aceptó 56/42/42 y se le guardaba un pago único de $70.
  const vio = planPara(140, "2026-10-30");
  assert.ok(vio.hayPlan);
  const fechasVistas = vio.cuotas.filter((c) => !c.esInicial).map((c) => c.venceEl);
  assert.deepEqual(fechasVistas, ["2026-11-13", "2026-11-27"]);

  // Confirma a las 00:03 del 31: hoy daría un solo pago, mitad y mitad.
  const hoyDaria = planPara(140, "2026-10-31");
  assert.ok(hoyDaria.hayPlan && hoyDaria.cuotas.length === 2);

  const honrado = planConFechasVistas(140, "2026-10-31", fechasVistas);
  assert.ok(honrado, "las fechas que vio siguen siendo futuras y válidas: se honran");
  assert.deepEqual(honrado.cuotas.map((c) => [c.etiqueta, c.monto, c.venceEl]), [
    ["Inicial", 56, "2026-10-31"],
    ["Cuota 01", 42, "2026-11-13"],
    ["Pago final", 42, "2026-11-27"],
  ]);
  // Y cada cuota honrada trae su margen interno igual que las normales.
  assert.equal(honrado.cuotas[1].graciaHasta, "2026-11-15");

  // Lo que NO se honra: nada que ya no sea un calendario posible.
  assert.equal(planConFechasVistas(140, "2026-10-31", ["2026-10-30"]), null, "una fecha pasada");
  assert.equal(planConFechasVistas(140, "2026-10-31", ["2026-11-28"]), null, "después del límite duro");
  assert.equal(planConFechasVistas(140, "2026-10-31", ["2026-11-27", "2026-11-13"]), null, "fuera de orden");
  assert.equal(planConFechasVistas(140, "2026-10-31", ["2026-11-13", "2026-11-13"]), null, "repetida");
  assert.equal(planConFechasVistas(140, "2026-10-31", ["2026-11-06", "2026-11-13", "2026-11-27"]), null, "más cuotas de las permitidas");
  assert.equal(planConFechasVistas(140, "2026-10-31", ["basura"]), null, "malformada");
  assert.equal(planConFechasVistas(140, "2026-10-31", []), null, "sin fechas no hay plan");
  assert.equal(planConFechasVistas(NaN, "2026-10-31", fechasVistas), null);
});

test("lo que viaja al navegador no trae el margen interno", () => {
  // Las pantallas ya no lo pintaban, pero el objeto completo del plan viajaba
  // igual en la respuesta de la server action, con graciaHasta y liberaEl por
  // cuota, en la pantalla exacta donde el comprador acepta las condiciones.
  const p = planPara(140, "2026-10-12");
  assert.ok(p.hayPlan);
  const publico = aPlanPublico(p);
  const texto = JSON.stringify(publico);
  assert.doesNotMatch(texto, /gracia/i);
  assert.doesNotMatch(texto, /libera/i);
  assert.doesNotMatch(texto, /fechaTope/);
  assert.equal(publico.cuotas.length, p.cuotas.length);
  assert.equal(publico.inicial, p.inicial);
  for (const c of publico.cuotas) {
    assert.deepEqual(Object.keys(c).sort(), ["esInicial", "etiqueta", "monto", "orden", "venceEl"]);
  }
});

test("un total inválido revienta también después del corte, no sale como 'sin plan'", () => {
  // Antes el guard del total estaba después de las ramas sin plan: pasado el
  // 14 de noviembre, planPara(NaN) devolvía {hayPlan:false, motivo:"sin_margen"}
  // en silencio en vez de lanzar.
  assert.throws(() => planPara(NaN, "2026-11-20"), /Total inválido/);
  assert.throws(() => planPara(0, "2026-11-20"), /Total inválido/);
  assert.throws(() => planPara(Infinity, "2026-11-20"), /Total inválido/);
});
