import { urlWhatsAppSoporte, WHATSAPP_SOPORTE_VISIBLE } from "@/lib/contacto";

// Botón de soporte por WhatsApp para TODO el proceso de compra (Anita, 22 sep):
// quien escribe mal su correo o su teléfono no recibe nada y necesita una vía
// visible para avisarnos en cualquier paso. Sin estado: sirve en componentes
// de servidor y de cliente.
export default function BotonSoporte({
  mensaje,
  texto = "¿Dudas o te equivocaste en un dato? Escríbenos por WhatsApp",
  variante = "enlace",
}: {
  mensaje?: string;
  texto?: string;
  variante?: "boton" | "enlace";
}) {
  const url = urlWhatsAppSoporte(mensaje ?? "Hola, tengo una duda con mi compra de entradas para La Navidad Vallenata.");
  if (variante === "boton") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full min-h-11 flex flex-col items-center justify-center rounded-xl bg-[#25D366] text-white font-semibold text-sm px-4 py-2 text-center leading-tight"
      >
        <span>{texto}</span>
        <span className="text-[11px] font-normal text-white/90">{WHATSAPP_SOPORTE_VISIBLE}</span>
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-medium text-green-700 underline underline-offset-2 text-center"
    >
      {texto} · {WHATSAPP_SOPORTE_VISIBLE}
    </a>
  );
}
