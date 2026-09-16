import Link from "next/link";
import type { PerfilActual } from "@/lib/perfil";
import { cerrarSesion } from "@/app/actions";

export default function Nav({ perfil }: { perfil: PerfilActual }) {
  const links = [
    { href: "/ventas", label: "Ventas", roles: ["ventas", "finanzas", "admin"] },
    { href: "/finanzas", label: "Finanzas", roles: ["finanzas", "admin"] },
    { href: "/acceso", label: "Acceso", roles: ["acceso", "admin"] },
    { href: "/admin", label: "Admin", roles: ["admin"] },
  ];

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-sm">Navidad Vallenata</span>
          <nav className="flex gap-3 text-sm">
            {links
              .filter((l) => l.roles.includes(perfil.rol))
              .map((l) => (
                <Link key={l.href} href={l.href} className="text-neutral-600 hover:text-neutral-900">
                  {l.label}
                </Link>
              ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <span>{perfil.nombre} · {perfil.rol}</span>
          <form action={cerrarSesion}>
            <button type="submit" className="text-neutral-400 hover:text-neutral-700">Salir</button>
          </form>
        </div>
      </div>
    </header>
  );
}
