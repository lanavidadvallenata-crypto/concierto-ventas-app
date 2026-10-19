// Búsqueda de personas en las pantallas internas (Cobranza).
//
// Nace de un caso real (Anita, 19 oct): Edimar Salas compró 6 Preferenciales
// en cuotas, Finanzas → Buscar la mostraba como "pendiente, está arriba" y
// Cobranza no tenía cómo buscarla. Estaba en la pantalla, pero había que
// recorrerla entera para encontrarla.
//
// Reglas:
//   · Sin acentos ni mayúsculas: "Gonzalez" encuentra "González".
//   · Varias palabras = todas tienen que aparecer, en cualquier campo y en
//     cualquier orden: "edimar salas", "salas edimar".
//   · Teléfonos por dígitos, con o sin el 0 o el 58 adelante:
//     "0412-0700435", "4120700435" y "584120700435" son el mismo.

export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function digitosTelefono(texto: string): string {
  let d = texto.replace(/\D/g, "");
  if (d.startsWith("58") && d.length >= 12) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  return d;
}

export type Buscable = {
  /** Nombre, correo, código de compra, referencias: todo lo que se lee. */
  textos: (string | null | undefined)[];
  telefonos: (string | null | undefined)[];
};

export function coincide(item: Buscable, consulta: string): boolean {
  const q = normalizar(consulta);
  if (!q) return true;

  const textos = item.textos.filter(Boolean).map((t) => normalizar(t as string));
  const telefonos = item.telefonos.filter(Boolean).map((t) => digitosTelefono(t as string)).filter(Boolean);

  // Si lo que se escribió es un teléfono (solo dígitos y separadores, 6 o
  // más dígitos), se compara contra los teléfonos sin formato. Una
  // referencia numérica (pago móvil: 6 dígitos) también puede caer aquí, así
  // que además se busca como texto.
  const soloTelefono = /^[\d\s+\-().]+$/.test(q);
  if (soloTelefono) {
    const d = digitosTelefono(q);
    if (d.length >= 6 && telefonos.some((t) => t.includes(d))) return true;
  }

  const palabras = q.split(/\s+/).filter(Boolean);
  return palabras.every((p) => textos.some((t) => t.includes(p)));
}
