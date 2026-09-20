// Contenido de marketing de la página de venta pública.
// Datos reales tomados del afiche oficial (branding_4.pdf, 15/9). No se
// fabrica copy de marca: la descripción es solo el hecho (quién, dónde,
// cuándo), sin adjetivos que Anita no haya dado.

export const DESCRIPCION_EVENTO =
  "Concierto de música vallenata en vivo con Miguel Morales, Diomedes Dionisio e Iván Zuleta. Viernes 4 de diciembre en el Hangar de Grano de Oro, Maracaibo.";

export const LINEUP: string[] = ["Miguel Morales", "Diomedes Dionisio", "Iván Zuleta"];

export const CONTACTO_WHATSAPP_TEXTO = "Escríbenos por WhatsApp";
// Número de soporte del evento (Anita, 19 sep). El afiche impreso trae
// 0414-6079247; si se prefiere volver a ese, cambiar aquí y en src/lib/contacto.ts.
export const CONTACTO_WHATSAPP_URL: string | null = "https://wa.me/584241250127";

// Artes finales del evento (20 sep). Cada formato tiene su sitio:
//  - 4:5  (864x1080)  → hero de /comprar: es la proporción de feed de Instagram,
//                        llena la pantalla del teléfono sin empujar el botón de
//                        compra demasiado abajo.
//  - 1.9:1 (1080x567) → tarjeta del home de 6.18 (aspect 1200/630), encabezado
//                        de los correos (560px de ancho) y vista previa al
//                        compartir el link en WhatsApp/Instagram (Open Graph).
//  - 3:4  (810x1080)  → post de feed alternativo; no se usa en la app, se
//                        sirve en /flyer-3x4.jpg para que el equipo lo comparta.
//  - 9:16 (607x1080)  → stories / estados de WhatsApp; igual, /flyer-story.jpg.
export const FLYER_HERO_URL = "/flyer-4x5.jpg";
export const FLYER_HORIZONTAL_URL = "/flyer-horizontal.jpg";
export const FLYER_OG_URL = "/og-navidad-vallenata.jpg"; // 1200x630, la horizontal escalada
export const FLYER_URL: string | null = FLYER_HERO_URL;

// Home de la productora (bienvenida). Texto persuasivo, no institucional
// (pedido de Anita, 16/9, emulando el tono de venta de plataformas como
// MDTicket): vende la experiencia y genera confianza en la compra, sin
// inventar cifras o trayectoria que 6.18 Producciones no haya confirmado.
export const SOBRE_PRODUCTORA =
  "En 6.18 Producciones creamos los eventos que tu ciudad no se quiere perder: conciertos y experiencias en vivo pensadas para vivirse a full. Compra 100% oficial y segura — tu entrada con QR llega directo a tu correo, sin intermediarios ni sorpresas.";

export const INSTAGRAM_URL: string | null = "https://www.instagram.com/6.18producciones/";
