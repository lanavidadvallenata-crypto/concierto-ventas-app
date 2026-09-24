import { requerirPerfil } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import { obtenerMapaVip } from "@/lib/mapa-vip";
import { obtenerAsiento } from "@/lib/asiento";
import Nav from "@/components/Nav";
import PatrocinioForm from "./PatrocinioForm";
import ListaPatrocinantes, { type FilaPatrocinante } from "./ListaPatrocinantes";

// Sección privada de Anita: patrocinios y sus entradas de cortesía. Las
// entradas se emiten como tickets normales (canal 'patrocinio'), así que el
// aforo del dashboard y el mapa de la tienda se actualizan solos y no se
// sobrevende ninguna silla.
export default async function PatrocinantesPage() {
  const perfil = await requerirPerfil();

  if (perfil.rol !== "admin") {
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
  const mesas = await obtenerMapaVip(service);

  const { data: patrocinios } = await service
    .from("patrocinantes")
    .select("id, empresa, contacto_nombre, contacto_email, paquete, monto_usd, metodo_pago, referencia_pago, grupo_id, anulado_en, creado_en")
    .order("creado_en", { ascending: false });

  const filas: FilaPatrocinante[] = [];
  let totalCobrado = 0;
  let entradasEntregadas = 0;

  for (const p of patrocinios ?? []) {
    const { data: tickets } = p.grupo_id
      ? await service.from("tickets").select("id, tipo, silla_id, estado_pago").eq("grupo_id", p.grupo_id)
      : { data: [] as { id: string; tipo: string; silla_id: string | null; estado_pago: string }[] };

    const vivos = (tickets ?? []).filter((t) => t.estado_pago !== "rechazado");
    const asientos: string[] = [];
    for (const t of vivos) {
      if (t.tipo !== "vip") continue;
      const a = await obtenerAsiento(service, t.silla_id);
      if (a) asientos.push(`Fila ${a.fila} · Mesa ${a.mesaNumero} · Silla ${a.sillaNumero}`);
    }

    const anulado = !!p.anulado_en;
    if (!anulado) {
      totalCobrado += Number(p.monto_usd);
      entradasEntregadas += vivos.length;
    }

    filas.push({
      id: p.id,
      empresa: p.empresa,
      contactoNombre: p.contacto_nombre,
      contactoEmail: p.contacto_email,
      paquete: p.paquete,
      montoUsd: Number(p.monto_usd),
      metodoPago: p.metodo_pago,
      referenciaPago: p.referencia_pago,
      creadoEn: p.creado_en,
      anulado,
      entradas: vivos.length,
      asientos,
    });
  }

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold">Patrocinios</h1>
          <p className="text-sm text-neutral-500">
            Solo tú ves esta sección. Cada patrocinio que registres aquí emite sus entradas de cortesía y ocupa aforo
            real, para que el sistema nunca venda dos veces la misma silla.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Cobrado en patrocinios</div>
            <div className="text-2xl font-semibold mt-1">${totalCobrado.toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Entradas entregadas</div>
            <div className="text-2xl font-semibold mt-1">{entradasEntregadas}</div>
          </div>
        </div>

        <PatrocinioForm mesas={mesas} />

        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">Patrocinios registrados</h2>
          <ListaPatrocinantes filas={filas} />
        </div>
      </main>
    </>
  );
}
