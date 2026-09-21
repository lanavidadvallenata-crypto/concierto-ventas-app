import type { Metadata } from "next";
import QRCode from "qrcode";
import { createServiceClient } from "@/lib/supabase/server";
import { obtenerAsiento, describirAsiento } from "@/lib/asiento";
import { URL_EQUIPO } from "@/lib/dominios";
import { WHATSAPP_SOPORTE_VISIBLE } from "@/lib/contacto";
import { codigoCompra } from "@/lib/compra";

// "Mis entradas": todas las entradas de UNA compra, con un botón de WhatsApp
// por entrada para mandarle a cada invitado la suya (enlace /entrada/<token>).
//
// Por qué una página por compra y no un botón por entrada en el correo
// (21 sep): Gmail mandó a "Promociones" el correo de QR que traía un botón +
// un enlace por cada entrada. Muchos enlaces = señal de correo masivo. Con UN
// solo botón en el correo, el resto vive aquí.
//
// El grupo_id es un UUID aleatorio (crypto), no se puede adivinar: sirve de
// llave igual que el token del QR. Solo lectura, no marca nada.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mis entradas — La Navidad Vallenata",
  robots: { index: false, follow: false },
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://lanavidadvallenata.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TicketFila = {
  id: string;
  tipo: "vip" | "general";
  silla_id: string | null;
  comprador_nombre: string;
  estado_pago: string;
  qr_token: string | null;
  qr_usado: boolean;
  created_at: string;
};

export default async function MisEntradasPage({ params }: { params: Promise<{ grupo: string }> }) {
  const { grupo } = await params;
  if (!UUID.test(grupo)) return <Aviso titulo="Enlace no válido" detalle="Este enlace no corresponde a ninguna compra. Revisa que lo hayas copiado completo." />;

  const service = createServiceClient();
  const { data, error } = await service
    .from("tickets")
    .select("id, tipo, silla_id, comprador_nombre, estado_pago, qr_token, qr_usado, created_at")
    .eq("grupo_id", grupo)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error leyendo compra pública:", error.message);
    return <Aviso titulo="No pudimos cargar tus entradas" detalle="Es un problema momentáneo de conexión. Intenta de nuevo en unos segundos." />;
  }
  const tickets = (data ?? []) as TicketFila[];
  if (tickets.length === 0) return <Aviso titulo="Compra no encontrada" detalle="Este enlace no corresponde a ninguna compra." />;

  const codigo = codigoCompra(grupo);
  const nombre = tickets[0].comprador_nombre;
  const verificadas = tickets.filter((t) => t.estado_pago === "verificado" && t.qr_token);
  const pendientes = tickets.filter((t) => t.estado_pago === "pendiente");
  const rechazadas = tickets.filter((t) => t.estado_pago === "rechazado");

  const filas = await Promise.all(
    verificadas.map(async (t, i) => {
      const asiento = t.tipo === "vip" ? await obtenerAsiento(service, t.silla_id) : null;
      const urlEntrada = `${SITE_URL}/entrada/${t.qr_token}`;
      const qr = await QRCode.toDataURL(`${URL_EQUIPO}/acceso/${t.qr_token}`, { width: 320, margin: 1 });
      const texto = `Tu entrada para La Navidad Vallenata (vie 4 dic · Hangar Grano de Oro, Maracaibo):\n${urlEntrada}\nÁbrela en tu teléfono y muestra el QR en la puerta. Es personal: solo entra una vez.`;
      return {
        n: i + 1,
        tipo: t.tipo,
        detalle: t.tipo === "vip" ? describirAsiento("vip", asiento) : "Acceso general · sin asiento asignado",
        usada: t.qr_usado,
        urlEntrada,
        urlWhatsApp: `https://wa.me/?text=${encodeURIComponent(texto)}`,
        qr,
      };
    })
  );

  return (
    <main className="min-h-screen bg-[#F1ECE2] px-4 py-8 flex items-start justify-center">
      <div className="w-full max-w-md flex flex-col gap-4">
        <div className="bg-[#3D0507] text-white rounded-2xl px-6 py-5">
          <p className="text-[11px] uppercase tracking-[0.15em] text-[#E8C9C9]">La Navidad Vallenata · 4 dic 2026</p>
          <h1 className="text-2xl font-bold mt-1 leading-tight">Mis entradas</h1>
          <p className="text-sm text-[#E8C9C9] mt-1">
            Compra {codigo} · a nombre de {nombre} · {verificadas.length} {verificadas.length === 1 ? "entrada" : "entradas"}
          </p>
        </div>

        {pendientes.length > 0 ? (
          <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3">
            {pendientes.length} {pendientes.length === 1 ? "entrada está" : "entradas están"} en verificación de pago. Cuando se confirme, aparecerán aquí y te llegará el correo con los QR.
          </p>
        ) : null}
        {rechazadas.length > 0 && verificadas.length === 0 ? (
          <p className="text-sm bg-red-50 border border-red-200 text-red-900 rounded-xl px-4 py-3">
            El pago de esta compra no pudo confirmarse. Escríbenos por WhatsApp al {WHATSAPP_SOPORTE_VISIBLE} con tu comprobante.
          </p>
        ) : null}

        {filas.length > 0 ? (
          <p className="text-sm text-neutral-700 px-1">
            Cada entrada es de una persona. Mándale a cada invitado la suya con el botón de WhatsApp: le llega un enlace que abre su QR en su teléfono.
          </p>
        ) : null}

        {filas.map((f) => (
          <div key={f.n} className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-4 p-4">
              <div className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.qr} width={96} height={96} alt={`QR entrada ${f.n}`} className={`w-24 h-24 rounded-md border border-[#F1ECE2] ${f.usada ? "opacity-25" : ""}`} />
                {f.usada ? <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-red-700 rotate-[-12deg]">YA USADA</span> : null}
              </div>
              <div className="min-w-0 flex flex-col gap-0.5">
                <p className="text-[11px] uppercase tracking-[0.12em] text-[#898477]">Entrada {f.n} de {filas.length}</p>
                <p className="font-bold text-[#3D0507] leading-tight">{f.tipo === "vip" ? "Entrada VIP" : "Entrada General"}</p>
                <p className="text-sm text-neutral-600 leading-snug">{f.detalle}</p>
                <p className={`text-xs mt-1 ${f.usada ? "text-red-700" : "text-green-800"}`}>{f.usada ? "Ya ingresó" : "Válida · sin usar"}</p>
              </div>
            </div>
            {!f.usada ? (
              <div className="grid grid-cols-2 gap-2 px-4 pb-4">
                <a href={f.urlWhatsApp} className="min-h-11 flex items-center justify-center rounded-xl bg-[#25D366] text-white font-semibold text-sm">
                  Enviar por WhatsApp
                </a>
                <a href={f.urlEntrada} className="min-h-11 flex items-center justify-center rounded-xl border border-neutral-300 text-neutral-800 font-semibold text-sm">
                  Ver QR grande
                </a>
              </div>
            ) : null}
          </div>
        ))}

        <p className="text-[11px] text-[#898477] text-center px-4">
          Cada entrada entra una sola vez. Si compartes una con dos personas, solo pasa la primera que la presente. Soporte {WHATSAPP_SOPORTE_VISIBLE}.
        </p>
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
