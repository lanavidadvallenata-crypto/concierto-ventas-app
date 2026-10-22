import { Resend } from "resend";
import QRCode from "qrcode";
import { URL_EQUIPO } from "@/lib/dominios";
import { urlWhatsAppSoporte, WHATSAPP_SOPORTE_VISIBLE } from "@/lib/contacto";
import { codigoCompra } from "@/lib/compra";
import { codigoEntrada } from "@/lib/qr";
import { TEXTO_HORARIO, avisoFueraDeHorario } from "@/lib/horario";
import { conAsiento, etiquetaTipo, nombreEntrada, type Tipo } from "@/lib/precios";
import { fechaCorta } from "@/lib/cuotas";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://lanavidadvallenata.com";
const LOGO_URL = `${SITE_URL}/logo-618-white.png`;
const BANNER_URL = `${SITE_URL}/flyer-horizontal.jpg`;

// El nombre del comprador lo escribe él mismo en el formulario — sin escapar,
// un nombre con "<" o "&" podía romper el HTML del correo. Barato de evitar.
function escapeHtml(texto: string) {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Encabezado compartido por ambos correos — identidad de la CASA
// PRODUCTORA (6.18 Producciones), separado a propósito del banner del
// evento de abajo: el remitente institucional es 6.18, el evento puntual
// que se vende es La Navidad Vallenata. El morado (#3F0A62) es el color
// protagonista aquí a propósito — es el mismo tratamiento que usa el
// bloque "Bienvenido a 6.18" del home (ProductoraHome.tsx): el gris
// (#303030) es el color de chrome/UI (nav, footer), pero el morado es la
// identidad visual reconocible de la marca. Tabla + estilos inline a
// propósito: es lo único que se renderiza igual en Gmail, Outlook y Apple
// Mail sin depender de CSS externo ni de que carguen las fuentes de la marca.
function encabezadoCorreo() {
  return `
    <tr>
      <td style="background-color:#3F0A62;padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="height:4px;background-color:#303030;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td align="center" style="padding:24px 24px 22px;">
              <img src="${LOGO_URL}" width="108" alt="6.18 Producciones" style="display:block;width:108px;height:auto;border:0;margin:0 auto;">
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

// Mini banner del EVENTO — va dentro del cuerpo, justo debajo del
// encabezado de 6.18. Así conviven las dos marcas sin mezclarse: 6.18
// como productora (encabezado, arriba) y La Navidad Vallenata como el
// evento puntual que se está comprando (este banner, con su propia
// paleta roja navideña).
// Arte final horizontal (1080x567) hospedado en el sitio: los clientes de
// correo lo cargan por URL. El alt lleva el texto por si el cliente bloquea
// imágenes (Gmail las muestra; Outlook a veces pide "descargar imágenes").
function bannerEvento() {
  return `
    <tr>
      <td style="background-color:#3D0507;padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="height:3px;background-color:#CE0100;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td style="padding:0;">
              <img src="${BANNER_URL}" width="560" alt="La Navidad Vallenata — Miguel Morales, Diomedes Dionisio e Iván Zuleta · Maracaibo, Hangar Grano de Oro · Vie 04 Dic" style="display:block;width:100%;max-width:560px;height:auto;border:0;">
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function pieCorreo() {
  return `
    <tr>
      <td style="background-color:#F1ECE2;padding:16px 24px;text-align:center;">
        <span style="font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:11px;color:#898477;">La Navidad Vallenata · Un evento de 6.18 Producciones</span>
      </td>
    </tr>
  `;
}

function envolverCorreo(contenido: string) {
  return `
    <!doctype html>
    <html lang="es">
      <body style="margin:0;padding:0;background-color:#F1ECE2;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1ECE2;padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;font-family:'Poppins',Helvetica,Arial,sans-serif;">
                ${encabezadoCorreo()}
                ${bannerEvento()}
                ${contenido}
                ${pieCorreo()}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

// Remitente con nombre real y dirección que no diga "no-responder": los
// filtros de Gmail tratan "no-reply" como señal de correo masivo. Las
// respuestas van al correo del equipo (RESEND_REPLY_TO).
function remitente() {
  return `La Navidad Vallenata <${process.env.RESEND_FROM_EMAIL || "entradas@lanavidadvallenata.com"}>`;
}
function respuestasA() {
  return process.env.RESEND_REPLY_TO || "lanavidadvallenata@gmail.com";
}

function clienteResend(motivo: string) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error(`Falta RESEND_API_KEY — no se puede enviar ${motivo}`);
  }
  return new Resend(process.env.RESEND_API_KEY);
}

const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
const fmtBs = (n: number) => `Bs ${n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Mesa y sillas de la compra, dentro de la caja beige del correo. Sin líneas
// no se pinta nada: el correo queda exactamente como antes.
function bloqueAsientos(lineas: string[] | undefined, cantidad: number) {
  if (!lineas || lineas.length === 0) return "";
  const titulo = cantidad === 1 ? "Tu puesto" : "Tus puestos";
  return `<div style="margin-top:8px;border-top:1px solid #E4DDD0;padding-top:6px;">
      <div style="font-size:12.5px;color:#5A5650;">${titulo}</div>
      ${lineas
        .map(
          (l) =>
            // "4 y 5" no se separa en dos renglones.
            `<div style="font-size:14px;font-weight:700;color:#3D0507;line-height:1.5;">${escapeHtml(l).replace(/ y (\d+)$/, "&nbsp;y&nbsp;$1")}</div>`
        )
        .join("")}
    </div>`;
}

export async function enviarCorreoPendiente(params: {
  destinatario: string;
  nombreComprador: string;
  cantidad?: number;
  tipo?: Tipo;
  totalUsd?: number;
  // Desglose neto + fee: solo cuando la etapa comprada cobra fee aparte
  // (preventa). Con el precio final no hay nada que desglosar y se muestra un
  // solo monto. En ventas manuales el precio puede ser negociado: tampoco.
  subtotalUsd?: number;
  feeUsd?: number;
  totalBs?: number | null;
  referencia?: string | null;
  // grupo_id de la compra: asunto único + cabecera anti-agrupación (ver codigoCompra).
  grupoId?: string;
  // Solo en compras con plan Abona618. Cuando viene, el correo habla de la
  // INICIAL y no del total: el comprador transfirió 56 de 140 y Finanzas tiene
  // que buscar 56 en el banco, no 140 (decisión de Anita, 12 oct — "recibimos
  // tu pago inicial es lo que debe decir"). Sin este parámetro el correo sale
  // exactamente igual que siempre, que es como se queda para el contado.
  plan?: {
    inicialUsd: number;
    inicialBs?: number | null;
    /** Venta en cuotas hecha por el equipo (Ventas, 22 oct): el comprador no
     *  marcó él la casilla, así que el correo le deja por escrito su
     *  calendario y las condiciones que aceptó con la asesora. */
    calendario?: { etiqueta: string; montoUsd: number; venceEl: string; esInicial: boolean }[];
    condiciones?: string[];
  };
  /** Mesa y sillas elegidas, ya redactadas (lineasDeAsientos). Vacío o
   *  ausente = no se muestra el bloque. */
  asientos?: string[];
}) {
  const resend = clienteResend("el correo de bienvenida");
  const plan = params.plan;
  const codigo = params.grupoId ? codigoCompra(params.grupoId) : null;
  const nombre = escapeHtml(params.nombreComprador);
  const cantidad = params.cantidad ?? 1;
  const filaMonto = (etiqueta: string, valor: string, fuerte = false) =>
    `<tr><td style="padding:2px 0;font-size:13.5px;color:${fuerte ? "#303030" : "#5A5650"};${fuerte ? "font-weight:700;" : ""}">${etiqueta}</td><td align="right" style="padding:2px 0;font-size:13.5px;color:${fuerte ? "#303030" : "#5A5650"};${fuerte ? "font-weight:700;" : ""}white-space:nowrap;">${valor}</td></tr>`;
  const desglose =
    params.subtotalUsd != null && params.feeUsd != null && params.feeUsd > 0 && params.totalUsd != null
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-top:1px solid #E4DDD0;padding-top:6px;">
          ${filaMonto("Subtotal (precio neto)", fmtUsd(params.subtotalUsd))}
          ${filaMonto("Fee de servicio (10 %)", fmtUsd(params.feeUsd))}
          ${filaMonto("Total", `${fmtUsd(params.totalUsd)}${params.totalBs != null ? ` · ${fmtBs(params.totalBs)}` : ""}`, true)}
        </table>`
      : "";
  const detalle =
    params.tipo && params.totalUsd != null
      ? `<div style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#303030;background:#F1ECE2;border-radius:8px;padding:12px 14px;">
          <strong>${cantidad} entrada${cantidad === 1 ? "" : "s"} ${etiquetaTipo(params.tipo, cantidad)}</strong>${
          desglose || plan ? "" : ` · ${fmtUsd(params.totalUsd)}${params.totalBs != null ? ` · ${fmtBs(params.totalBs)}` : ""}`
        }${bloqueAsientos(params.asientos, cantidad)}${desglose}${
          plan
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-top:1px solid #E4DDD0;padding-top:6px;">
                ${filaMonto("Total de tu compra", fmtUsd(params.totalUsd ?? 0))}
                ${filaMonto(
                  "Pago inicial que reportaste",
                  `${fmtUsd(plan.inicialUsd)}${plan.inicialBs != null ? ` · ${fmtBs(plan.inicialBs)}` : ""}`,
                  true
                )}
              </table>`
            : ""
        }${params.referencia ? `<div style="color:#8A8782;font-size:12.5px;margin-top:6px;">Referencia de pago: ${escapeHtml(params.referencia)}</div>` : ""}${
          codigo ? `<div style="color:#8A8782;font-size:12.5px;">Código de compra: <strong style="color:#303030;letter-spacing:1px;">${codigo}</strong></div>` : ""
        }
        </div>`
      : "";

  // Avisos pedidos por Anita (22 sep): horario de confirmación (el de esta
  // compra si entró fuera de horario) y revisar Promociones/Spam, porque en la
  // primera tanda real 1 de 6 correos de QR cayó en Promociones.
  const fueraDeHorario = avisoFueraDeHorario(new Date());
  const avisoHorarioHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF6E5;border-left:3px solid #D97706;border-radius:6px;margin:0 0 10px;">
      <tr><td style="padding:12px 14px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#7C2D12;">Horario de confirmación</p>
        ${fueraDeHorario ? `<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#7C2D12;font-weight:700;">${fueraDeHorario}</p>` : ""}
        <p style="margin:0;font-size:12.5px;line-height:1.5;color:#7C2D12;">${TEXTO_HORARIO}</p>
      </td></tr>
    </table>`;
  const avisoBandejaHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1ECE2;border-left:3px solid #3D0507;border-radius:6px;margin:0 0 10px;">
      <tr><td style="padding:12px 14px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#3D0507;">Revisa Promociones y Spam (No deseado)</p>
        <p style="margin:0;font-size:12.5px;line-height:1.5;color:#5A1A1D;">${
          plan ? "Nuestros correos llegan" : "Tus QR llegan en <strong>otro correo</strong>"
        } de &ldquo;La Navidad Vallenata&rdquo;${
          codigo ? ` con tu código de compra <strong>${codigo}</strong>` : ""
        }. Si no ${plan ? "los ves" : "lo ves"} en tu bandeja principal, ${
          plan ? "búscalos" : "búscalo"
        } en Promociones y en Spam, y ${plan ? "márcalos" : "márcalo"} como &ldquo;No es spam&rdquo; para que no se ${plan ? "pierdan" : "pierda"}.</p>
      </td></tr>
    </table>`;
  const mensajeWa = `Hola, compré entradas para La Navidad Vallenata${codigo ? ` (compra ${codigo})` : ""} a nombre de ${params.nombreComprador}. Necesito ayuda con: `;
  const botonSoporteHtml = `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px auto 0;">
      <tr>
        <td align="center" style="background-color:#25D366;border-radius:8px;">
          <a href="${urlWhatsAppSoporte(mensajeWa)}" style="display:inline-block;padding:11px 20px;font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:13.5px;font-weight:700;color:#FFFFFF;text-decoration:none;">¿Algún dato mal escrito? Escríbenos por WhatsApp</a>
        </td>
      </tr>
    </table>
    <p style="margin:6px 0 0;font-size:12px;color:#8A8782;text-align:center;">${WHATSAPP_SOPORTE_VISIBLE} · o responde este correo</p>`;

  const html = envolverCorreo(`
    <tr>
      <td style="padding:32px 28px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:14px;">
              <div style="display:inline-block;background-color:#F1ECE2;color:#3D0507;font-weight:700;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;border-radius:999px;padding:7px 16px;">Compra recibida</div>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#303030;">Hola <strong>${nombre}</strong>, ${
          plan
            ? "recibimos tu compra y ya estamos verificando tu <strong>pago inicial</strong>."
            : "recibimos tu compra y ya estamos verificando tu pago."
        }</p>
        ${detalle}
        <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#303030;">${
          plan
            ? "En cuanto se confirme, te llegará un correo a esta misma dirección con el detalle de tu plan de pago. No necesitas hacer nada más por ahora."
            : `En cuanto se confirme, te llegará un correo a esta misma dirección con ${
                cantidad > 1 ? "tus <strong>entradas y códigos QR</strong> de acceso (uno por persona)" : "tu <strong>entrada y código QR</strong> de acceso"
              }. No necesitas hacer nada más por ahora.`
        }</p>
      </td>
    </tr>
    ${
      plan
        ? `<tr>
      <td style="padding:4px 28px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td align="center" style="background-color:#3F0A62;border-radius:8px;">
              <a href="${SITE_URL}/compra/${params.grupoId}" style="display:inline-block;padding:12px 22px;font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">Ver mi plan de pago y mis fechas</a>
            </td>
          </tr>
        </table>
        <p style="margin:8px 0 0;font-size:12px;color:#8A8782;text-align:center;">Guarda este enlace: es tu página de compra.</p>
      </td>
    </tr>`
        : ""
    }${
      plan?.calendario?.length || plan?.condiciones?.length
        ? `<tr>
      <td style="padding:16px 28px 4px;">
        ${
          plan.calendario?.length
            ? `<p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#3D0507;">Tu plan de pagos</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1ECE2;border-radius:8px;padding:8px 14px;">
          ${plan.calendario
            .map((c) => filaMonto(`${escapeHtml(c.etiqueta)} · ${c.esInicial ? "hoy" : fechaCorta(c.venceEl)}`, fmtUsd(c.montoUsd), c.esInicial))
            .join("")}
        </table>`
            : ""
        }
        ${
          plan.condiciones?.length
            ? `<p style="margin:14px 0 6px;font-size:13px;font-weight:700;color:#3D0507;">Las condiciones que aceptaste con nuestra asesora</p>
        <ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.55;color:#5A5650;">
          ${plan.condiciones.map((c) => `<li style="margin:0 0 4px;">${escapeHtml(c)}</li>`).join("")}
        </ul>
        <p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:#8A8782;">Si algo de esto no es lo que hablaste con nosotros, responde este correo o escríbenos por WhatsApp antes de tu próximo pago.</p>`
            : ""
        }
      </td>
    </tr>`
        : ""
    }
    <tr>
      <td style="padding:10px 28px 4px;">
        ${avisoHorarioHtml}
        ${avisoBandejaHtml}
      </td>
    </tr>
    <tr>
      <td style="padding:8px 28px 30px;border-top:1px solid #F1ECE2;">
        ${botonSoporteHtml}
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: remitente(),
    replyTo: respuestasA(),
    to: params.destinatario,
    subject: codigo ? `Recibimos tu compra ${codigo} — La Navidad Vallenata` : "Recibimos tu compra — La Navidad Vallenata",
    html,
    ...(params.grupoId ? { headers: { "X-Entity-Ref-ID": params.grupoId } } : {}),
  });
  if (error) throw new Error(`Resend: ${error.name ?? "error"} — ${error.message}`);
}

export type EntradaQR = {
  qrToken: string;
  tipo: Tipo;
  fila?: string | null;
  mesaNumero?: number | null;
  sillaNumero?: number | null;
};

function describirEntrada(e: EntradaQR) {
  if (!conAsiento(e.tipo)) return "Entrada General";
  if (e.mesaNumero != null && e.sillaNumero != null) {
    const asiento = `${e.fila ? `Fila ${e.fila} · ` : ""}Mesa ${e.mesaNumero} · Silla ${e.sillaNumero}`;
    return e.tipo === "preferencial" ? `Preferencial · ${asiento}` : asiento;
  }
  return `${nombreEntrada(e.tipo)} — tu mesa y silla te las confirma el equipo en la puerta`;
}

// Un correo con TODAS las entradas de la compra: un bloque + un QR por
// asistente. El comprador reenvía cada QR a su invitado; en la puerta cada
// uno entra por separado.
export async function enviarCorreoQR(params: {
  destinatario: string;
  nombreComprador: string;
  entradas: EntradaQR[];
  // grupo_id de la compra (o id del ticket si es una compra vieja sin grupo).
  grupoId: string;
}) {
  const resend = clienteResend("el correo con el QR");
  const nombre = escapeHtml(params.nombreComprador);
  const entradas = params.entradas;
  if (entradas.length === 0) throw new Error("Sin entradas para enviar");
  const codigo = codigoCompra(params.grupoId);
  const urlCompra = `${SITE_URL}/compra/${params.grupoId}`;

  const attachments: { filename: string; content: string; contentId: string }[] = [];
  const bloques: string[] = [];

  for (let i = 0; i < entradas.length; i++) {
    const e = entradas[i];
    const urlAcceso = `${URL_EQUIPO}/acceso/${e.qrToken}`;
    const qrDataUrl = await QRCode.toDataURL(urlAcceso, { width: 480, margin: 2 });
    const cid = `qr-entrada-${i + 1}`;
    attachments.push({ filename: `entrada-${i + 1}-qr.png`, content: qrDataUrl.split(",")[1], contentId: cid });

    const etiquetaDeTipo = conAsiento(e.tipo) ? nombreEntrada(e.tipo) : "Acceso general · sin asiento asignado";
    bloques.push(`
    <tr>
      <td style="padding:${i === 0 ? 16 : 8}px 28px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1ECE2;border-radius:10px;">
          <tr>
            <td align="center" style="padding:16px 20px;">
              ${entradas.length > 1 ? `<div style="font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8A8782;margin-bottom:4px;">Entrada ${i + 1} de ${entradas.length}</div>` : ""}
              <div style="font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:20px;letter-spacing:0.5px;color:#3D0507;">${describirEntrada(e)}</div>
              <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#680F15;margin-top:4px;">${etiquetaDeTipo}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:12px 28px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid #F1ECE2;border-radius:10px;">
          <tr>
            <td style="padding:16px;">
              <img src="cid:${cid}" width="220" height="220" alt="Código QR de entrada ${i + 1}" style="display:block;width:220px;height:220px;border:0;">
              ${codigoEntrada(e.qrToken) ? `<p style="margin:10px 0 0;text-align:center;font-size:11px;color:#8A8782;">Si el QR no escanea, di este código en la puerta:<br><span style="font-family:Menlo,Consolas,monospace;font-size:17px;font-weight:700;letter-spacing:2px;color:#303030;">${codigoEntrada(e.qrToken)}</span></p>` : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>`);
  }

  const html = envolverCorreo(`
    <tr>
      <td style="padding:28px 28px 8px;">
        <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#303030;">Hola <strong>${nombre}</strong>, ${
          entradas.length > 1
            ? `aquí están tus <strong>${entradas.length} entradas</strong> (compra ${codigo}). Cada una tiene su propio código QR y es de una persona. En la puerta, el personal de acceso escanea cada QR con la cámara de su teléfono.`
            : `esta es tu entrada (compra ${codigo}). Preséntala en la puerta el día del evento — el personal de acceso la va a escanear con la cámara de su teléfono.`
        }</p>
      </td>
    </tr>
    ${bloques.join("")}
    <tr>
      <td align="center" style="padding:4px 28px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="background-color:#3D0507;border-radius:8px;">
              <a href="${urlCompra}" style="display:inline-block;padding:13px 24px;font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">${
                entradas.length > 1 ? "Ver mis entradas y enviarlas por WhatsApp" : "Ver mi entrada en el teléfono"
              }</a>
            </td>
          </tr>
        </table>
        <p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:#8A8782;">${
          entradas.length > 1
            ? "Desde ahí le mandas a cada invitado su entrada por WhatsApp; a cada uno le llega un enlace que abre su QR en su teléfono."
            : "Ahí ves tu QR en grande y puedes guardarlo o mandarlo por WhatsApp si la va a usar otra persona."
        }</p>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 28px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF4F1;border-left:3px solid #CE0100;border-radius:6px;">
          <tr>
            <td style="padding:14px 16px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#3D0507;">Importante — uso y seguridad de tu QR</p>
              <p style="margin:0 0 6px;font-size:12.5px;line-height:1.5;color:#680F15;">Cada código es único y personal. Si lo compartes con alguien más, solo la primera persona que lo presente en la puerta podrá ingresar.</p>
              <p style="margin:0;font-size:12.5px;line-height:1.5;color:#680F15;">Una vez usado en la entrada, el código queda desactivado y no sirve para ingresos posteriores ni para volver a entrar.</p>
            </td>
          </tr>
        </table>
        <p style="margin:14px 0 0;font-size:12.5px;line-height:1.6;color:#8A8782;text-align:center;">¿Algún problema con tus entradas? Escríbenos por WhatsApp al <strong style="color:#303030;">${WHATSAPP_SOPORTE_VISIBLE}</strong> o responde este correo.</p>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: remitente(),
    replyTo: respuestasA(),
    to: params.destinatario,
    subject: entradas.length > 1 ? `Tus ${entradas.length} entradas · compra ${codigo} — La Navidad Vallenata` : `Tu entrada · compra ${codigo} — La Navidad Vallenata`,
    html,
    attachments,
    // Gmail respeta esta cabecera para NO agrupar correos distintos en un
    // mismo hilo aunque se parezcan; con el grupo_id, cada compra es su
    // propia conversación y un reenvío de la misma compra sí se agrupa.
    headers: { "X-Entity-Ref-ID": params.grupoId },
  });
  if (error) throw new Error(`Resend: ${error.name ?? "error"} — ${error.message}`);
}

// Pago rechazado (pedido del equipo, 19 sep): se le dice al comprador qué
// pasó, con el monto y la referencia que reportó, y un botón de WhatsApp con
// el mensaje ya escrito para que mande el comprobante y Finanzas pueda
// reabrir la compra.
// `anulacion`: la compra ya estaba aprobada y tenía QR (se aprobó por error
// sin el dinero en el banco). Anita, 22 oct: el correo dice "no pudimos
// verificar tu pago", que su entrada está en pausa y que se comunique por
// WhatsApp.
export async function enviarCorreoRechazo(params: {
  destinatario: string;
  nombreComprador: string;
  cantidad: number;
  tipo: Tipo;
  totalUsd: number;
  totalBs: number | null;
  referencia: string | null;
  metodoEtiqueta: string;
  grupoId?: string;
  motivo?: "rechazo" | "anulacion";
}) {
  if (params.motivo === "anulacion") return enviarCorreoEntradaEnPausa(params);
  const resend = clienteResend("el correo de pago rechazado");
  const codigo = params.grupoId ? codigoCompra(params.grupoId) : null;
  const nombre = escapeHtml(params.nombreComprador);
  const ref = params.referencia ? escapeHtml(params.referencia) : "sin referencia";
  const mensajeWa = `Hola, soy ${params.nombreComprador}. Mi pago de ${fmtUsd(params.totalUsd)}${
    params.totalBs != null ? ` (${fmtBs(params.totalBs)})` : ""
  } por ${params.metodoEtiqueta}, referencia ${params.referencia ?? "—"}, para La Navidad Vallenata fue rechazado. Adjunto el comprobante para que lo revisen.`;
  const urlWa = urlWhatsAppSoporte(mensajeWa);

  const html = envolverCorreo(`
    <tr>
      <td style="padding:32px 28px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:14px;">
              <div style="display:inline-block;background-color:#FBE9E7;color:#B00020;font-weight:700;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;border-radius:999px;padding:7px 16px;">No pudimos confirmar tu pago</div>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#303030;">Hola <strong>${nombre}</strong>, revisamos tu compra y <strong>no encontramos el pago</strong> con los datos que nos diste:</p>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#303030;background:#F1ECE2;border-radius:8px;padding:12px 14px;">
          <strong>${params.cantidad} entrada${params.cantidad === 1 ? "" : "s"} ${etiquetaTipo(params.tipo, params.cantidad)}</strong><br>
          Monto: ${fmtUsd(params.totalUsd)}${params.totalBs != null ? ` · ${fmtBs(params.totalBs)}` : ""}<br>
          Método: ${escapeHtml(params.metodoEtiqueta)}<br>
          Referencia reportada: <strong>${ref}</strong>
        </p>
        <p style="margin:0 0 6px;font-size:15px;line-height:1.6;color:#303030;">Si sí hiciste el pago, mándanos el comprobante (captura o foto) por WhatsApp y lo verificamos de nuevo. Con el botón de abajo el mensaje ya sale escrito con tus datos:</p>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:6px 28px 20px;">
        <a href="${urlWa}" style="display:inline-block;background-color:#25D366;color:#FFFFFF;font-family:'Poppins',Helvetica,Arial,sans-serif;font-weight:700;font-size:15px;text-decoration:none;border-radius:999px;padding:14px 28px;">Enviar comprobante por WhatsApp</a>
        <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:12px;color:#8A8782;margin-top:10px;">${WHATSAPP_SOPORTE_VISIBLE}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:4px 28px 32px;">
        <p style="margin:0;font-size:12.5px;line-height:1.6;color:#8A8782;border-top:1px solid #F1ECE2;padding-top:16px;">${
          conAsiento(params.tipo)
            ? "Las sillas que habías elegido volvieron a estar disponibles. Si el pago se confirma, intentaremos asignarte las mismas; si alguien las tomó, te ayudamos a elegir otras."
            : "Si el pago se confirma, tus entradas quedan activas y te llega el correo con los códigos QR."
        }</p>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: remitente(),
    replyTo: respuestasA(),
    to: params.destinatario,
    subject: codigo ? `No pudimos confirmar tu pago · compra ${codigo} — La Navidad Vallenata` : "No pudimos confirmar tu pago — La Navidad Vallenata",
    html,
    ...(params.grupoId ? { headers: { "X-Entity-Ref-ID": params.grupoId } } : {}),
  });
  if (error) throw new Error(`Resend: ${error.name ?? "error"} — ${error.message}`);
}

async function enviarCorreoEntradaEnPausa(params: {
  destinatario: string;
  nombreComprador: string;
  cantidad: number;
  tipo: Tipo;
  totalUsd: number;
  totalBs: number | null;
  referencia: string | null;
  metodoEtiqueta: string;
  grupoId?: string;
}) {
  const resend = clienteResend("el correo de entrada en pausa");
  const codigo = params.grupoId ? codigoCompra(params.grupoId) : null;
  const nombre = escapeHtml(params.nombreComprador);
  const ref = params.referencia ? escapeHtml(params.referencia) : "sin referencia";
  const varias = params.cantidad > 1;
  const mensajeWa = `Hola, soy ${params.nombreComprador}. Me llegó el correo de que ${varias ? "mis entradas están" : "mi entrada está"} en pausa${
    codigo ? ` (compra ${codigo})` : ""
  }. Mi pago fue de ${fmtUsd(params.totalUsd)}${params.totalBs != null ? ` (${fmtBs(params.totalBs)})` : ""} por ${params.metodoEtiqueta}, referencia ${
    params.referencia ?? "—"
  }. Les envío el comprobante.`;
  const urlWa = urlWhatsAppSoporte(mensajeWa);

  const html = envolverCorreo(`
    <tr>
      <td style="padding:32px 28px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:14px;">
              <div style="display:inline-block;background-color:#FBE9E7;color:#B00020;font-weight:700;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;border-radius:999px;padding:7px 16px;">No pudimos verificar tu pago</div>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#303030;">Hola <strong>${nombre}</strong>, revisamos tu compra y <strong>no pudimos verificar el pago</strong> con estos datos:</p>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#303030;background:#F1ECE2;border-radius:8px;padding:12px 14px;">
          <strong>${params.cantidad} entrada${varias ? "s" : ""} ${etiquetaTipo(params.tipo, params.cantidad)}</strong>${codigo ? ` · compra ${codigo}` : ""}<br>
          Monto: ${fmtUsd(params.totalUsd)}${params.totalBs != null ? ` · ${fmtBs(params.totalBs)}` : ""}<br>
          Método: ${escapeHtml(params.metodoEtiqueta)}<br>
          Referencia: <strong>${ref}</strong>
        </p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#303030;"><strong>${
          varias ? "Tus entradas están en pausa" : "Tu entrada está en pausa"
        }</strong>: ${varias ? "los códigos QR que te enviamos no sirven" : "el código QR que te enviamos no sirve"} por ahora.</p>
        <p style="margin:0 0 6px;font-size:15px;line-height:1.6;color:#303030;">Comunícate con nosotros por WhatsApp y envíanos el comprobante del pago (captura o foto) para revisarlo de nuevo. Con el botón de abajo el mensaje ya sale escrito con tus datos:</p>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:6px 28px 20px;">
        <a href="${urlWa}" style="display:inline-block;background-color:#25D366;color:#FFFFFF;font-family:'Poppins',Helvetica,Arial,sans-serif;font-weight:700;font-size:15px;text-decoration:none;border-radius:999px;padding:14px 28px;">Escríbenos por WhatsApp</a>
        <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:12px;color:#8A8782;margin-top:10px;">${WHATSAPP_SOPORTE_VISIBLE}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:4px 28px 32px;">
        <p style="margin:0;font-size:12.5px;line-height:1.6;color:#8A8782;border-top:1px solid #F1ECE2;padding-top:16px;">${
          conAsiento(params.tipo)
            ? `Cuando confirmemos el pago ${varias ? "te llegan de nuevo tus entradas" : "te llega de nuevo tu entrada"} al correo. Mientras tanto ${varias ? "las sillas quedan liberadas" : "la silla queda liberada"}: intentaremos asignarte ${varias ? "las mismas" : "la misma"}, y si alguien ${varias ? "las tomó" : "la tomó"}, te ayudamos a elegir otra${varias ? "s" : ""}.`
            : `Cuando confirmemos el pago ${varias ? "te llegan de nuevo tus entradas" : "te llega de nuevo tu entrada"} al correo.`
        }</p>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: remitente(),
    replyTo: respuestasA(),
    to: params.destinatario,
    subject: codigo
      ? `${varias ? "Tus entradas están" : "Tu entrada está"} en pausa · compra ${codigo} — Navidad Vallenata`
      : `${varias ? "Tus entradas están" : "Tu entrada está"} en pausa — Navidad Vallenata`,
    html,
    ...(params.grupoId ? { headers: { "X-Entity-Ref-ID": params.grupoId } } : {}),
  });
  if (error) throw new Error(`Resend: ${error.name ?? "error"} — ${error.message}`);
}

// ---------------------------------------------------------------------------
// Abona618 — plantilla A: una cuota quedó verificada y el plan sigue abierto.
//
// Este correo existe porque sin él el comprador paga su cuota y no recibe
// nada: el único acuse que el sistema tenía era el correo con los QR, que no
// puede salir hasta el 100 %. Dice en qué quedó su plan, qué falta, cuándo, y
// repite que el QR llega al completar — que es la frase que va a evitar
// discusiones en la puerta el 4 de diciembre.
// ---------------------------------------------------------------------------
export async function enviarCorreoCuotaVerificada(params: {
  destinatario: string;
  nombreComprador: string;
  grupoId: string;
  etiquetaCuota: string;
  montoVerificado: number;
  totalUsd: number;
  pagado: number;
  saldo: number;
  pendientes: { etiqueta: string; monto: number; venceEl: string }[];
  /** Fecha de vencimiento de la PRÓXIMA cuota. El plazo de gracia NO se le
   *  dice al comprador (Anita, 12 oct): si lo sabe, espera hasta el último día
   *  y pide prórroga. Ve su fecha y nada más. */
  proximaFecha: string | null;
  /** Mesa y sillas apartadas (lineasDeAsientos). Vacío = no se muestra. */
  asientos?: string[];
  cantidad?: number;
}) {
  const resend = clienteResend("el correo de cuota verificada");
  const codigo = codigoCompra(params.grupoId);
  const nombre = escapeHtml(params.nombreComprador);
  const faltan = params.pendientes.length;

  const filas = params.pendientes
    .map(
      (p) => `<tr>
        <td style="padding:7px 0;font-size:13.5px;color:#303030;border-top:1px solid #EDE9E1;">${escapeHtml(p.etiqueta)}
          <span style="color:#8A8782;">· vence el ${escapeHtml(p.venceEl)}</span></td>
        <td align="right" style="padding:7px 0;font-size:13.5px;font-weight:700;color:#303030;border-top:1px solid #EDE9E1;white-space:nowrap;">${fmtUsd(p.monto)}</td>
      </tr>`
    )
    .join("");

  const html = envolverCorreo(`
    <tr>
      <td style="padding:32px 28px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:14px;">
              <div style="display:inline-block;background-color:#EAF7EE;color:#1B5E20;font-weight:700;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;border-radius:999px;padding:7px 16px;">Pago confirmado</div>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#303030;">Hola <strong>${nombre}</strong>, confirmamos tu pago de <strong>${fmtUsd(params.montoVerificado)}</strong> (${escapeHtml(params.etiquetaCuota)}). ${
          (params.cantidad ?? 1) > 1 ? "Tus entradas siguen apartadas" : "Tu entrada sigue apartada"
        } a tu nombre.</p>

        <div style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#303030;background:#F1ECE2;border-radius:8px;padding:12px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:2px 0;font-size:13.5px;color:#5A5650;">Llevas pagado</td>
              <td align="right" style="padding:2px 0;font-size:13.5px;color:#5A5650;white-space:nowrap;">${fmtUsd(params.pagado)} de ${fmtUsd(params.totalUsd)}</td>
            </tr>
            <tr>
              <td style="padding:2px 0;font-size:13.5px;font-weight:700;color:#303030;">Te falta</td>
              <td align="right" style="padding:2px 0;font-size:13.5px;font-weight:700;color:#303030;white-space:nowrap;">${fmtUsd(params.saldo)}</td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
            ${filas}
          </table>${bloqueAsientos(params.asientos, params.cantidad ?? 1)}
          <div style="color:#8A8782;font-size:12.5px;margin-top:8px;">Código de compra: <strong style="color:#303030;letter-spacing:1px;">${codigo}</strong></div>
        </div>

        <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#303030;"><strong>Tu código QR de acceso te llega cuando completes el total</strong>, no antes. Sin QR no se entra al evento, ni siquiera habiendo pagado una parte.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 28px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td align="center" style="background-color:#3F0A62;border-radius:8px;">
              <a href="${SITE_URL}/compra/${params.grupoId}" style="display:inline-block;padding:12px 22px;font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">Ver mi plan y los datos de pago</a>
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF6E5;border-left:3px solid #D97706;border-radius:6px;margin:14px 0 10px;">
          <tr><td style="padding:12px 14px;">
            <p style="margin:0;font-size:12.5px;line-height:1.5;color:#7C2D12;"><strong>Cada pago tiene su fecha.</strong> ${
              params.proximaFecha
                ? `El siguiente vence el <strong>${escapeHtml(params.proximaFecha)}</strong>.`
                : ""
            } Si no pagas en la fecha de cualquiera de ellos, se anula toda la compra, tu entrada vuelve a la venta y lo abonado no se devuelve. Te avisamos antes de cada fecha. <a href="${SITE_URL}/compra/${params.grupoId}" style="color:#7C2D12;font-weight:700;">Mira las condiciones en tu página de compra</a>.</p>
          </td></tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 28px 30px;border-top:1px solid #F1ECE2;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px auto 0;">
          <tr>
            <td align="center" style="background-color:#25D366;border-radius:8px;">
              <a href="${urlWhatsAppSoporte(`Hola, tengo una duda con mi plan Abona618 (compra ${codigo}) a nombre de ${params.nombreComprador}. `)}" style="display:inline-block;padding:11px 20px;font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:13.5px;font-weight:700;color:#FFFFFF;text-decoration:none;">¿Alguna duda? Escríbenos por WhatsApp</a>
            </td>
          </tr>
        </table>
        <p style="margin:6px 0 0;font-size:12px;color:#8A8782;text-align:center;">${WHATSAPP_SOPORTE_VISIBLE} · o responde este correo</p>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: remitente(),
    replyTo: respuestasA(),
    to: params.destinatario,
    subject:
      faltan === 1
        ? `Recibimos tu ${params.etiquetaCuota.toLowerCase()} · queda 1 pago · compra ${codigo}`
        : `Recibimos tu ${params.etiquetaCuota.toLowerCase()} · quedan ${faltan} pagos · compra ${codigo}`,
    html,
    headers: { "X-Entity-Ref-ID": `${params.grupoId}-${params.etiquetaCuota}` },
  });
  if (error) throw new Error(`Resend: ${error.name ?? "error"} — ${error.message}`);
}

// ---------------------------------------------------------------------------
// Abona618 — plantilla B: recordatorio antes de que venza una cuota.
//
// Tres tonos de la misma plantilla: 3 días antes, el día antes, y el día que
// vence. NO menciona el margen interno del equipo (Anita, 12 oct): el
// comprador ve su fecha, y su fecha es la fecha.
// ---------------------------------------------------------------------------
export async function enviarCorreoRecordatorio(params: {
  destinatario: string;
  nombreComprador: string;
  grupoId: string;
  etiquetaCuota: string;
  monto: number;
  /** "30 de octubre" */
  venceEl: string;
  saldo: number;
  etapa: "tres_dias" | "manana" | "hoy";
  /** La dedupe de verdad vive en Resend: con la misma clave, el mismo correo
   *  no sale dos veces aunque el candado local falle o el cron se repita. */
  idempotencyKey?: string;
}) {
  const resend = clienteResend("el recordatorio de cuota");
  const codigo = codigoCompra(params.grupoId);
  const nombre = escapeHtml(params.nombreComprador);
  const fecha = escapeHtml(params.venceEl);

  const titulo =
    params.etapa === "hoy"
      ? "Hoy vence tu pago"
      : params.etapa === "manana"
        ? "Mañana vence tu pago"
        : "Se acerca tu próximo pago";

  const asunto =
    params.etapa === "hoy"
      ? `Hoy vence tu pago de ${fmtUsd(params.monto)} · compra ${codigo}`
      : params.etapa === "manana"
        ? `Mañana vence tu pago de ${fmtUsd(params.monto)} · compra ${codigo}`
        : `Tu pago de ${fmtUsd(params.monto)} vence el ${params.venceEl} · compra ${codigo}`;

  const html = envolverCorreo(`
    <tr>
      <td style="padding:32px 28px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:14px;">
              <div style="display:inline-block;background-color:#FFF6E5;color:#7C2D12;font-weight:700;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;border-radius:999px;padding:7px 16px;">${escapeHtml(titulo)}</div>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#303030;">Hola <strong>${nombre}</strong>, te recordamos tu próximo pago de La Navidad Vallenata.</p>

        <div style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#303030;background:#F1ECE2;border-radius:8px;padding:12px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:2px 0;font-size:13.5px;font-weight:700;color:#303030;">${escapeHtml(params.etiquetaCuota)}</td>
              <td align="right" style="padding:2px 0;font-size:16px;font-weight:700;color:#303030;white-space:nowrap;">${fmtUsd(params.monto)}</td>
            </tr>
            <tr>
              <td style="padding:2px 0;font-size:13.5px;color:#5A5650;">Vence el</td>
              <td align="right" style="padding:2px 0;font-size:13.5px;color:#5A5650;white-space:nowrap;">${fecha}</td>
            </tr>
            <tr>
              <td style="padding:2px 0;font-size:13.5px;color:#5A5650;">Te falta en total</td>
              <td align="right" style="padding:2px 0;font-size:13.5px;color:#5A5650;white-space:nowrap;">${fmtUsd(params.saldo)}</td>
            </tr>
          </table>
          <div style="color:#8A8782;font-size:12.5px;margin-top:8px;">Código de compra: <strong style="color:#303030;letter-spacing:1px;">${codigo}</strong></div>
        </div>

        <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#303030;">En tu página de compra tienes los datos para pagar y el botón para avisarnos cuando lo hagas.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 28px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td align="center" style="background-color:#3F0A62;border-radius:8px;">
              <a href="${SITE_URL}/compra/${params.grupoId}" style="display:inline-block;padding:12px 22px;font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">Ver mi plan y los datos de pago</a>
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF6E5;border-left:3px solid #D97706;border-radius:6px;margin:14px 0 10px;">
          <tr><td style="padding:12px 14px;">
            <p style="margin:0;font-size:12.5px;line-height:1.5;color:#7C2D12;">Si no pagas en la fecha, se anula toda la compra, tu entrada vuelve a la venta y lo que ya abonaste no se devuelve. Tu QR llega cuando completes el total.</p>
          </td></tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 28px 30px;border-top:1px solid #F1ECE2;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px auto 0;">
          <tr>
            <td align="center" style="background-color:#25D366;border-radius:8px;">
              <a href="${urlWhatsAppSoporte(`Hola, es sobre mi pago de La Navidad Vallenata (compra ${codigo}) a nombre de ${params.nombreComprador}. `)}" style="display:inline-block;padding:11px 20px;font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:13.5px;font-weight:700;color:#FFFFFF;text-decoration:none;">¿Algún problema? Escríbenos</a>
            </td>
          </tr>
        </table>
        <p style="margin:6px 0 0;font-size:12px;color:#8A8782;text-align:center;">${WHATSAPP_SOPORTE_VISIBLE} · o responde este correo</p>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: remitente(),
    replyTo: respuestasA(),
    to: params.destinatario,
    subject: asunto,
    html,
    headers: { "X-Entity-Ref-ID": `${params.grupoId}-${params.etiquetaCuota}-${params.etapa}` },
  }, params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined);
  if (error) throw new Error(`Resend: ${error.name ?? "error"} — ${error.message}`);
}

