import { createServiceClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/perfil";
import { obtenerAsiento, describirAsiento } from "@/lib/asiento";

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
  // Sin "embed" de sillas_vip (ver src/lib/asiento.ts): con el embed, la
  // consulta fallaba entera y TODO QR válido salía como "YA USADO".
  const { data: marcado, error: marcarError } = await service
    .from("tickets")
    .update({ qr_usado: true, qr_usado_en: new Date().toISOString(), qr_usado_por: perfil.id })
    .eq("qr_token", token)
    .eq("qr_usado", false)
    .eq("estado_pago", "verificado")
    .select("id, comprador_nombre, tipo, silla_id")
    .maybeSingle();

  if (marcarError) {
    console.error("Error validando QR:", marcarError.message);
    return (
      <Resultado
        color="red"
        titulo="ERROR"
        detalle="No se pudo validar por un problema de conexión. Vuelve a escanear. Si sigue, valida por nombre con Finanzas."
      />
    );
  }

  if (marcado) {
    await service.from("accesos").insert({ ticket_id: marcado.id, resultado: "valido", escaneado_por: perfil.id });
    const asiento = marcado.tipo === "vip" ? await obtenerAsiento(service, marcado.silla_id) : null;
    return (
      <Resultado
        color="green"
        titulo="VÁLIDO"
        detalle={`${marcado.comprador_nombre} · ${describirAsiento(marcado.tipo as "vip" | "general", asiento)}`}
      />
    );
  }

  // No se marcó — puede ser que ya estaba usado, o que el token no existe.
  const { data: existente, error: existenteError } = await service
    .from("tickets")
    .select("id, comprador_nombre, tipo, qr_usado, qr_usado_en, estado_pago")
    .eq("qr_token", token)
    .maybeSingle();

  if (existenteError) {
    console.error("Error consultando QR:", existenteError.message);
    return <Resultado color="red" titulo="ERROR" detalle="No se pudo validar por un problema de conexión. Vuelve a escanear." />;
  }

  if (existente && !existente.qr_usado) {
    // Existe pero el UPDATE no lo marcó: la única forma es que ya no esté
    // verificado (ej. se rechazó después de emitir el QR). No es reingreso.
    await service.from("accesos").insert({ ticket_id: existente.id, resultado: "invalido", escaneado_por: perfil.id });
    return <Resultado color="red" titulo="NO VÁLIDO" detalle={`${existente.comprador_nombre} — este ticket no está verificado (estado: ${existente.estado_pago}). No dejar pasar.`} />;
  }

  if (existente) {
    // Si el mismo QR se validó hace segundos, casi seguro es el mismo teléfono
    // recargando la pantalla (o el navegador re-abriendo el link), no otra
    // persona intentando colarse. Se muestra en verde con la hora para que la
    // persona de la puerta no le niegue el paso a quien ya validó.
    const usadoHaceMs = milisegundosDesde(existente.qr_usado_en);
    const horaUso = existente.qr_usado_en
      ? new Date(existente.qr_usado_en).toLocaleTimeString("es-VE", { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : null;

    if (usadoHaceMs < 90_000) {
      // Casi seguro es la misma pantalla recargada — pero también podría ser
      // un segundo teléfono con la captura del QR en otro carril. Se muestra
      // en ÁMBAR (no verde) con la hora, y se registra el intento igual.
      await service.from("accesos").insert({ ticket_id: existente.id, resultado: "ya_usado", escaneado_por: perfil.id });
      return (
        <Resultado
          color="amber"
          titulo="YA VALIDADO"
          detalle={`${existente.comprador_nombre} — entró hace ${Math.round(usadoHaceMs / 1000)} s. Si es la misma persona (pantalla recargada), pasa. Si es otra, NO.`}
        />
      );
    }

    await service.from("accesos").insert({ ticket_id: existente.id, resultado: "ya_usado", escaneado_por: perfil.id });
    return (
      <Resultado
        color="red"
        titulo="YA USADO"
        detalle={`${existente.comprador_nombre} — ya ingresó${horaUso ? ` a las ${horaUso}` : ""}. No dejar pasar.`}
      />
    );
  }

  await service.from("accesos").insert({ resultado: "invalido", escaneado_por: perfil.id });
  return <Resultado color="red" titulo="INVÁLIDO" detalle="Este código no corresponde a ninguna entrada." />;
}

// Fuera del componente a propósito: el lint de React marca Date.now() dentro
// del render como "impuro"; aquí es un Server Component que corre una sola
// vez por petición y necesitamos la hora real para distinguir "recargó la
// pantalla" de "otra persona con el mismo QR".
function milisegundosDesde(iso: string | null): number {
  if (!iso) return Infinity;
  return Date.now() - new Date(iso).getTime();
}

function Resultado({ color, titulo, detalle }: { color: "green" | "red" | "amber"; titulo: string; detalle: string }) {
  const bg = color === "green" ? "bg-green-600" : color === "amber" ? "bg-amber-500" : "bg-red-600";
  return (
    <main className={`min-h-screen flex flex-col items-center justify-center ${bg} text-white px-6 text-center gap-3`}>
      <h1 className="text-4xl font-bold">{titulo}</h1>
      <p className="text-lg">{detalle}</p>
    </main>
  );
}
