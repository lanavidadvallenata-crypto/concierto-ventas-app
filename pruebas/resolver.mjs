// Traduce el alias "@/..." (que resuelven Next y tsc vía tsconfig paths) a una
// ruta de archivo con extensión, que es lo que necesita Node para correr los
// módulos TypeScript directamente. Así las pruebas corren contra el código de
// producción tal como está, sin imports especiales para probar.

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolverRuta } from "node:path";
import { existsSync } from "node:fs";

const raiz = resolverRuta(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(especificador, contexto, siguiente) {
  if (especificador.startsWith("@/")) {
    const base = resolverRuta(raiz, "src", especificador.slice(2));
    for (const candidato of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (existsSync(candidato)) return { url: pathToFileURL(candidato).href, shortCircuit: true };
    }
  }
  return siguiente(especificador, contexto);
}
