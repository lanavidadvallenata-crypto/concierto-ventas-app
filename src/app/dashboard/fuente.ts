import { Urbanist } from "next/font/google";

// Titular de la dirección visual "noche" de 6.18 (propuesta del 21 sep,
// aprobada por Anita el 23 oct para empezar por el Dashboard). La display de
// la marca, "Urbanis", no está en Google Fonts; Urbanist es su pariente más
// cercano. Se declara aquí y no en el layout para que solo la descargue la
// página que la usa: Ventas, Finanzas y la tienda no cargan un byte de más.
export const urbanist = Urbanist({
  subsets: ["latin"],
  weight: ["800"],
  style: ["normal", "italic"],
  variable: "--font-urbanist",
  display: "swap",
});
