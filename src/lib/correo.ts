// Sugerencia de correo mal escrito ("gmial.com", "hotmail.co", "gmail.con").
//
// Por qué (Anita, 22 sep): quien escribe mal su correo no recibe nada — ni
// la confirmación ni los QR — y se entera tarde. No se bloquea nada: solo se
// ofrece "¿Quisiste decir …?" y la persona decide.
//
// Se compara el dominio contra los que más usa el público del evento. Si el
// dominio ya es uno conocido (incluidos ymail.com, mail.com, me.com…, que se
// parecen a gmail pero existen), no se sugiere nada.

const COMUNES = [
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "yahoo.com",
  "icloud.com",
  "live.com",
  "hotmail.es",
  "outlook.es",
  "yahoo.es",
];

const CONOCIDOS = new Set([
  ...COMUNES,
  "ymail.com",
  "mail.com",
  "email.com",
  "me.com",
  "mac.com",
  "msn.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "cantv.net",
  "live.com.mx",
]);

function distancia(a: string, b: string): number {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previo = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = temp;
    }
  }
  return fila[b.length];
}

export function sugerirCorreo(correo: string): string | null {
  const limpio = correo.trim().toLowerCase();
  const arroba = limpio.lastIndexOf("@");
  if (arroba < 1 || arroba === limpio.length - 1) return null;
  const usuario = limpio.slice(0, arroba);
  const dominio = limpio.slice(arroba + 1);
  if (CONOCIDOS.has(dominio)) return null;

  let mejor: string | null = null;
  let mejorDistancia = 3;
  for (const c of COMUNES) {
    const d = distancia(dominio, c);
    if (d < mejorDistancia) {
      mejor = c;
      mejorDistancia = d;
    }
  }
  return mejor ? `${usuario}@${mejor}` : null;
}
