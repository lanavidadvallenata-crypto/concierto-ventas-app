"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavTabs({
  links,
  tema = "claro",
}: {
  links: { href: string; label: string }[];
  /** "noche" = la dirección visual nueva de 6.18. Por defecto se ve igual que siempre. */
  tema?: "claro" | "noche";
}) {
  const pathname = usePathname();
  const noche = tema === "noche";
  return (
    <nav className="flex gap-1 -mb-px overflow-x-auto" aria-label="Secciones">
      {links.map((l) => {
        const activo = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={activo ? "page" : undefined}
            className={`shrink-0 h-11 px-3 flex items-center text-sm font-medium border-b-2 ${
              noche
                ? activo
                  ? "text-white border-violeta"
                  : "text-noche-tenue border-transparent hover:text-noche-texto hover:border-white/20"
                : activo
                  ? "text-marca-secundario border-marca-secundario"
                  : "text-neutral-600 border-transparent hover:text-neutral-900 hover:border-neutral-300"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
