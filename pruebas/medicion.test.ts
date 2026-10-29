import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clasificarDispositivo,
  esBot,
  fuenteDeReferidor,
  limpiarEtiqueta,
  normalizarLlegada,
  rutaLimpia,
  visitanteValido,
} from "../src/lib/medicion.ts";
import {
  calcularRitmo,
  comprasPorHora,
  desdeDelPeriodo,
  diasHastaEvento,
  duracionCorta,
  etiquetaCanal,
  leerPeriodo,
  leerResumen,
  leerZona,
  mayorFuga,
  mediana,
  pasosDelEmbudo,
} from "../src/lib/embudo.ts";

test("de dónde llegó: manda el utm_source y se normalizan los alias", () => {
  assert.equal(normalizarLlegada({ utmSource: "IG", referidor: "https://l.facebook.com/" }).fuente, "instagram");
  assert.equal(normalizarLlegada({ utmSource: "ManyChat" }).fuente, "manychat");
  assert.equal(normalizarLlegada({ utmSource: "wa", utmMedium: "Catálogo 618" }).medio, "catalogo-618");
  const l = normalizarLlegada({ utmSource: "meta", utmMedium: "paid", utmCampaign: "Nov General 2x" });
  assert.deepEqual([l.fuente, l.medio, l.campana], ["meta", "paid", "nov-general-2x"]);
});

test("de dónde llegó sin utm: el sitio que lo mandó, nunca nuestro propio sitio", () => {
  assert.equal(fuenteDeReferidor("https://l.instagram.com/?u=x"), "instagram");
  assert.equal(fuenteDeReferidor("https://www.instagram.com/6.18producciones/"), "instagram");
  assert.equal(fuenteDeReferidor("https://lm.facebook.com/l.php?u=x"), "facebook");
  assert.equal(fuenteDeReferidor("https://wa.me/"), "whatsapp");
  assert.equal(fuenteDeReferidor("https://www.google.co.ve/"), "google");
  assert.equal(fuenteDeReferidor("https://www.tiktok.com/@x"), "tiktok");
  assert.equal(fuenteDeReferidor("https://lanavidadvallenata.com/"), null);
  assert.equal(fuenteDeReferidor("https://618producciones.lanavidadvallenata.com/"), null);
  assert.equal(fuenteDeReferidor("no es una url"), null);
  assert.equal(normalizarLlegada({ fbclid: true }).fuente, "meta");
  assert.equal(normalizarLlegada({ gclid: true }).fuente, "google");
  assert.equal(normalizarLlegada({}).fuente, null);
  // Solo se guarda el dominio que lo mandó, nunca la dirección completa.
  assert.equal(normalizarLlegada({ referidor: "https://www.instagram.com/stories/alguien/123?igsh=abc" }).referidor, "instagram.com");
  assert.equal(normalizarLlegada({ referidor: "https://lanavidadvallenata.com/" }).referidor, null);
});

test("los valores de UTM se recortan y limpian (no entra basura a la base)", () => {
  assert.equal(limpiarEtiqueta("  Campaña <script>Navidad</script> "), "campana-scriptnavidadscript");
  assert.equal(limpiarEtiqueta(""), null);
  assert.equal(limpiarEtiqueta(42), null);
  assert.equal(limpiarEtiqueta("x".repeat(500))?.length, 60);
});

test("bots y vistas previas de enlaces no cuentan como personas", () => {
  assert.equal(esBot("facebookexternalhit/1.1"), true);
  assert.equal(esBot("WhatsApp/2.23.20.0"), true);
  assert.equal(esBot("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120"), true);
  assert.equal(esBot(null), true);
  const iphoneInstagram =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0";
  assert.equal(esBot(iphoneInstagram), false);
  assert.equal(clasificarDispositivo(iphoneInstagram), "movil");
  assert.equal(clasificarDispositivo("Mozilla/5.0 (Linux; Android 13; SM-A135M) Mobile Safari/537.36"), "movil");
  assert.equal(clasificarDispositivo("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"), "escritorio");
});

test("solo se guardan códigos de visitante y rutas con la forma esperada", () => {
  assert.equal(visitanteValido("3f2c9a1e-7b4d-4c2a-9e1f-0a1b2c3d4e5f"), "3f2c9a1e-7b4d-4c2a-9e1f-0a1b2c3d4e5f");
  assert.equal(visitanteValido("x"), null);
  assert.equal(visitanteValido("'; drop table--"), null);
  assert.equal(rutaLimpia("/comprar?utm_source=ig&email=a@b.com"), "/comprar");
  assert.equal(rutaLimpia("https://otro.com"), null);
});

