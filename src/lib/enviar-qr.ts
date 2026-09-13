import { Resend } from "resend";
import QRCode from "qrcode";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://lanavidadvallenata.com";

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
      <p style="font-size: 13px; color: #6E6455;">Este código es único y personal — no lo compartas. Solo es válido para un ingreso.</p>
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
