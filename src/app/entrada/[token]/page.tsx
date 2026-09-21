import type { Metadata } from "next";
import QRCode from "qrcode";
import { createServiceClient } from "@/lib/supabase/server";
import { obtenerAsiento, describirAsiento } from "@/lib/asiento";
import { URL_EQUIPO } from "@/lib/dominios";
import { WHATSAPP_SOPORTE_VISIBLE } from "@/lib/contacto";
import { codigoEntrada } from "@/lib/qr";

// Página pública de UNA entrada: el mismo QR que va en el correo, abierto
// desde un enlace que el comprador puede mandar por WhatsApp a cada invitado.
//
// Por qué existe (Anita, 21 sep): el proceso de compras múltiples no puede
// depender de que el cliente de correo muestre las imágenes ni de reenviar
// correos. Cada entrada tiene su enlace; el invitado lo abre en su teléfono
// y muestra el QR en la puerta.
//
// Seguridad: el enlace lleva el mismo token secreto (32 caracteres al azar)
// que ya va dentro del QR — quien tiene el enlace tiene el QR, ni más ni
// menos. Solo lectura: aquí no se marca nada; el ingreso lo registra el
// personal de acceso en equipo.*/acceso/[token] con su sesión.
// No se muestran teléfono ni correo del comprador.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu entrada — La Navidad Vallenata",
  robots: { index: false, follow: false },
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://lanavidadvallenata.com";

function tokenValido(token: string) {
  return /^[A-Za-z0-9_-]{16,128}$/.test(token);
}

export default async function EntradaPublicaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!tokenValido(token)) return <Aviso titulo="Enlace no válido" detalle="Este enlace no corresponde a ninguna entrada. Revisa que lo hayas copiado completo." />;

  const service = createServiceClient();
  const { data: ticket, error } = await service
    .from("tickets")
    .select("comprador_nombre, tipo, silla_id, estado_pago, qr_usado, qr_usado_en")
    .eq("qr_token", token)
    .maybeSingle();

  if (error) {
    console.error("Error leyendo entrada pública:", error.message);
    return <Aviso titulo="No pudimos cargar tu entrada" detalle="Es un problema momentáneo de conexión. Intenta de nuevo en unos segundos." />;
  }
  if (!ticket) return <Aviso titulo="Entrada no encontrada" detalle="Este enlace no corresponde a ninguna entrada. Si lo recibiste de quien compró, pídele que te lo reenvíe completo." />;
  if (ticket.estado_pago !== "verificado") {
    return <Aviso titulo="Entrada no válida" detalle={`Esta entrada no tiene el pago confirmado (estado: ${ticket.estado_pago}). Escríbenos por WhatsApp al ${WHATSAPP_SOPORTE_VISIBLE}.`} />;
  }

  const tipo = ticket.tipo as "vip" | "general";
  const asiento = tipo === "vip" ? await obtenerAsiento(service, ticket.silla_id) : null;
  const descripcionAsiento = tipo === "vip" ? describirAsiento(tipo, asiento) : "Acceso general · sin asiento asignado";

  const urlAcceso = `${URL_EQUIPO}/acceso/${token}`;
  const qrDataUrl = await QRCode.toDataURL(urlAcceso, { width: 640, margin: 2 });

  const urlEntrada = `${SITE_URL}/entrada/${token}`;
  const textoWhatsApp = `Tu entrada para La Navidad Vallenata (vie 4 dic · Hangar Grano de Oro, Maracaibo):\n${urlEntrada}\nÁbrela en tu teléfono y muestra el QR en la puerta. Es personal: solo entra una vez.`;
  const urlCompartir = `https://wa.me/?text=${encodeURIComponent(textoWhatsApp)}`;

  const usada = Boolean(ticket.qr_usado);
  const horaUso = ticket.qr_usado_en
    ? new Date(ticket.qr_usado_en as string).toLocaleString("es-VE", { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })
    : null;

  return (
    <main className="min-h-screen bg-[#F1ECE2] px-4 py-8 flex items-start justify-center">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="bg-[#3D0507] text-white px-6 pt-6 pb-5">
          <p className="text-[11px] uppercase tracking-[0.15em] text-[#E8C9C9]">La Navidad Vallenata · 4 dic 2026</p>
          <h1 className="text-2xl font-bold mt-1 leading-tight">{tipo === "vip" ? "Entrada VIP" : "Entrada General"}</h1>
          <p className="text-sm text-[#E8C9C9] mt-1">{descripcionAsiento}</p>
        </div>

        <div className="px-6 pt-5 pb-2 flex flex-col items-center gap-3">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              width={260}
              height={260}
              alt="Código QR de acceso"
              className={`w-[260px] h-[260px] rounded-lg border border-[#F1ECE2] ${usada ? "opacity-25" : ""}`}
            />
            {usada ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="bg-red-600 text-white font-bold text-lg px-4 py-2 rounded-lg rotate-[-8deg] shadow">YA USADA</span>
              </div>
            ) : null}
          </div>

          {usada ? (
            <p className="text-sm text-red-700 text-center">
              Esta entrada ya ingresó{horaUso ? ` el ${horaUso}` : ""}. No sirve para volver a entrar.
            </p>
          ) : (
            <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-center">
              Válida · sin usar. Muestra este QR en la puerta.
            </p>
          )}

          {codigoEntrada(token) ? (
            <p className="text-xs text-neutral-500 text-center">
              Si el QR no escanea, di este código en la puerta:
              <span className="block font-mono text-lg font-bold tracking-[0.15em] text-neutral-800 mt-0.5">{codigoEntrada(token)}</span>
            </p>
          ) : null}
          <p className="text-xs text-neutral-500 text-center">A nombre de <strong className="text-neutral-700">{ticket.comprador_nombre}</strong></p>
        </div>

        {!usada ? (
          <div className="px-6 pb-6 pt-3 flex flex-col gap-2">
            <a
              href={urlCompartir}
              className="w-full min-h-12 flex items-center justify-center rounded-xl bg-[#25D366] text-white font-semibold text-sm"
            >
              Enviar esta entrada por WhatsApp
            </a>
            <a
              href={qrDataUrl}
              download={`entrada-${tipo}-navidad-vallenata.png`}
              className="w-full min-h-12 flex items-center justify-center rounded-xl border border-neutral-300 text-neutral-800 font-semibold text-sm"
            >
              Guardar el QR en el teléfono
            </a>
            <p className="text-[11px] text-neutral-500 text-center mt-1 leading-relaxed">
              Cada entrada es personal y entra una sola vez. Si la compartes, solo la primera persona que la presente podrá ingresar.
            </p>
          </div>
        ) : (
          <div className="px-6 pb-6" />
        )}

        <div className="bg-[#F1ECE2] px-6 py-3 text-center">
          <span className="text-[11px] text-[#898477]">Un evento de 6.18 Producciones · Soporte {WHATSAPP_SOPORTE_VISIBLE}</span>
        </div>
      </div>
    </main>
  );
}

function Aviso({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <main className="min-h-screen bg-[#F1ECE2] px-4 py-8 flex items-start justify-center">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-6 flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.15em] text-[#898477]">La Navidad Vallenata</p>
        <h1 className="text-xl font-bold text-[#3D0507]">{titulo}</h1>
        <p className="text-sm text-neutral-600 leading-relaxed">{detalle}</p>
      </div>
    </main>
  );
}
