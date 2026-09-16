import { createServiceClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/perfil";

export default async function ValidarAccesoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // El middleware ya exige sesión iniciada para llegar hasta acá. Este chequeo
  // adicional de rol es lo que de verdad separa "personal de acceso" de
  // "cualquiera con una cuenta en el sistema" (por ejemplo, alguien de Ventas
  // no debería poder validar entradas en la puerta). No se ejecuta el UPDATE
  // que marca el ticket como usado si el rol no es el correcto.
  const perfil = await getPerfilActual();
  if (!perfil || (perfil.rol !== "acceso" && perfil.rol !== "admin")) {
    return (
      <Resultado
        color="red"
        titulo="SIN PERMISO"
        detalle="Esta cuenta no tiene rol de acceso. Pídele a Anita que te lo asigne."
      />
    );
  }

  const service = createServiceClient();

  // Update atómico: solo marca como usado si todavía no lo estaba.
  // Si esto devuelve una fila, este es el primer (y único) ingreso válido con ese QR.
  const { data: marcado } = await service
    .from("tickets")
    .update({ qr_usado: true, qr_usado_en: new Date().toISOString() })
    .eq("qr_token", token)
    .eq("qr_usado", false)
    .select("id, comprador_nombre, tipo, sillas_vip(numero, mesas_vip(numero, fila))")
    .maybeSingle();

  if (marcado) {
    await service.from("accesos").insert({ ticket_id: marcado.id, resultado: "valido" });
    const silla = (marcado as unknown as { sillas_vip: { numero: number; mesas_vip: { numero: number; fila: string } } | null }).sillas_vip;
    return (
      <Resultado
        color="green"
        titulo="VÁLIDO"
        detalle={`${marcado.comprador_nombre} · ${marcado.tipo === "vip" ? `Fila ${silla?.mesas_vip?.fila} · Mesa ${silla?.mesas_vip?.numero} · Silla ${silla?.numero}` : "General"}`}
      />
    );
  }

  // No se marcó — puede ser que ya estaba usado, o que el token no existe.
  const { data: existente } = await service
    .from("tickets")
    .select("id, comprador_nombre, tipo, qr_usado_en")
    .eq("qr_token", token)
    .maybeSingle();

  if (existente) {
    await service.from("accesos").insert({ ticket_id: existente.id, resultado: "ya_usado" });
    return (
      <Resultado
        color="red"
        titulo="YA USADO"
        detalle={`${existente.comprador_nombre} — ya ingresó${existente.qr_usado_en ? ` a las ${new Date(existente.qr_usado_en).toLocaleTimeString("es-VE")}` : ""}`}
      />
    );
  }

  await service.from("accesos").insert({ resultado: "invalido" });
  return <Resultado color="red" titulo="INVÁLIDO" detalle="Este código no corresponde a ninguna entrada." />;
}

function Resultado({ color, titulo, detalle }: { color: "green" | "red"; titulo: string; detalle: string }) {
  const bg = color === "green" ? "bg-green-600" : "bg-red-600";
  return (
    <main className={`min-h-screen flex flex-col items-center justify-center ${bg} text-white px-6 text-center gap-3`}>
      <h1 className="text-4xl font-bold">{titulo}</h1>
      <p className="text-lg">{detalle}</p>
    </main>
  );
}
