import Link from "next/link";
import { requerirPerfil } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import MarcoNoche, { EncabezadoNoche } from "@/components/noche/MarcoNoche";
import { listarCaidos } from "@/lib/abona618";
import { hoyEnVenezuela } from "@/lib/cuotas";
import { codigoCompra } from "@/lib/compra";
import { DOMINIO_RAIZ } from "@/lib/dominios";
import { cuandoCaracas, formatoUsd } from "@/lib/formato";
import { etiquetaTipo } from "@/lib/precios";

// Planes caídos, uno por uno (Anita, 17 oct). Se llega desde el dashboard,
// bloque Abona618 → "Caídos" → "Ver detalle". Solo lectura: aquí no se
// anula ni se reabre nada.

export const dynamic = "force-dynamic";

function paraWhatsApp(telefono: string | null): string | null {
  if (!telefono) return null;
  const d = telefono.replace(/\D/g, "");
  if (/^58\d{10}$/.test(d)) return d;
  if (/^0\d{10}$/.test(d)) return `58${d.slice(1)}`;
  if (/^\d{10}$/.test(d)) return `58${d}`;
  return null;
}

export default async function CaidosPage() {
  const perfil = await requerirPerfil();

  if (perfil.rol !== "ventas" && perfil.rol !== "finanzas" && perfil.rol !== "admin") {
    return (
      <>
        <Nav perfil={perfil} />
        <main className="max-w-3xl mx-auto w-full px-4 py-6">
          <p className="text-sm text-neutral-500">No tienes permiso para ver esta sección.</p>
        </main>
      </>
    );
  }

  const service = createServiceClient();
  const hoy = hoyEnVenezuela();
  const { caidos, error } = await listarCaidos(service);

  const ids = [...new Set(caidos.map((c) => c.anuladoPor).filter(Boolean))] as string[];
  const { data: perfiles } = ids.length
    ? await service.from("perfiles").select("id, nombre").in("id", ids)
    : { data: [] as { id: string; nombre: string }[] };
  const nombrePorId = new Map((perfiles ?? []).map((p) => [String(p.id), String(p.nombre)]));

  const abonadoTotal = Math.round(caidos.reduce((s, c) => s + c.abonadoUsd, 0) * 100) / 100;

  return (
    <MarcoNoche perfil={perfil}>
      <Link href="/dashboard" className="-mb-2 h-11 inline-flex items-center self-start text-sm text-lila hover:text-lila-claro underline underline-offset-2">
        ← Volver al dashboard
      </Link>
      <EncabezadoNoche compacto seccion="Cobranza" titulo="Planes caídos.">
        Compras en cuotas que se anularon. {caidos.length} en total · {formatoUsd(abonadoTotal)} abonados.
      </EncabezadoNoche>

      {error ? (
        <p className="text-sm rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-red-200">
          No se pudo leer la base de datos. Recarga en un momento.
        </p>
      ) : caidos.length === 0 ? (
        <p className="text-sm text-noche-tenue">No hay planes caídos.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {caidos.map((c) => {
            const wa = paraWhatsApp(c.compradorTelefono);
            const quien = c.anuladoPor ? nombrePorId.get(c.anuladoPor) : null;
            return (
              <article key={c.grupoId} className="bg-white/[0.05] border border-white/10 rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">
                      {c.compradorNombre ?? "Sin nombre"}{" "}
                      <span className="font-mono text-xs text-noche-tenue">· {codigoCompra(c.grupoId)}</span>
                    </p>
                    <p className="text-sm text-noche-suave">
                      {c.detalle ?? `${c.cantidad} ${etiquetaTipo(c.tipo, c.cantidad)}`} · {formatoUsd(c.totalUsd)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-semibold rounded-full px-2.5 py-1 ${
                      c.estado === "vencido" ? "bg-amber-400/10 text-amber-200" : "bg-white/[0.06] text-noche-texto"
                    }`}
                  >
                    {c.estado === "vencido" ? "Por falta de pago" : "Anulado a mano"}
                  </span>
                </div>

                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-noche-tenue">Abonado</dt>
                  <dd className="tabular-nums">
                    <span className="font-semibold">{formatoUsd(c.abonadoUsd)}</span> de {formatoUsd(c.totalUsd)}
                  </dd>
                  {c.creadoEn && (
                    <>
                      <dt className="text-noche-tenue">Apartado</dt>
                      <dd>{cuandoCaracas(c.creadoEn, hoy)}</dd>
                    </>
                  )}
                  <dt className="text-noche-tenue">Se anuló</dt>
                  <dd>
                    {c.anuladoEn ? cuandoCaracas(c.anuladoEn, hoy) : "sin fecha"}
                    {quien ? ` · por ${quien}` : ""}
                  </dd>
                </dl>

                {c.notas && <p className="text-sm italic text-noche-suave">“{c.notas}”</p>}

                <div className="flex flex-wrap gap-2 pt-1">
                  {wa && (
                    <a
                      href={`https://wa.me/${wa}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-11 px-3 inline-flex items-center rounded-lg bg-[#25D366] text-white text-sm font-semibold"
                    >
                      WhatsApp
                    </a>
                  )}
                  <a
                    href={`https://${DOMINIO_RAIZ}/compra/${c.grupoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-11 px-3 inline-flex items-center rounded-lg border border-white/15 bg-white/[0.05] text-sm font-semibold"
                  >
                    Ver su página
                  </a>
                  {c.compradorEmail && <span className="h-11 inline-flex items-center text-xs text-noche-tenue">{c.compradorEmail}</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </MarcoNoche>
  );
}
