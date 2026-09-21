import { Resend } from "resend";
import QRCode from "qrcode";
import { URL_EQUIPO } from "@/lib/dominios";
import { urlWhatsAppSoporte, WHATSAPP_SOPORTE_VISIBLE } from "@/lib/contacto";
import { codigoCompra } from "@/lib/compra";
import { codigoEntrada } from "@/lib/qr";

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

export async function enviarCorreoPendiente(params: {
  destinatario: string;
  nombreComprador: string;
  cantidad?: number;
  tipo?: "vip" | "general";
  totalUsd?: number;
  totalBs?: number | null;
  referencia?: string | null;
  // grupo_id de la compra: asunto único + cabecera anti-agrupación (ver codigoCompra).
  grupoId?: string;
}) {
  const resend = clienteResend("el correo de bienvenida");
  const codigo = params.grupoId ? codigoCompra(params.grupoId) : null;
  const nombre = escapeHtml(params.nombreComprador);
  const cantidad = params.cantidad ?? 1;
  const detalle =
    params.tipo && params.totalUsd != null
      ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#303030;background:#F1ECE2;border-radius:8px;padding:12px 14px;">
          <strong>${cantidad} entrada${cantidad === 1 ? "" : "s"} ${params.tipo === "vip" ? "VIP" : "General"}</strong> · ${fmtUsd(params.totalUsd)}${
          params.totalBs != null ? ` · ${fmtBs(params.totalBs)}` : ""
        }${params.referencia ? `<br><span style="color:#8A8782;font-size:12.5px;">Referencia de pago: ${escapeHtml(params.referencia)}</span>` : ""}
        </p>`
      : "";

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
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#303030;">Hola <strong>${nombre}</strong>, recibimos tu compra y ya estamos verificando tu pago.</p>
        ${detalle}
        <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#303030;">En cuanto se confirme, te llegará un correo a esta misma dirección con ${
          cantidad > 1 ? "tus <strong>entradas y códigos QR</strong> de acceso (uno por persona)" : "tu <strong>entrada y código QR</strong> de acceso"
        }. Normalmente toma poco tiempo — no necesitas hacer nada más por ahora.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:4px 28px 32px;">
        <p style="margin:0;font-size:12.5px;line-height:1.6;color:#8A8782;border-top:1px solid #F1ECE2;padding-top:16px;">¿Alguna duda sobre tu compra? Escríbenos por WhatsApp al ${WHATSAPP_SOPORTE_VISIBLE}.</p>
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
  tipo: "vip" | "general";
  fila?: string | null;
  mesaNumero?: number | null;
  sillaNumero?: number | null;
};

function describirEntrada(e: EntradaQR) {
  if (e.tipo !== "vip") return "Entrada General";
  if (e.mesaNumero != null && e.sillaNumero != null) {
    return `${e.fila ? `Fila ${e.fila} · ` : ""}Mesa ${e.mesaNumero} · Silla ${e.sillaNumero}`;
  }
  return "Entrada VIP — tu mesa y silla te las confirma el equipo en la puerta";
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

    const etiquetaTipo = e.tipo === "vip" ? "Entrada VIP" : "Acceso general · sin asiento asignado";
    bloques.push(`
    <tr>
      <td style="padding:${i === 0 ? 16 : 8}px 28px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1ECE2;border-radius:10px;">
          <tr>
            <td align="center" style="padding:16px 20px;">
              ${entradas.length > 1 ? `<div style="font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8A8782;margin-bottom:4px;">Entrada ${i + 1} de ${entradas.length}</div>` : ""}
              <div style="font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:20px;letter-spacing:0.5px;color:#3D0507;">${describirEntrada(e)}</div>
              <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#680F15;margin-top:4px;">${etiquetaTipo}</div>
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
export async function enviarCorreoRechazo(params: {
  destinatario: string;
  nombreComprador: string;
  cantidad: number;
  tipo: "vip" | "general";
  totalUsd: number;
  totalBs: number | null;
  referencia: string | null;
  metodoEtiqueta: string;
  grupoId?: string;
}) {
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
          <strong>${params.cantidad} entrada${params.cantidad === 1 ? "" : "s"} ${params.tipo === "vip" ? "VIP" : "General"}</strong><br>
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
          params.tipo === "vip"
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
