import { redirect } from "next/navigation";
import { getPerfilActual } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import PendientesList from "./PendientesList";

export default async function FinanzasPage() {
  const perfil = await getPerfilActual();
  if (!perfil) redirect("/login");

  if (perfil.rol !== "finanzas" && perfil.rol !== "admin") {
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
  const { data: pendientes } = await service
    .from("tickets")
    .select(
      "id, comprador_nombre, comprador_telefono, tipo, precio, moneda, metodo_pago, referencia_pago, vendido_por, created_at, perfiles!tickets_vendido_por_fkey(nombre), sillas_vip(numero, mesas_vip(numero, fila))"
    )
    .eq("estado_pago", "pendiente")
    .order("created_at", { ascending: true });

  const lista = (pendientes ?? []).map((t) => ({
    id: t.id as string,
    compradorNombre: t.comprador_nombre as string,
    compradorTelefono: t.comprador_telefono as string,
    tipo: t.tipo as "vip" | "general",
    precio: t.precio as number,
    moneda: t.moneda as string,
    metodoPago: t.metodo_pago as string,
    referenciaPago: t.referencia_pago as string | null,
    vendedorNombre: (t as unknown as { perfiles: { nombre: string } | null }).perfiles?.nombre ?? "—",
    asiento: (() => {
      const s = (t as unknown as { sillas_vip: { numero: number; mesas_vip: { numero: number; fila: string } } | null }).sillas_vip;
      return s ? `Fila ${s.mesas_vip?.fila} · Mesa ${s.mesas_vip?.numero} · Silla ${s.numero}` : null;
    })(),
  }));

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Verificación de pagos</h1>
          <p className="text-sm text-neutral-500">{lista.length} pendientes</p>
        </div>
        <PendientesList tickets={lista} miId={perfil.id} />
      </main>
    </>
  );
}
