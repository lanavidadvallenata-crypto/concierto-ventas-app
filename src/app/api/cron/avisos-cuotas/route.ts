import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { listaDeCobranza, type CuotaPorCobrar } from "@/lib/abona618";
import { avisaAlComprador, etapaDeAviso, type Etapa, type EtapaComprador } from "@/lib/avisos";
import { fechaCorta, hoyEnVenezuela, usd } from "@/lib/cuotas";
import { codigoCompra } from "@/lib/compra";
import { enviarCorreoRecordatorio, enviarCorreoEnRiesgo, enviarResumenCobranza } from "@/lib/enviar-qr";

// Abona618 — el trabajo diario de avisos.
//
// Vercel llama esto todos los días a las 8:15 de la mañana hora Venezuela
// (ver vercel.json), con "Authorization: Bearer $CRON_SECRET". Sin ese header
// no entra nadie: este endpoint le manda correos a compradores reales.
//
// LO QUE HACE: avisar. LO QUE NO HACE: anular (Anita, 12 oct). Quitarle la
// entrada a alguien y quedarse con lo que abonó es irreversible y toca plata
// de un cliente, así que el cron detecta y la pone en la lista "Hay que
// anular" de Cobranza; el botón lo aprieta una persona.
//
// Tres candados contra el correo repetido, que es la forma más rápida de que
// el remitente entero caiga en spam y entonces tampoco llegue el que importa:
//
//   1. `etapaDeAviso` solo avisa en los días exactos (3, 1, 0 y -1), nunca
//      por rangos, y nunca a quien ya reportó su pago.
//   2. `ultimo_aviso_en` se compara contra HOY en hora de Venezuela: si el
//      cron se repite o alguien lo dispara a mano, la segunda vuelta no manda
//      nada. Y si ese candado NO SE PUEDE LEER, el cron se detiene: antes un
//      error ahí se leía como "nadie ha recibido nada hoy" y se reenviaba a
//      todo el mundo con un 200.
//   3. Cada correo lleva una clave de idempotencia a Resend
//      (cuota + etapa + día). Es la dedupe de verdad: aunque los dos candados
//      locales fallen a la vez, Resend no manda el mismo correo dos veces.
//
// Y una regla de reporte: si el trabajo no se hizo —no se pudo leer la base,
// no se pudo leer el candado— la respuesta NO es 200. Una pasada que no
// envió nada y una que envió todo no pueden verse iguales desde el panel.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Fallo = { compra: string; etapa: Etapa | null; error: string };

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const service = createServiceClient();
  const hoy = hoyEnVenezuela();
  const lista = await listaDeCobranza(service, { hoy });

  if (lista.error) {
    return await abortar(hoy, "No se pudo leer la base de datos de cobranza.");
  }

  const todas: CuotaPorCobrar[] = [
    ...lista.paraAnular,
    ...lista.enGracia,
    ...lista.vencenHoy,
    ...lista.proximas,
    ...lista.masAdelante,
    ...lista.porVerificar,
  ];

  // Quién tiene que recibir qué hoy, antes de tocar nada.
  const tareas: { cuota: CuotaPorCobrar; etapa: Etapa }[] = [];
  for (const c of todas) {
    const etapa = etapaDeAviso({
      diasParaVencer: c.diasParaVencer,
      reportado: Boolean(c.reportadoEn),
      verificado: false, // listaDeCobranza solo devuelve cuotas sin verificar
    });
    if (etapa) tareas.push({ cuota: c, etapa });
  }

  const paraAnular = tareas.filter((t) => t.etapa === "para_anular");
  const aAvisar = tareas.filter(
    (t): t is { cuota: CuotaPorCobrar; etapa: EtapaComprador } => avisaAlComprador(t.etapa)
  );

  // El candado de "ya le escribimos hoy". Una sola consulta para todas. Si
  // falla, se para todo: sin candado no se manda nada.
  const ids = aAvisar.map((t) => t.cuota.cuotaId);
  const yaAvisadas = new Set<string>();
  const avisosPrevios = new Map<string, number>();
  if (ids.length > 0) {
    const { data, error } = await service.from("cuotas").select("id, ultimo_aviso_en, avisos_enviados").in("id", ids);
    if (error) {
      console.error("Abona618 cron: no se pudo leer el candado de avisos —", error.message);
      return await abortar(hoy, "No se pudo leer qué avisos ya salieron hoy, así que no se mandó ninguno.");
    }
    for (const f of data ?? []) {
      const previo = f.ultimo_aviso_en as string | null;
      avisosPrevios.set(String(f.id), Number(f.avisos_enviados ?? 0));
      if (previo && hoyEnVenezuela(new Date(previo)) === hoy) yaAvisadas.add(String(f.id));
    }
  }

  // Un plan con algo vencido y sin reportar pasa a "en mora". Es un sello
  // para el equipo y el dashboard; verificarCuota lo devuelve a "al día"
  // cuando el pago llega. Condicionado a `al_dia` para no pisar nada más.
  const enMora = [...new Set(tareas.filter((t) => t.cuota.diasParaVencer < 0).map((t) => t.cuota.planId))];
  let marcadosEnMora = 0;
  if (enMora.length > 0) {
    const { data, error } = await service
      .from("planes_pago")
      .update({ estado: "en_mora" })
      .in("id", enMora)
      .eq("estado", "al_dia")
      .select("id");
    if (error) console.error("Abona618 cron: no se pudo marcar en mora —", error.message);
    marcadosEnMora = (data ?? []).length;
  }

  const enviados: { compra: string; etapa: Etapa }[] = [];
  const fallos: Fallo[] = [];
  let sinCorreo = 0;

  // De a cinco en paralelo, no uno detrás de otro. Las quincenas son un pico
  // por diseño — el 15 y el 30 a TODAS las cuotas les toca "hoy vence" — y
  // con envíos en serie el límite de 60 s cortaba el bucle a mitad y los
  // avisos del día exacto se perdían para siempre (no hay "mañana" para un
  // aviso de "hoy vence").
  const pendientesDeEnvio = aAvisar.filter(({ cuota: c }) => {
    if (yaAvisadas.has(c.cuotaId)) return false;
    if (!c.compradorEmail) {
      sinCorreo++;
      return false;
    }
    return true;
  });

  const LOTE = 5;
  for (let i = 0; i < pendientesDeEnvio.length; i += LOTE) {
    const lote = pendientesDeEnvio.slice(i, i + LOTE);
    await Promise.all(
      lote.map(async ({ cuota: c, etapa }) => {
        // Misma cuota, misma etapa, mismo día = mismo correo. Resend no lo repite.
        const idempotencyKey = `abona618-${c.cuotaId}-${etapa}-${hoy}`;
        try {
          if (etapa === "en_riesgo") {
            await enviarCorreoEnRiesgo({
              destinatario: c.compradorEmail!,
              nombreComprador: c.compradorNombre ?? "",
              grupoId: c.grupoId,
              etiquetaCuota: c.etiqueta,
              monto: c.montoUsd,
              venceEl: fechaCorta(c.venceEl),
              abonado: c.pagado,
              idempotencyKey,
            });
          } else {
            await enviarCorreoRecordatorio({
              destinatario: c.compradorEmail!,
              nombreComprador: c.compradorNombre ?? "",
              grupoId: c.grupoId,
              etiquetaCuota: c.etiqueta,
              monto: c.montoUsd,
              venceEl: fechaCorta(c.venceEl),
              saldo: c.saldo,
              etapa,
              idempotencyKey,
            });
          }

          // Se sella DESPUÉS de que el correo salió: si falla el envío, mañana
          // se vuelve a intentar en vez de quedar marcado como avisado sin
          // estarlo. El sello lleva la fecha civil de HOY (no now()): una
          // pasada que cruce la medianoche no puede marcar "avisado mañana".
          await service
            .from("cuotas")
            .update({
              ultimo_aviso_en: `${hoy}T12:00:00-04:00`,
              avisos_enviados: (avisosPrevios.get(c.cuotaId) ?? 0) + 1,
            })
            .eq("id", c.cuotaId);

          enviados.push({ compra: codigoCompra(c.grupoId), etapa });
        } catch (e) {
          const error = (e as Error).message;
          console.error(`Abona618 cron: falló el aviso ${etapa} de ${codigoCompra(c.grupoId)} —`, error);
          fallos.push({ compra: codigoCompra(c.grupoId), etapa, error });
        }
      })
    );
  }

  // El resumen interno: a quién hay que anular a mano, qué salió y qué falló.
  // Solo se manda si hay algo que decidir o algo que se rompió — un correo
  // diario vacío se deja de leer en tres días y después no se lee el que
  // importa. "Alguien sin correo" también cuenta como algo que se rompió:
  // ese comprador no va a recibir ningún aviso y alguien tiene que llamarlo.
  const hayQueAnular = paraAnular.map((t) => ({
    compra: codigoCompra(t.cuota.grupoId),
    nombre: t.cuota.compradorNombre ?? "sin nombre",
    etiqueta: t.cuota.etiqueta,
    vencio: fechaCorta(t.cuota.venceEl),
    diasTarde: -t.cuota.diasParaVencer,
    monto: t.cuota.montoUsd,
    abonado: t.cuota.pagado,
    grupoId: t.cuota.grupoId,
  }));

  if (sinCorreo > 0) {
    fallos.push({ compra: "—", etapa: null, error: `${sinCorreo} comprador${sinCorreo === 1 ? "" : "es"} sin correo: hay que avisarle${sinCorreo === 1 ? "" : "s"} por WhatsApp.` });
  }

  let resumenEnviado = false;
  if (hayQueAnular.length > 0 || fallos.length > 0) {
    try {
      await enviarResumenCobranza({
        hoy: fechaCorta(hoy),
        paraAnular: hayQueAnular,
        avisosEnviados: enviados.length,
        fallos,
        saldoTotal: usd(lista.saldoTotal),
      });
      resumenEnviado = true;
    } catch (e) {
      console.error("Abona618 cron: no se pudo mandar el resumen interno —", (e as Error).message);
    }
  }

  const fallaronEnvios = fallos.some((f) => f.etapa !== null);
  return NextResponse.json(
    {
      ok: !fallaronEnvios,
      hoy,
      planesRevisados: lista.planesActivos,
      avisosEnviados: enviados.length,
      yaAvisadosHoy: yaAvisadas.size,
      sinCorreo,
      paraAnular: hayQueAnular.length,
      planesMarcadosEnMora: marcadosEnMora,
      fallos: fallos.length,
      resumenEnviado,
      // Solo códigos de compra: ni nombres ni correos en la respuesta.
      detalle: enviados,
    },
    { status: fallaronEnvios ? 502 : 200 }
  );
}

/** El trabajo no se hizo. Se avisa al equipo y se responde 502 para que la
 *  ejecución se vea FALLIDA en el panel de Vercel, igual que el cron de la
 *  tasa. Los avisos del día no se recuperan solos: alguien tiene que mirar. */
async function abortar(hoy: string, motivo: string) {
  let resumenEnviado = false;
  try {
    await enviarResumenCobranza({
      hoy: fechaCorta(hoy),
      paraAnular: [],
      avisosEnviados: 0,
      fallos: [],
      saldoTotal: "—",
      fallaGeneral: motivo,
    });
    resumenEnviado = true;
  } catch (e) {
    console.error("Abona618 cron: no se pudo avisar del fallo —", (e as Error).message);
  }
  return NextResponse.json({ ok: false, hoy, error: motivo, resumenEnviado }, { status: 502 });
}
