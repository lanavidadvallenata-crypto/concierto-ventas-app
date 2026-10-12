// Abona618 — qué aviso le toca a una cuota, decidido en una función pura.
//
// Vive aparte del cron a propósito: el cron corre una vez al día en
// producción y no se puede "probar a ver qué pasa". La decisión de a quién se
// le escribe y con qué tono es lo único que puede equivocarse de verdad —
// mandarle un recordatorio a quien ya pagó, o no avisarle a quien está a un
// día de perder su entrada — así que se decide aquí y se prueba sola.

import { DIAS_GRACIA } from "@/lib/cuotas";

export type Etapa =
  /** Faltan 3 días: el aviso tranquilo, con tiempo de ir al banco. */
  | "tres_dias"
  /** Mañana vence. */
  | "manana"
  /** Vence hoy. */
  | "hoy"
  /** Ya venció y está dentro del margen interno del equipo. El comprador NO
   *  se entera de que ese margen existe: para él su entrada está en riesgo
   *  desde ya (Anita, 12 oct). */
  | "en_riesgo"
  /** Se acabó el margen. Aquí NO se le escribe al comprador: el sistema no
   *  anula solo, lo pone en la lista para que una persona decida. */
  | "para_anular";

export type EstadoCuota = {
  diasParaVencer: number;
  /** El comprador o el equipo ya anotaron el pago y espera al banco. */
  reportado: boolean;
  verificado: boolean;
};

/**
 * El aviso que le toca HOY a una cuota, o null si no le toca ninguno.
 *
 * Reglas, por orden de importancia:
 *
 * 1. Una cuota cobrada no recibe nada. Obvio, pero es la que más caro sale.
 * 2. Una cuota REPORTADA tampoco: esa persona ya pagó y está esperando a que
 *    Finanzas confirme. Cobrarle otra vez es el error que ya tenía la pantalla
 *    de cobranza, y por correo automático es peor, porque no hay nadie
 *    leyendo que se dé cuenta.
 * 3. Los días exactos (3, 1, 0) y no rangos: con rangos, una cuota a 3 días
 *    recibiría aviso hoy, mañana y pasado. Tres correos en tres días por el
 *    mismo pago es la forma más rápida de que alguien marque el remitente
 *    como spam, y entonces tampoco le llega el que importa.
 */
export function etapaDeAviso(c: EstadoCuota): Etapa | null {
  if (c.verificado) return null;
  if (c.reportado) return null;

  const d = c.diasParaVencer;
  if (d === 3) return "tres_dias";
  if (d === 1) return "manana";
  if (d === 0) return "hoy";
  if (d < 0 && -d <= DIAS_GRACIA) return "en_riesgo";
  if (d < 0) return "para_anular";
  return null;
}

/** Las etapas que SÍ le escriben al comprador. */
export type EtapaComprador = Exclude<Etapa, "para_anular">;

/** ¿Esta etapa le manda un correo al comprador? Es un type guard a propósito:
 *  así el compilador no deja pasar "para_anular" a una plantilla de correo. */
export function avisaAlComprador(etapa: Etapa): etapa is EtapaComprador {
  return etapa !== "para_anular";
}
