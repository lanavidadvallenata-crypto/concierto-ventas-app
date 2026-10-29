"use client";

import { useEffect } from "react";
import { medir } from "@/lib/medicion-cliente";

// Anota la visita a una página pública (portada y /comprar) una sola vez por
// carga. No pinta nada.
export default function Medidor() {
  useEffect(() => {
    medir("visita");
  }, []);
  return null;
}
