// Clases compartidas del tema "noche" de 6.18. Van en un archivo aparte (sin
// componentes ni fuentes) para que las pantallas de cliente las importen sin
// arrastrar el marco del servidor.

/** Superficie estándar de una sección sobre el fondo noche. */
export const TARJETA = "rounded-[20px] bg-white/[0.04] border border-white/10";

/** Campo de texto sobre fondo noche: 44 px de alto para el dedo. */
export const CAMPO =
  "h-11 rounded-xl border border-white/15 bg-white/[0.05] px-3 text-sm text-noche-texto placeholder:text-noche-tenue focus:outline-2 focus:outline-lila focus:outline-offset-1";

/** Botón secundario (acciones que no mueven dinero). */
export const BOTON_SUAVE =
  "h-11 px-3 rounded-xl border border-white/15 bg-white/[0.05] text-xs font-semibold text-noche-texto hover:bg-white/10 disabled:opacity-50";