// ---------------------------------------------------------------------------
// Abona618 — plantilla C: la cuota venció y el pago no llegó.
//
// El equipo tiene por dentro un par de días de margen antes de anular, pero
// este correo NO los menciona (Anita, 12 oct): "si no, esperan hasta el último
// día y piden más prórroga". Para el comprador la entrada está en riesgo hoy.
// ---------------------------------------------------------------------------
export async function enviarCorreoEnRiesgo(params: {
  destinatario: string;
  nombreComprador: string;
  grupoId: string;
  etiquetaCuota: string;
  monto: number;
  venceEl: string;
  abonado: number;
  idempotencyKey?: string;
}) {
  const resend = clienteResend("el aviso de entrada en riesgo");
  const codigo = codigoCompra(params.grupoId);
  const nombre = escapeHtml(params.nombreComprador);

  const html = envolverCorreo(`
    <tr>
      <td style="padding:32px 28px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:14px;">
              <div style="display:inline-block;background-color:#FEE2E2;color:#991B1B;font-weight:700;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;border-radius:999px;padding:7px 16px;">Tu entrada está en riesgo</div>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#303030;">Hola <strong>${nombre}</strong>, tu pago de <strong>${fmtUsd(params.monto)}</strong> (${escapeHtml(params.etiquetaCuota)}) venció el <strong>${escapeHtml(params.venceEl)}</strong> y todavía no nos ha llegado.</p>

        <div style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#303030;background:#FEF2F2;border-radius:8px;padding:12px 14px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#991B1B;"><strong>Tu entrada puede volver a la venta en cualquier momento.</strong> Si eso pasa, los ${fmtUsd(params.abonado)} que ya abonaste no se devuelven.</p>
          <div style="color:#8A8782;font-size:12.5px;margin-top:8px;">Código de compra: <strong style="color:#303030;letter-spacing:1px;">${codigo}</strong></div>
        </div>

        <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#303030;"><strong>Si ya pagaste</strong>, mándanos la referencia por WhatsApp ahora mismo y lo revisamos de una vez.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 28px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td align="center" style="background-color:#3F0A62;border-radius:8px;">
              <a href="${SITE_URL}/compra/${params.grupoId}" style="display:inline-block;padding:12px 22px;font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">Pagar ahora</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 28px 30px;border-top:1px solid #F1ECE2;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px auto 0;">
          <tr>
            <td align="center" style="background-color:#25D366;border-radius:8px;">
              <a href="${urlWhatsAppSoporte(`Hola, es sobre mi pago pendiente de La Navidad Vallenata (compra ${codigo}) a nombre de ${params.nombreComprador}. `)}" style="display:inline-block;padding:11px 20px;font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:13.5px;font-weight:700;color:#FFFFFF;text-decoration:none;">Escríbenos por WhatsApp</a>
            </td>
          </tr>
        </table>
        <p style="margin:6px 0 0;font-size:12px;color:#8A8782;text-align:center;">${WHATSAPP_SOPORTE_VISIBLE} · o responde este correo</p>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: remitente(),
    replyTo: respuestasA(),
    to: params.destinatario,
    subject: `Falta un pago para que tu entrada sea tuya · compra ${codigo}`,
    html,
    headers: { "X-Entity-Ref-ID": `${params.grupoId}-${params.etiquetaCuota}-riesgo` },
  }, params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined);
  if (error) throw new Error(`Resend: ${error.name ?? "error"} — ${error.message}`);
}

// ---------------------------------------------------------------------------
// Abona618 — plantilla D: la compra se anuló por falta de pago.
//
// La manda la persona de Finanzas que aprieta el botón, no el cron. Cita la
// fecha y la hora en que el comprador aceptó las condiciones: es lo único que
// convierte "no se devuelve" en algo que se puede sostener en una discusión.
// ---------------------------------------------------------------------------
export async function enviarCorreoPlanAnulado(params: {
  destinatario: string;
  nombreComprador: string;
  grupoId: string;
  montoPendiente: number;
  abonado: number;
  /** "12 de octubre a las 3:42 p. m." */
  aceptoEn: string | null;
  /** falta_de_pago: se le pasó la fecha de una cuota (hay dinero abonado).
   *  inicial_no_llego: Finanzas no encontró el pago inicial en el banco; no
   *  hay nada abonado y el texto no puede hablar de dinero retenido.
   *  por_el_equipo: un admin anuló la compra a mano (compra duplicada,
   *  comprador que se arrepintió, prueba). Aquí NO se afirma que lo abonado
   *  no se devuelve: eso lo decide el equipo caso por caso y se le dice por
   *  WhatsApp. */
  motivo?: "falta_de_pago" | "inicial_no_llego" | "por_el_equipo";
}) {
  const resend = clienteResend("el correo de compra anulada");
  const codigo = codigoCompra(params.grupoId);
  const nombre = escapeHtml(params.nombreComprador);
  const motivo = params.motivo ?? "falta_de_pago";
  const apertura =
    motivo === "inicial_no_llego"
      ? `No pudimos confirmar en el banco tu pago inicial de <strong>${fmtUsd(params.montoPendiente)}</strong>, así que anulamos tu reserva y tu entrada volvió a estar disponible para otra persona.`
      : motivo === "por_el_equipo"
        ? `Tu compra en plan de pago quedó <strong>anulada</strong> y tu entrada volvió a estar disponible para otra persona.`
        : `No recibimos el pago pendiente de <strong>${fmtUsd(params.montoPendiente)}</strong> dentro de la fecha, así que anulamos tu reserva y tu entrada volvió a estar disponible para otra persona.`;
  const retenido =
    params.abonado > 0 && motivo === "por_el_equipo"
      ? `<p style="margin:0;font-size:13.5px;line-height:1.6;color:#5A5650;">Tienes <strong style="color:#303030;">${fmtUsd(params.abonado)}</strong> abonados en esta compra. El equipo se comunica contigo por WhatsApp para resolverlo.</p>`
      : params.abonado > 0
        ? `<p style="margin:0;font-size:13.5px;line-height:1.6;color:#5A5650;">Según las condiciones del plan de pago que aceptaste${
            params.aceptoEn ? ` el <strong style="color:#303030;">${escapeHtml(params.aceptoEn)}</strong>` : ""
          }, los <strong style="color:#303030;">${fmtUsd(params.abonado)}</strong> abonados no se devuelven.</p>`
        : `<p style="margin:0;font-size:13.5px;line-height:1.6;color:#5A5650;">No tenemos ningún pago tuyo registrado para esta compra.</p>`;

  const html = envolverCorreo(`
    <tr>
      <td style="padding:32px 28px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:14px;">
              <div style="display:inline-block;background-color:#F3F4F6;color:#374151;font-weight:700;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;border-radius:999px;padding:7px 16px;">Compra anulada</div>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#303030;">Hola <strong>${nombre}</strong>. ${apertura}</p>

        <div style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#303030;background:#F1ECE2;border-radius:8px;padding:12px 14px;">
          ${retenido}
          <div style="color:#8A8782;font-size:12.5px;margin-top:8px;">Código de compra: <strong style="color:#303030;letter-spacing:1px;">${codigo}</strong></div>
        </div>

        <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#303030;">Si crees que hubo un error, o ya habías pagado y no nos llegó la referencia, escríbenos hoy mismo por WhatsApp y lo revisamos.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 28px 30px;border-top:1px solid #F1ECE2;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px auto 0;">
          <tr>
            <td align="center" style="background-color:#25D366;border-radius:8px;">
              <a href="${urlWhatsAppSoporte(`Hola, me anularon la compra ${codigo} a nombre de ${params.nombreComprador} y quiero revisarlo: `)}" style="display:inline-block;padding:11px 20px;font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:13.5px;font-weight:700;color:#FFFFFF;text-decoration:none;">Escríbenos por WhatsApp</a>
            </td>
          </tr>
        </table>
        <p style="margin:6px 0 0;font-size:12px;color:#8A8782;text-align:center;">${WHATSAPP_SOPORTE_VISIBLE} · o responde este correo</p>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: remitente(),
    replyTo: respuestasA(),
    to: params.destinatario,
    subject: `Hemos anulado tu compra por falta de pago · ${codigo}`,
    html,
    headers: { "X-Entity-Ref-ID": `${params.grupoId}-anulado` },
  });
  if (error) throw new Error(`Resend: ${error.name ?? "error"} — ${error.message}`);
}

