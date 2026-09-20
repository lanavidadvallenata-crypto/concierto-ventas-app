import Link from "next/link";
import { calcularTotal } from "@/lib/precios";
import { SOBRE_PRODUCTORA, CONTACTO_WHATSAPP_URL, INSTAGRAM_URL, FLYER_HORIZONTAL_URL } from "@/lib/evento-copy";

type Evento = { nombre: string; fecha: string | null; venue: string; ciudad: string } | null;

export function ProductoraHome({ evento, desdePreventa }: { evento: Evento; desdePreventa?: number | null }) {
  const fechaFormateada = evento?.fecha
    ? new Date(evento.fecha).toLocaleDateString("es-VE", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const regular = calcularTotal("general").base;
  const desde = evento ? (desdePreventa ?? regular) : null;
  const enPreventa = evento && desdePreventa != null && desdePreventa < regular;

  return (
    <main className="min-h-screen flex flex-col bg-marca-acento">
      {/* Barra superior fija — presencia de marca constante, como en una plataforma de ticketing real */}
      <nav className="sticky top-0 z-20 bg-marca-principal/95 backdrop-blur-sm px-5 py-3 flex items-center justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-618-white.png" alt="6.18 Producciones" className="h-6 w-auto" />
        <div className="flex items-center gap-4">
          {INSTAGRAM_URL && (
            <a href={INSTAGRAM_URL} aria-label="Instagram de 6.18 Producciones" className="text-marca-acento/80 hover:text-marca-acento">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
              </svg>
            </a>
          )}
          {CONTACTO_WHATSAPP_URL && (
            <a href={CONTACTO_WHATSAPP_URL} aria-label="WhatsApp de 6.18 Producciones" className="text-marca-acento/80 hover:text-marca-acento">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2Zm5.6 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-5-4.3-5.1-4.5-.2-.2-1.2-1.6-1.2-3.1s.8-2.2 1-2.5c.3-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5s.8 1.9.8 2.1c.1.2.1.4 0 .6-.1.2-.2.3-.3.5-.2.2-.3.3-.5.5s-.3.4-.1.7c.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.7-.1.2-.2.7-.8.9-1.1s.4-.2.7-.1 1.8.9 2.2 1c.3.2.5.2.6.3.1.2.1.9-.1 1.5Z" />
              </svg>
            </a>
          )}
        </div>
      </nav>

      {/* Hero de bienvenida — presenta la productora, no solo el evento */}
      <section className="relative overflow-hidden bg-gradient-to-br from-marca-secundario via-marca-secundario to-marca-principal px-6 pt-12 pb-10 flex flex-col items-center text-center gap-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -right-16 w-56 h-56 rounded-full opacity-[0.12]"
          style={{ background: "var(--marca-acento)" }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 -left-10 w-48 h-48 rounded-full opacity-[0.08]"
          style={{ background: "var(--marca-acento)" }}
        />
        <span className="relative text-[11px] uppercase tracking-[0.2em] text-marca-acento/70 font-semibold">
          Bienvenido a
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-618-white.png" alt="6.18 Producciones" className="relative h-11 w-auto" />
        <p className="relative text-sm text-marca-acento/85 max-w-xs leading-relaxed">{SOBRE_PRODUCTORA}</p>
      </section>

      {/* Evento destacado — tarjeta al estilo de una plataforma de ticketing */}
      <section className="flex-1 px-5 pt-7 pb-14 flex flex-col gap-4">
        <p className="text-xs uppercase tracking-widest text-marca-neutro-1 font-semibold px-1">
          Próximo evento
        </p>

        {evento ? (
          <Link
            href="/comprar"
            className="group relative overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-black/5 flex flex-col hover:shadow-xl transition-shadow"
          >
            <div className="relative aspect-[1200/630] bg-gradient-to-br from-marca-secundario to-marca-principal flex items-start justify-between">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={FLYER_HORIZONTAL_URL}
                alt=""
                width={1080}
                height={567}
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
              {fechaFormateada && (
                <span className="relative m-3 bg-marca-acento text-marca-principal text-[11px] font-bold px-2.5 py-1 rounded-md">
                  {fechaFormateada}
                </span>
              )}
              <span className="relative m-3 bg-white/90 text-marca-principal text-[11px] font-bold px-2.5 py-1 rounded-md">
                🎄 Navideño
              </span>
            </div>
            <div className="p-4 flex flex-col gap-1">
              <h1 className="text-lg font-extrabold text-marca-principal">{evento.nombre}</h1>
              <p className="text-sm text-marca-neutro-1">
                {evento.venue} · {evento.ciudad}
              </p>
              <div className="flex items-center justify-between mt-3">
                {desde !== null && (
                  <span className="text-xs text-marca-neutro-1">
                    {enPreventa ? "Preventa desde" : "Desde"}{" "}
                    <strong className="text-marca-principal text-sm">${desde}</strong>{" "}
                    {enPreventa && <span className="line-through opacity-60">${regular}</span>}{" "}
                    <span className="opacity-60">+ fee</span>
                  </span>
                )}
                <span className="bg-marca-secundario text-white rounded-md px-4 py-2 text-sm font-semibold group-hover:opacity-90 transition-opacity">
                  Comprar entradas
                </span>
              </div>
            </div>
          </Link>
        ) : (
          <p className="text-sm text-marca-neutro-1 text-center py-10">Pronto anunciaremos el próximo evento.</p>
        )}
      </section>

      <footer className="bg-marca-principal px-6 py-6 flex flex-col items-center gap-2 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-618-white.png" className="h-5 w-auto opacity-90" alt="6.18 Producciones" />
        <p className="text-[11px]" style={{ color: "rgba(241,236,226,0.55)" }}>
          © {new Date().getFullYear()} 6.18 Producciones
        </p>
      </footer>
    </main>
  );
}
