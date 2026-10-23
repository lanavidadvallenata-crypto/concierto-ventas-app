import type { ReactNode } from "react";
import type { PerfilActual } from "@/lib/perfil";
import Nav from "@/components/Nav";
import { urbanist } from "./fuente";

export { TARJETA, CAMPO, BOTON_SUAVE } from "./estilos";

// El marco del sistema interno con la dirección visual "noche" de 6.18:
// fondo, barra de arriba y ancho de la página. Cada módulo que se pasa a este
// estilo (Dashboard el 23 oct, luego Finanzas…) lo usa igual, para que todos
// se vean como una sola app y no como pantallas sueltas.

export default function MarcoNoche({ perfil, children }: { perfil: PerfilActual; children: ReactNode }) {
  return (
    <div className={`${urbanist.variable} tema-noche flex-1 flex flex-col bg-noche text-noche-texto [color-scheme:dark]`}>
      <Nav perfil={perfil} tema="noche" />

      <div className="relative flex-1 overflow-x-clip">
        {/* Fondo: la cuadrícula tenue, el resplandor morado y el círculo
            partido del logo de 6.18. Pura decoración. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[380px] overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(241,236,226,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(241,236,226,0.035)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_80%_70%_at_85%_0%,#000_25%,transparent_75%)]" />
          <div className="absolute -right-28 -top-44 w-[540px] h-[440px] bg-[radial-gradient(ellipse_50%_50%_at_50%_50%,rgba(123,44,191,0.42),rgba(63,10,98,0.18)_50%,transparent_72%)]" />
          <div className="absolute -right-[70px] -top-[110px] w-[220px] h-[220px] rounded-full border border-lila/20" />
          <div className="absolute right-[40px] -top-[110px] w-[110px] h-[220px] rounded-l-full bg-gradient-to-b from-violeta-hondo/35 to-marca-secundario/60" />
        </div>

        <main className="relative max-w-3xl mx-auto w-full px-4 pt-7 pb-12 flex flex-col gap-5">{children}</main>
      </div>
    </div>
  );
}

/** Encabezado de módulo: sección en mayúsculas espaciadas, título en
 *  Urbanist itálica y una línea de resumen. `derecha` suele ser el
 *  indicador "En vivo". */
export function EncabezadoNoche({
  seccion,
  titulo,
  derecha,
  children,
}: {
  seccion: string;
  titulo: string;
  derecha?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold tracking-[0.28em] uppercase text-noche-tenue">{seccion}</p>
        {derecha}
      </div>
      <h1 className="font-titular italic font-extrabold text-[40px] leading-[1.02] tracking-[-0.01em] text-noche-texto [text-wrap:balance]">
        {titulo}
      </h1>
      {children && <p className="text-sm text-noche-suave">{children}</p>}
    </header>
  );
}
