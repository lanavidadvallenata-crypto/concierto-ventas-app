import Link from "next/link";

export function ProductoraHome({
  evento,
}: {
  evento: { nombre: string; fecha: string | null; venue: string; ciudad: string } | null;
}) {
  const fechaFormateada = evento?.fecha
    ? new Date(evento.fecha).toLocaleDateString("es-VE", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <main className="min-h-screen flex flex-col">
      <header className="bg-marca-principal px-6 py-12 flex flex-col items-center gap-4 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-618-white.png" alt="6.18 Producciones" className="h-9 w-auto" />
        <p className="text-sm max-w-sm" style={{ color: "rgba(241,236,226,0.75)" }}>
          Producciones de eventos en vivo.
        </p>
      </header>

      <section className="flex-1 bg-marca-acento px-6 py-12 flex flex-col items-center gap-6">
        <p className="text-xs uppercase tracking-widest text-marca-neutro-1 font-semibold">
          Próximo evento
        </p>

        {evento ? (
          <Link
            href="/comprar"
            className="w-full max-w-sm bg-white rounded-2xl border border-black/5 shadow-sm p-6 flex flex-col items-center gap-2 text-center hover:shadow-md transition-shadow"
          >
            <h1 className="text-xl font-extrabold text-marca-principal">{evento.nombre}</h1>
            {fechaFormateada && <p className="text-sm text-marca-neutro-1">{fechaFormateada}</p>}
            <p className="text-sm text-marca-neutro-1">
              {evento.venue} · {evento.ciudad}
            </p>
            <span className="mt-3 bg-marca-secundario text-white rounded-md px-5 py-2 text-sm font-semibold">
              Ver evento y comprar
            </span>
          </Link>
        ) : (
          <p className="text-sm text-marca-neutro-1">Pronto anunciaremos el próximo evento.</p>
        )}
      </section>

      <footer className="bg-marca-principal px-6 py-4 text-center">
        <p className="text-xs" style={{ color: "rgba(241,236,226,0.55)" }}>
          6.18 Producciones
        </p>
      </footer>
    </main>
  );
}
