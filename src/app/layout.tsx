import type { Metadata } from "next";
import { Poppins, Bebas_Neue } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// Display del branding específico del evento (La Navidad Vallenata) — se usa
// en el hero de /comprar, donde vive el afiche real del evento.
const bebasNeue = Bebas_Neue({
  variable: "--font-bebas",
  subsets: ["latin"],
  weight: ["400"],
});

// Vista previa al compartir el link (WhatsApp, Instagram, Facebook, X): la
// imagen horizontal escalada a 1200x630, que es lo que esas plataformas piden.
// metadataBase hace absolutas las URLs de las imágenes.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://lanavidadvallenata.com"),
  title: "La Navidad Vallenata — 6.18 Producciones",
  description:
    "Miguel Morales, Diomedes Dionisio e Iván Zuleta en vivo. Viernes 4 de diciembre, Hangar Grano de Oro, Maracaibo. Entradas oficiales con QR.",
  openGraph: {
    title: "La Navidad Vallenata — Maracaibo, 4 de diciembre",
    description: "Miguel Morales, Diomedes Dionisio e Iván Zuleta. Compra tu entrada oficial con QR.",
    siteName: "6.18 Producciones",
    locale: "es_VE",
    type: "website",
    images: [{ url: "/og-navidad-vallenata.jpg", width: 1200, height: 630, alt: "La Navidad Vallenata" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "La Navidad Vallenata — Maracaibo, 4 de diciembre",
    description: "Miguel Morales, Diomedes Dionisio e Iván Zuleta. Compra tu entrada oficial con QR.",
    images: ["/og-navidad-vallenata.jpg"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${poppins.variable} ${bebasNeue.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">{children}</body>
    </html>
  );
}
