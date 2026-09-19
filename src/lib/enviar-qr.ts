import { Resend } from "resend";
import QRCode from "qrcode";
import { URL_EQUIPO } from "@/lib/dominios";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://lanavidadvallenata.com";
const LOGO_URL = `${SITE_URL}/logo-618-white.png`;

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
function bannerEvento() {
  return `
    <tr>
      <td style="background-color:#3D0507;padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="height:3px;background-color:#CE0100;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td align="center" style="padding:20px 24px;">
              <div style="font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:24px;line-height:1.15;letter-spacing:1px;color:#F1ECE2;text-transform:uppercase;">La Navidad Vallenata</div>
              <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:13px;color:#D9BDB9;margin-top:6px;">4 de diciembre de 2026 · Hangar Grano de Oro, Maracaibo</div>
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

export async function enviarCorreoPendiente(params: {
  destinatario: string;
  nombreComprador: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Falta RESEND_API_KEY — no se puede enviar el correo de bienvenida");
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const nombre = escapeHtml(params.nombreComprador);

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
        <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#303030;">En cuanto se confirme, te llegará un correo a esta misma dirección con tu <strong>entrada y código QR de acceso</strong>. Normalmente toma poco tiempo — no necesitas hacer nada más por ahora.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:4px 28px 32px;">
        <p style="margin:0;font-size:12.5px;line-height:1.6;color:#8A8782;border-top:1px solid #F1ECE2;padding-top:16px;">¿Alguna duda sobre tu compra? Responde este correo o escríbenos por el mismo medio donde compraste.</p>
      </td>
    </tr>
  `);

  await resend.emails.send({
    from: `La Navidad Vallenata <${process.env.RESEND_FROM_EMAIL || "no-responder@lanavidadvallenata.com"}>`,
    to: params.destinatario,
    subject: "Recibimos tu compra — La Navidad Vallenata",
    html,
  });
}

export async function enviarCorreoQR(params: {
  destinatario: string;
  nombreComprador: string;
  tipo: "vip" | "general";
  mesaNumero?: number | null;
  sillaNumero?: number | null;
  qrToken: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Falta RESEND_API_KEY — no se puede enviar el correo con el QR");
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const nombre = escapeHtml(params.nombreComprador);

  // El QR apunta al host del EQUIPO (no al público): es donde el personal de
  // acceso tiene su sesión iniciada. Si apuntara al dominio público, el
  // teléfono de la puerta caería en el login en cada escaneo (la sesión es
  // por host). Ver src/lib/dominios.ts.
  const urlAcceso = `${URL_EQUIPO}/acceso/${params.qrToken}`;
  const qrDataUrl = await QRCode.toDataURL(urlAcceso, { width: 480, margin: 2 });
  const qrBase64 = qrDataUrl.split(",")[1];

  const detalleAsiento =
    params.tipo === "vip" ? `Mesa ${params.mesaNumero} · Silla ${params.sillaNumero}` : "Entrada General";
  const etiquetaTipo = params.tipo === "vip" ? "Entrada VIP" : "Entrada General";

  const html = envolverCorreo(`
    <tr>
      <td style="padding:28px 28px 8px;">
        <p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#303030;">Hola <strong>${nombre}</strong>, esta es tu entrada. Preséntala en la puerta el día del evento — el personal de acceso la va a escanear con la cámara de su teléfono.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 28px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1ECE2;border-radius:10px;">
          <tr>
            <td align="center" style="padding:16px 20px;">
              <div style="font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:20px;letter-spacing:0.5px;color:#3D0507;">${detalleAsiento}</div>
              <div style="font-family:'Poppins',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#680F15;margin-top:4px;">${etiquetaTipo}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:20px 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid #F1ECE2;border-radius:10px;">
          <tr>
            <td style="padding:16px;">
              <img src="cid:qr-entrada" width="220" height="220" alt="Código QR de entrada" style="display:block;width:220px;height:220px;border:0;">
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 28px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF4F1;border-left:3px solid #CE0100;border-radius:6px;">
          <tr>
            <td style="padding:14px 16px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#3D0507;">Importante — uso y seguridad de tu QR</p>
              <p style="margin:0 0 6px;font-size:12.5px;line-height:1.5;color:#680F15;">Este código es único y personal. Si lo compartes con alguien más, solo la primera persona que lo presente en la puerta podrá ingresar.</p>
              <p style="margin:0;font-size:12.5px;line-height:1.5;color:#680F15;">Una vez usado en la entrada, el código queda desactivado y no sirve para ingresos posteriores ni para volver a entrar.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `);

  await resend.emails.send({
    from: `La Navidad Vallenata <${process.env.RESEND_FROM_EMAIL || "no-responder@lanavidadvallenata.com"}>`,
    to: params.destinatario,
    subject: "Tu entrada — La Navidad Vallenata",
    html,
    attachments: [
      {
        filename: "entrada-qr.png",
        content: qrBase64,
        contentId: "qr-entrada",
      },
    ],
  });
}
