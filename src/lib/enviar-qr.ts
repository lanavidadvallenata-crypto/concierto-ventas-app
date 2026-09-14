import { Resend } from "resend";
import QRCode from "qrcode";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://lanavidadvallenata.com";

export async function enviarCorreoPendiente(params: {
  destinatario: string;
  nombreComprador: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Falta RESEND_API_KEY — no se puede enviar el correo de bienvenida");
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #221D16;">
      <h1 style="font-size: 22px; margin-bottom: 4px;">¡Bienvenido a La Navidad Vallenata! 🎄</h1>
      <p style="color: #6E6455; margin-top: 0;">4 de diciembre de 2026 · Hangar Grano de Oro, Maracaibo</p>
      <p>Hola ${params.nombreComprador}, recibimos tu compra y ya estamos verificando tu pago.</p>
      <p>En cuanto se confirme, te llegará un correo a esta misma dirección con tu <strong>entrada y código QR de acceso</strong>. Normalmente toma poco tiempo — no necesitas hacer nada más por ahora.</p>
      <p style="font-size: 13px; color: #6E6455; margin-top: 24px;">Si tienes alguna duda sobre tu compra, responde este correo o escribe por el mismo medio donde hiciste la compra.</p>
    </div>
  `;

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

  const urlAcceso = `${SITE_URL}/acceso/${params.qrToken}`;
  const qrDataUrl = await QRCode.toDataURL(urlAcceso, { width: 480, margin: 2 });
  const qrBase64 = qrDataUrl.split(",")[1];

  const detalleAsiento =
    params.tipo === "vip"
      ? `Mesa ${params.mesaNumero} · Silla ${params.sillaNumero}`
      : "Entrada General";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #221D16;">
      <h1 style="font-size: 22px; margin-bottom: 4px;">La Navidad Vallenata</h1>
      <p style="color: #6E6455; margin-top: 0;">4 de diciembre de 2026 · Hangar Grano de Oro, Maracaibo</p>
      <p>Hola ${params.nombreComprador}, esta es tu entrada. Preséntala en la puerta el día del evento — el personal de acceso la va a escanear con la cámara de su teléfono.</p>
      <p style="font-weight: bold; font-size: 18px; margin-bottom: 4px;">${detalleAsiento}</p>
      <div style="text-align: center; margin: 24px 0;">
        <img src="cid:qr-entrada" alt="Código QR de entrada" width="240" height="240" />
      </div>
      <div style="background: #F7F4EC; border-radius: 8px; padding: 16px; margin-top: 16px;">
        <p style="font-size: 13px; color: #221D16; margin: 0 0 8px 0; font-weight: bold;">Importante — uso y seguridad de tu QR</p>
        <p style="font-size: 13px; color: #6E6455; margin: 0 0 6px 0;">• Este código es único y personal. Si lo compartes con alguien más, solo la primera persona que lo presente en la puerta podrá ingresar.</p>
        <p style="font-size: 13px; color: #6E6455; margin: 0;">• Una vez usado en la entrada, el código queda desactivado y no sirve para ingresos posteriores ni para volver a entrar.</p>
      </div>
    </div>
  `;

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
