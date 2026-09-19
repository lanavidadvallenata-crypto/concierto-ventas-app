import type { PerfilActual } from "@/lib/perfil";
import { cerrarSesion } from "@/app/actions";
import NavTabs from "./NavTabs";

const ETIQUETA_ROL: Record<string, string> = {
  ventas: "Ventas",
  finanzas: "Finanzas",
  admin: "Admin",
  acceso: "Acceso",
};

export default function Nav({ perfil }: { perfil: PerfilActual }) {
  const links = [
    { href: "/ventas", label: "Ventas", roles: ["ventas", "finanzas", "admin"] },
    { href: "/taquilla", label: "Taquilla", roles: ["ventas", "finanzas", "admin"] },
    { href: "/finanzas", label: "Finanzas", roles: ["finanzas", "admin"] },
    { href: "/dashboard", label: "Dashboard", roles: ["ventas", "finanzas", "admin"] },
    { href: "/acceso", label: "Acceso", roles: ["acceso", "admin"] },
    { href: "/admin", label: "Admin", roles: ["admin"] },
  ];

  const visibles = links.filter((l) => l.roles.includes(perfil.rol));

  // El equipo trabaja desde el teléfono: la barra anterior metía marca, 5
  // enlaces, nombre, rol y "Salir" en una sola fila de 375px y se montaban
  // unos sobre otros. Ahora: fila 1 = marca + quién soy + salir; fila 2 =
  // pestañas con área táctil de 44px y scroll horizontal si no caben.
  return (
    <header className="border-b border-neutral-200 bg-white sticky top-0 z-20">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex items-center justify-between gap-3 h-12">
          <span className="font-semibold text-sm truncate">Navidad Vallenata</span>
          <div className="flex items-center gap-3 text-sm text-neutral-500 min-w-0">
            <span className="truncate">
              {perfil.nombre} <span className="text-neutral-400">· {ETIQUETA_ROL[perfil.rol] ?? perfil.rol}</span>
            </span>
            <form action={cerrarSesion} className="shrink-0">
              <button type="submit" className="text-neutral-500 hover:text-neutral-900 h-11 px-2 -mr-2">
                Salir
              </button>
            </form>
          </div>
        </div>
        {visibles.length > 1 && <NavTabs links={visibles.map(({ href, label }) => ({ href, label }))} />}
      </div>
    </header>
  );
}