test("período y zona del dashboard se leen de la dirección sin romperse", () => {
  assert.equal(leerPeriodo("hoy"), "hoy");
  assert.equal(leerPeriodo("basura"), "7d");
  assert.equal(leerZona("preferencial"), "preferencial");
  assert.equal(leerZona("vip; drop"), null);
  // Medianoche de Venezuela (UTC-4).
  assert.equal(desdeDelPeriodo("hoy", "2026-10-29"), "2026-10-29T00:00:00-04:00");
  assert.equal(desdeDelPeriodo("7d", "2026-11-02"), "2026-10-27T00:00:00-04:00");
  assert.equal(diasHastaEvento("2026-10-29"), 36);
  assert.equal(diasHastaEvento("2026-12-10"), 0);
});

const resumen = leerResumen({
  pasos: { visitantes: 1000, tienda: 620, continuar: 140, pago: 120, reporto: 54, confirmado: 47 },
  fugas: { expiraron: 30, whatsapp: 12 },
  compras_web: { reportadas: 50, confirmadas: 44, en_cuotas: 21, valor_reportado: "4200.00", valor_confirmado: 3900 },
  canales: [{ canal: "instagram", visitantes: 600, compras: 30, confirmadas: 28, valor_confirmado: "2600" }],
  vivo: { activos_5min: 14, en_pago: 3 },
});

test("el embudo dice cuánto pasa de un paso al siguiente y dónde se pierde más gente", () => {
  const pasos = pasosDelEmbudo(resumen);
  assert.deepEqual(
    pasos.map((p) => p.n),
    [1000, 620, 140, 120, 54, 47]
  );
  assert.equal(pasos[0].delAnterior, null);
  assert.equal(pasos[2].delAnterior, 22.6); // 140 de 620
  assert.equal(pasos[5].delTotal, 4.7); // 47 de 1000
  const fuga = mayorFuga(pasos);
  assert.equal(fuga?.hasta.id, "continuar");
  assert.equal(fuga?.perdidos, 480);
  // Con muy pocas visitas no se señala nada: no significaría nada.
  assert.equal(mayorFuga(pasosDelEmbudo(leerResumen({ pasos: { visitantes: 4, tienda: 1 } }))), null);
});

test("lo que devuelve la base se lee a la defensiva (números como texto, campos que faltan)", () => {
  assert.equal(resumen.comprasWeb.valorReportado, 4200);
  assert.equal(resumen.canales[0].valorConfirmado, 2600);
  assert.equal(resumen.fugas.whatsappCompradores, 0);
  const vacio = leerResumen(null);
  assert.equal(vacio.pasos.visitantes, 0);
  assert.deepEqual(vacio.canales, []);
  assert.equal(etiquetaCanal("manychat"), "ManyChat");
  assert.equal(etiquetaCanal("un-blog.com"), "un-blog.com");
});

test("ritmo: velocidad real contra la necesaria para llenar el día del evento", () => {
  const r = calcularRitmo({ ocupadas: 100, aforo: 320, ultimos7: 28, diasRestantes: 36 });
  assert.equal(r.real, 4);
  assert.equal(r.necesario, 6.1); // 220 que faltan / 36 días
  assert.equal(r.vaBien, false);
  assert.equal(r.proyeccionPct, 76); // 100 + 4·36 = 244 de 320
  const lleno = calcularRitmo({ ocupadas: 320, aforo: 320, ultimos7: 0, diasRestantes: 10 });
  assert.equal(lleno.vaBien, true);
  assert.equal(lleno.proyeccionPct, 100);
  // El día del evento no divide entre cero.
  assert.equal(calcularRitmo({ ocupadas: 10, aforo: 20, ultimos7: 7, diasRestantes: 0 }).necesario, 10);
});

test("compras por hora en hora de Venezuela, mediana y duraciones", () => {
  const horas = comprasPorHora(["2026-10-29T00:30:00Z", "2026-10-29T00:59:00Z", "2026-10-29T13:00:00Z"]);
  assert.equal(horas[20], 2); // 00:30 UTC = 8:30 pm del día anterior en Venezuela
  assert.equal(horas[9], 1);
  assert.equal(horas.reduce((s, n) => s + n, 0), 3);
  assert.equal(mediana([]), null);
  assert.equal(mediana([5, 1, 3]), 3);
  assert.equal(mediana([4, 1, 3, 2]), 2.5);
  assert.equal(duracionCorta(45), "45 min");
  assert.equal(duracionCorta(190), "3 h 10 min");
  assert.equal(duracionCorta(60 * 52), "2 d 4 h");
});
