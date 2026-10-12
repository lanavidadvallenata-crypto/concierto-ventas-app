// Qué aviso le toca a cada cuota. Es la única pieza del cron que puede
// equivocarse de verdad: lo demás es leer la base y llamar a Resend.
//
// Lo que se está cuidando aquí es que nadie reciba un correo que no le toca.
// Un recordatorio de pago a alguien que ya pagó no es un detalle: es la
// persona escribiendo al WhatsApp a reclamar, y el equipo perdiendo la
// confianza en los avisos automáticos justo cuando más hacen falta.

import { test } from "node:test";
import assert from "node:assert/strict";
import { etapaDeAviso, avisaAlComprador, type Etapa } from "../src/lib/avisos.ts";
import { DIAS_GRACIA } from "../src/lib/cuotas.ts";

const pendiente = (dias: number) => ({ diasParaVencer: dias, reportado: false, verificado: false });

test("los avisos salen en los días exactos, no en rangos", () => {
  // Con rangos ("faltan 3 días o menos") una misma cuota recibiría correo tres
  // días seguidos por el mismo pago. Tres correos en tres días es la forma más
  // rápida de que el remitente caiga en spam.
  assert.equal(etapaDeAviso(pendiente(5)), null);
  assert.equal(etapaDeAviso(pendiente(4)), null);
  assert.equal(etapaDeAviso(pendiente(3)), "tres_dias");
  assert.equal(etapaDeAviso(pendiente(2)), null, "el día 2 no lleva aviso a propósito");
  assert.equal(etapaDeAviso(pendiente(1)), "manana");
  assert.equal(etapaDeAviso(pendiente(0)), "hoy");
});

test("vencida: en riesgo mientras dura el margen interno, después a la lista", () => {
  for (let d = 1; d <= DIAS_GRACIA; d++) {
    assert.equal(etapaDeAviso(pendiente(-d)), "en_riesgo", `${d} día(s) tarde`);
  }
  assert.equal(etapaDeAviso(pendiente(-(DIAS_GRACIA + 1))), "para_anular");
  assert.equal(etapaDeAviso(pendiente(-30)), "para_anular", "una muy vieja sigue en la lista, no desaparece");
});

test("a quien ya reportó su pago NO se le escribe nunca", () => {
  // Es el error que ya había tenido la pantalla de cobranza, donde el mensaje
  // de WhatsApp de la caja "por confirmar" le pedía plata a quien ya la había
  // mandado. Por correo automático es peor: no hay nadie leyendo que se dé
  // cuenta antes de que salga.
  for (let d = -30; d <= 30; d++) {
    assert.equal(
      etapaDeAviso({ diasParaVencer: d, reportado: true, verificado: false }),
      null,
      `día ${d}: reportado y aun así se le iba a escribir`
    );
  }
});

test("a una cuota ya cobrada tampoco, ni aunque siga marcada como reportada", () => {
  for (let d = -30; d <= 30; d++) {
    assert.equal(etapaDeAviso({ diasParaVencer: d, reportado: true, verificado: true }), null);
    assert.equal(etapaDeAviso({ diasParaVencer: d, reportado: false, verificado: true }), null);
  }
});

test("el cron nunca le escribe al comprador para anular", () => {
  // El sistema no anula solo (Anita, 12 oct): detecta y lo pone en la lista
  // para que una persona decida. Si esta etapa llegara a una plantilla de
  // correo, el comprador recibiría una anulación que nadie aprobó.
  assert.equal(avisaAlComprador("para_anular"), false);
  for (const e of ["tres_dias", "manana", "hoy", "en_riesgo"] as Etapa[]) {
    assert.equal(avisaAlComprador(e), true, e ?? "");
  }
});

test("cada día le toca una etapa y solo una", () => {
  const vistas: Record<string, number[]> = {};
  for (let d = -40; d <= 40; d++) {
    const e = etapaDeAviso(pendiente(d));
    if (!e) continue;
    (vistas[e] ??= []).push(d);
  }
  // Las de fecha futura caen en un solo día cada una; las vencidas son rangos.
  assert.deepEqual(vistas.tres_dias, [3]);
  assert.deepEqual(vistas.manana, [1]);
  assert.deepEqual(vistas.hoy, [0]);
  assert.equal(vistas.en_riesgo.length, DIAS_GRACIA);
  assert.ok(vistas.para_anular.length > 0);

  // Y ningún día cae en dos etapas: la suma de todas es la lista completa.
  const todos = Object.values(vistas).flat();
  assert.equal(new Set(todos).size, todos.length, "hay un día con dos avisos");
});
