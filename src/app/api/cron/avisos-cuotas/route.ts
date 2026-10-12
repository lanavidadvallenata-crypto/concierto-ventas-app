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
// Dos candados contra el correo repetido, que es la forma más rápida de que
// el remitente entero caiga en spam y entonces tampoco llegue el que importa:
//
//   1. `etapaDeAviso` solo avisa en los días exactos (3, 1, 0 y los de
//      riesgo), nunca por rangos, y nunca a quien ya reportó su pago.
//   2. `ultimo_aviso_en` se compara contra HOY en hora de Venezuela: si el
//      cron se repite o alguien lo dispara a mano, la segunda vuelta no manda
//      nada.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Fallo = { compra: string; etapa: Etapa; error: string };

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const service = createServiceClient();
  const hoy = hoyEnVenezuela();
  const lista = await listaDeCobranza(service, { hoy });

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

  // Un plan con algo vencido pasa a "en mora". Es un sello para el equipo y
  // para el dashboard; no cambia nada de lo que el comprador puede hacer, y
  // verificarCuota sabe sacarlo de ahí cuando el pago llega.
  const enMora = [...new Set(tareas.filter((t) => t.cuota.diasParaVencer < 0).map((t) => t.cuota.planId))];
  if (enMora.length > 0) {
    const { error } = await service.from("planes_pago").update({ estado: "en_mora" }).in("id", enMora).eq("estado", "al_dia");
    if (error) console.error("Abona618 cron: no se pudo marcar en mora —", error.message);
  }

  // El candado de "ya le escribimos hoy". Una sola consulta para todas.
  const ids = aAvisar.map((t) => t.cuota.cuotaId);
  const yaAvisadas = new Set<string>();
  const avisosPrevios = new Map<string, number>();
  if (ids.length > 0) {
    const { data } = await service.from("cuotas").select("id, ultimo_aviso_en, avisos_enviados").in("id", ids);
    for (const f of data ?? []) {
      const previo = f.ultimo_aviso_en as string | null;
      avisosPrevios.set(String(f.id), Number(f.avisos_enviados ?? 0));
      if (previo && hoyEnVenezuela(new Date(previo)) === hoy) yaAvisadas.add(String(f.id));
    }
  }

  const enviados: { compra: string; etapa: Etapa; a: string }[] = [];
  const fallos: Fallo[] = [];
  let sinCorreo = 0;

  for (const { cuota: c, etapa } of aAvisar) {
    if (yaAvisadas.has(c.cuotaId)) continue;
    if (!c.compradorEmail) {
      sinCorreo++;
      continue;
    }

    try {
      if (etapa === "en_riesgo") {
        await enviarCorreoEnRiesgo({
          destinatario: c.compradorEmail,
          nombreComprador: c.compradorNombre ?? "",
          grupoId: c.grupoId,
          etiquetaCuota: c.etiqueta,
          monto: c.montoUsd,
          venceEl: fechaCorta(c.venceEl),
          abonado: c.pagado,
        });
      } else {
        await enviarCorreoRecordatorio({
          destinatario: c.compradorEmail,
          nombreComprador: c.compradorNombre ?? "",
          grupoId: c.grupoId,
          etiquetaCuota: c.etiqueta,
          monto: c.montoUsd,
          venceEl: fechaCorta(c.venceEl),
          saldo: c.saldo,
          etapa,
        });
      }

      // Se sella DESPUÉS de que el correo salió: si falla el envío, mañana se
      // vuelve a intentar en vez de quedar marcado como avisado sin estarlo.
      await service
        .from("cuotas")
        .update({
          ultimo_aviso_en: new Date().toISOString(),
          avisos_enviados: (avisosPrevios.get(c.cuotaId) ?? 0) + 1,
        })
        .eq("id", c.cuotaId);

      enviados.push({ compra: codigoCompra(c.grupoId), etapa, a: c.compradorEmail });
    } catch (e) {
      const error = (e as Error).message;
      console.error(`Abona618 cron: falló el aviso ${etapa} de ${codigoCompra(c.grupoId)} —`, error);
      fallos.push({ compra: codigoCompra(c.grupoId), etapa, error });
    }
  }

  // El resumen interno: a quién hay que anular a mano, qué salió y qué falló.
  // Solo se manda si hay algo que decir — un correo diario vacío se deja de
  // leer en tres días y después no se lee el que importa.
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

  return NextResponse.json({
    ok: true,
    hoy,
    planesRevisados: lista.planesActivos,
    avisosEnviados: enviados.length,
    yaAvisadosHoy: yaAvisadas.size,
    sinCorreo,
    paraAnular: hayQueAnular.length,
    planesMarcadosEnMora: enMora.length,
    fallos: fallos.length,
    resumenEnviado,
    detalle: enviados,
  });
}
