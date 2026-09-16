import { calcularTotal } from "@/lib/precios";
import {
  DESCRIPCION_EVENTO,
  LINEUP,
  CONTACTO_WHATSAPP_TEXTO,
  CONTACTO_WHATSAPP_URL,
  FLYER_URL,
} from "@/lib/evento-copy";

export function HeroEvento({
  nombre,
  fecha,
  venue,
  ciudad,
}: {
  nombre: string;
  fecha: string | null;
  venue: string;
  ciudad: string;
}) {
  const fechaFormateada = fecha
    ? new Date(fecha).toLocaleDateString("es-VE", { day: "numeric", month: "long", year: "numeric" })
    : null;

  if (FLYER_URL) {
    // Afiche real del evento (branding_4.pdf): ya trae título, fecha y line-up
    // como arte final. No se le superpone texto — el afiche es la pieza, y los
    // datos operativos (venue/fecha/CTA) van debajo, en bloque aparte.
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl overflow-hidden border border-neutral-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={FLYER_URL} alt={nombre} className="w-full h-auto block" />
        </div>
        <div className="flex flex-col items-center text-center gap-2 bg-evento-principal text-white rounded-2xl px-6 py-5">
          <a href="/" aria-label="6.18 Producciones">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-618-white.png" alt="6.18 Producciones" className="h-5 w-auto opacity-80" />
          </a>
          {fechaFormateada && <p className="text-sm text-marca-acento/90">{fechaFormateada}</p>}
          <p className="text-sm text-marca-acento/90">
            {venue} · {ciudad}
          </p>
          <a
            href="#comprar"
            className="mt-2 bg-evento-acento text-white rounded-md px-6 py-2.5 text-sm font-semibold"
          >
            Comprar entradas
          </a>
        </div>
      </div>
    );
  }

  // Fallback sin afiche (evento futuro sin arte todavía): mismo tratamiento
  // de marca del evento, pero con título tipográfico en vez de imagen.
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-evento-secundario to-evento-principal text-white px-6 py-10 flex flex-col items-center text-center gap-3 min-h-[16rem] justify-center">
      <a href="/" aria-label="6.18 Producciones">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-618-white.png" alt="6.18 Producciones" className="h-6 w-auto opacity-90" />
      </a>
      <div className="flex flex-col items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-marca-acento/80">Venta oficial de entradas</span>
        <h1 className="font-display text-4xl sm:text-5xl uppercase leading-[0.95] tracking-wide">{nombre}</h1>
        {fechaFormateada && <p className="text-sm text-marca-acento/90">{fechaFormateada}</p>}
        <p className="text-sm text-marca-acento/90">
          {venue} · {ciudad}
        </p>
        <a href="#comprar" className="mt-2 bg-evento-acento text-white rounded-md px-5 py-2 text-sm font-semibold">
          Comprar entradas
        </a>
      </div>
    </div>
  );
}

export function SobreElEvento() {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Sobre el evento</h2>
      <p className="text-sm text-neutral-700 leading-relaxed">{DESCRIPCION_EVENTO}</p>
      {LINEUP.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {LINEUP.map((artista) => (
            <span
              key={artista}
              className="bg-neutral-100 border border-neutral-200 rounded-full px-3 py-1 text-xs font-medium"
            >
              {artista}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function PreciosExplicados() {
  const vip = calcularTotal("vip");
  const general = calcularTotal("general");
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="border border-neutral-200 rounded-xl p-4 flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-evento-secundario">VIP</p>
        <p className="text-xl font-bold">${vip.base}</p>
        <p className="text-[11px] text-neutral-400">+ fee de servicio (se calcula al pagar)</p>
        <p className="text-xs text-neutral-500 mt-1">Silla numerada en mesa, zona preferencial frente a la tarima.</p>
      </div>
      <div className="border border-neutral-200 rounded-xl p-4 flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">General</p>
        <p className="text-xl font-bold">${general.base}</p>
        <p className="text-[11px] text-neutral-400">+ fee de servicio (se calcula al pagar)</p>
        <p className="text-xs text-neutral-500 mt-1">Acceso a zona general, sin asiento asignado.</p>
      </div>
    </div>
  );
}

export function ComoComprar() {
  const pasos = [
    { titulo: "Elige tu entrada", texto: "Selecciona VIP (con mapa de sillas) o General.", icono: "🎟️" },
    { titulo: "Paga en 10 minutos", texto: "Tu selección queda reservada mientras completas el pago.", icono: "⏱️" },
    { titulo: "Recibe tu entrada", texto: "Te llega un correo con tu QR de acceso al confirmarse el pago.", icono: "📩" },
  ];
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 text-center">Cómo comprar</h2>
      <div className="relative flex flex-col sm:flex-row sm:justify-center gap-6 sm:gap-4">
        <div
          aria-hidden="true"
          className="hidden sm:block absolute top-7 left-[16.6%] right-[16.6%] h-0.5 bg-evento-secundario/20"
        />
        {pasos.map((p, i) => (
          <div key={p.titulo} className="relative flex flex-col items-center text-center gap-1.5 sm:flex-1 sm:max-w-[13rem] sm:mx-auto">
            <div className="relative z-10 w-14 h-14 rounded-full bg-evento-secundario/10 border-2 border-evento-secundario flex items-center justify-center text-2xl">
              {p.icono}
            </div>
            <span className="text-[11px] font-bold text-evento-secundario tracking-wide">PASO {i + 1}</span>
            <p className="text-sm font-semibold">{p.titulo}</p>
            <p className="text-xs text-neutral-500 max-w-[14rem]">{p.texto}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PreguntasFrecuentes() {
  const preguntas = [
    { q: "¿Necesito crear una cuenta?", a: "No. Compras como invitado con tu nombre, teléfono y correo." },
    { q: "¿Puedo pagar en bolívares?", a: "Sí — el monto se calcula automáticamente a la tasa del día." },
    {
      q: "¿Qué pasa si no completo el pago a tiempo?",
      a: "Tu selección se libera después de 10 minutos y vuelve a estar disponible para otra persona.",
    },
    { q: "¿Cómo recibo mi entrada?", a: "Por correo, con un código QR que se valida en la entrada del evento." },
  ];
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Preguntas frecuentes</h2>
      <div className="flex flex-col gap-2">
        {preguntas.map((p) => (
          <div key={p.q} className="border border-neutral-200 rounded-lg p-3">
            <p className="text-sm font-semibold">{p.q}</p>
            <p className="text-xs text-neutral-500 mt-1">{p.a}</p>
          </div>
        ))}
      </div>
      {CONTACTO_WHATSAPP_URL && (
        <a href={CONTACTO_WHATSAPP_URL} className="text-sm font-medium text-green-700 mt-1">
          {CONTACTO_WHATSAPP_TEXTO} →
        </a>
      )}
    </div>
  );
}