// ---------------------------------------------------------------------------
// Abona618 — resumen interno de la cobranza del día. NO va a compradores.
//
// Lo manda el cron solo cuando hay algo que decidir o algo que se rompió. Un
// correo diario que casi siempre dice "todo bien" se deja de abrir en tres
// días, y entonces tampoco se abre el que traía las tres anulaciones.
// ---------------------------------------------------------------------------
export async function enviarResumenCobranza(params: {
  /** "13 de octubre" */
  hoy: string;
  paraAnular: {
    compra: string;
    nombre: string;
    etiqueta: string;
    vencio: string;
    diasTarde: number;
    monto: number;
    abonado: number;
    grupoId: string;
  }[];
  avisosEnviados: number;
  fallos: { compra: string; etapa: string | null; error: string }[];
  saldoTotal: string;
  /** Cuando el cron no pudo ni leer la base: no hay números, hay una alarma. */
  fallaGeneral?: string | null;
}) {
  const resend = clienteResend("el resumen de cobranza");
  const destinatario = process.env.EMAIL_OPERACIONES || respuestasA();

  const filasAnular = params.paraAnular
    .map(
      (p) => `<tr>
        <td style="padding:8px 0;font-size:13.5px;color:#303030;border-top:1px solid #EDE9E1;">
          <strong>${escapeHtml(p.nombre)}</strong> · <span style="font-family:monospace;color:#8A8782;">${escapeHtml(p.compra)}</span><br>
          <span style="color:#8A8782;font-size:12.5px;">${escapeHtml(p.etiqueta)} venció el ${escapeHtml(p.vencio)} · ${p.diasTarde} ${p.diasTarde === 1 ? "día" : "días"} tarde · abonó ${fmtUsd(p.abonado)}</span>
        </td>
        <td align="right" style="padding:8px 0;font-size:13.5px;font-weight:700;color:#991B1B;border-top:1px solid #EDE9E1;white-space:nowrap;">${fmtUsd(p.monto)}</td>
      </tr>`
    )
    .join("");

  const filasFallos = params.fallos
    .map(
      (f) => `<tr><td colspan="2" style="padding:6px 0;font-size:12.5px;color:#7C2D12;border-top:1px solid #EDE9E1;">
        <strong>${escapeHtml(f.compra)}</strong> · no salió el aviso ${escapeHtml(f.etapa ?? "")}: ${escapeHtml(f.error)}
      </td></tr>`
    )
    .join("");

  const html = envolverCorreo(`
    <tr>
      <td style="padding:32px 28px 12px;">
        ${
          params.fallaGeneral
            ? `<div style="margin:0 0 14px;background:#FEE2E2;border-radius:8px;padding:12px 14px;">
                 <p style="margin:0;font-size:14px;font-weight:700;color:#991B1B;">Los avisos de hoy NO salieron</p>
                 <p style="margin:4px 0 0;font-size:12.5px;line-height:1.5;color:#7C2D12;">${escapeHtml(params.fallaGeneral)} Los recordatorios de hoy no se recuperan solos: revisa Cobranza y escribe a mano a quien le tocaba.</p>
               </div>`
            : `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#303030;">Cobranza del <strong>${escapeHtml(params.hoy)}</strong>. Se mandaron <strong>${params.avisosEnviados}</strong> ${params.avisosEnviados === 1 ? "aviso" : "avisos"} y quedan <strong>${escapeHtml(params.saldoTotal)}</strong> por cobrar.</p>`
        }

        ${
          params.paraAnular.length > 0
            ? `<div style="margin:0 0 14px;background:#FEF2F2;border-radius:8px;padding:12px 14px;">
                 <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#991B1B;">Hay que decidir: ${params.paraAnular.length} ${params.paraAnular.length === 1 ? "compra" : "compras"} sin pagar</p>
                 <p style="margin:0 0 8px;font-size:12.5px;line-height:1.5;color:#7C2D12;">El sistema NO las anula solo. Entra a Cobranza, confirma por WhatsApp si pagaron, y anula las que correspondan.</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filasAnular}</table>
               </div>`
            : ""
        }

        ${
          params.fallos.length > 0
            ? `<div style="margin:0 0 14px;background:#FFF6E5;border-radius:8px;padding:12px 14px;">
                 <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#7C2D12;">Avisos que no salieron</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filasFallos}</table>
               </div>`
            : ""
        }
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 30px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td align="center" style="background-color:#3F0A62;border-radius:8px;">
              <a href="${URL_EQUIPO}/cobranza" style="display:inline-block;padding:12px 22px;font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">Abrir Cobranza</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: remitente(),
    replyTo: respuestasA(),
    to: destinatario,
    subject: params.fallaGeneral
      ? `Cobranza ${params.hoy}: los avisos NO salieron`
      : params.paraAnular.length > 0
        ? `Cobranza ${params.hoy}: ${params.paraAnular.length} ${params.paraAnular.length === 1 ? "compra" : "compras"} por anular`
        : `Cobranza ${params.hoy}: ${params.fallos.length} ${params.fallos.length === 1 ? "aviso" : "avisos"} no salieron`,
    html,
  });
  if (error) throw new Error(`Resend: ${error.name ?? "error"} — ${error.message}`);
}
