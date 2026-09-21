// Formulario GET simple (sin JavaScript): la búsqueda la hace la página en el
// servidor con ?q=. Funciona aunque el teléfono de la puerta tenga mala señal
// y el JS no termine de cargar.
export default function EntradaManual({ q }: { q?: string }) {
  return (
    <form method="get" action="/acceso" className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col gap-3">
      <label className="block text-sm font-medium" htmlFor="q">
        Si el QR no escanea
      </label>
      <input
        id="q"
        name="q"
        defaultValue={q ?? ""}
        autoComplete="off"
        spellCheck={false}
        className="w-full border border-neutral-300 rounded-md px-3 py-2.5 text-base"
        placeholder="Código, compra o nombre"
      />
      <button type="submit" className="min-h-11 bg-neutral-900 text-white rounded-md text-sm font-semibold">
        Buscar
      </button>
      <ul className="text-xs text-neutral-500 flex flex-col gap-1">
        <li><strong className="text-neutral-700">Código de entrada</strong> (10 caracteres, debajo del QR): ej. 7KQ2M-9XH4R</li>
        <li><strong className="text-neutral-700">Código de compra</strong> (8 caracteres, en el asunto del correo): ej. 904FFF16</li>
        <li><strong className="text-neutral-700">Nombre</strong> del comprador, o los últimos 4 números de su teléfono</li>
      </ul>
    </form>
  );
}
