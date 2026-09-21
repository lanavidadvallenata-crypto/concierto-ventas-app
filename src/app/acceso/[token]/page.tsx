import { createServiceClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/perfil";
import { obtenerAsiento, describirAsiento } from "@/lib/asiento";
import { registrarIngreso } from "./actions";

// Pantalla de la puerta. Abrir el enlace del QR NO cambia nada: solo muestra
// la entrada. El ingreso se registra con el toque en "DEJAR ENTRAR"
// (ver actions.ts — por qué no se valida al cargar la página).
//
// Estados:
//   - LISTO PARA ENTRAR (oscuro + botón verde): verificada y sin usar.
//   - VÁLIDO (verde): se acaba de registrar el ingreso (últimos 90 s) — es la
//     pantalla que ve la persona de la puerta justo después del toque, y la
//     que se repite si el teléfono recarga.
//   - YA VALIDADO (ámbar): al tocar, otro carril ya lo había marcado.
//   - YA USADO (rojo): ingresó hace más de 90 s.
//   - NO VÁLIDO / INVÁLIDO (rojo): no verificado / token desconocido.
export default async function ValidarAccesoPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ repetido?: string; error?: string }>;
}) {
  const { token } = await params;
  const { repetido, error: errorAccion } = await searchParams;

  // El middleware ya exige sesión iniciada para llegar hasta acá. Este chequeo
  // de rol es lo que separa "personal de acceso" de "cualquiera con cuenta".
  const perfil = await getPerfilActual();
  if (!perfil || (perfil.rol !== "acceso" && perfil.rol !== "admin")) {
    return <Resultado color="red" titulo="SIN PERMISO" detalle="Esta cuenta no tiene rol de acceso. Pídele a Anita que te lo asigne." />;
  }

  const service = createServiceClient();

  // Solo lectura. Sin "embed" de sillas_vip (ver src/lib/asiento.ts).
  const { data: ticket, error: ticketError } = await service
    .from("tickets")
    .select("id, comprador_nombre, tipo, silla_id, qr_usado, qr_usado_en, estado_pago")
    .eq("qr_token", token)
    .maybeSingle();

  if (ticketError) {
    console.error("Error consultando QR:", ticketError.message);
    return (
      <Resultado
        color="red"
        titulo="ERROR"
        detalle="No se pudo consultar por un problema de conexión. Vuelve a escanear. Si sigue, valida por nombre con Finanzas."
      />
    );
  }

  if (!ticket) {
    await service.from("accesos").insert({ resultado: "invalido", escaneado_por: perfil.id });
    return <Resultado color="red" titulo="INVÁLIDO" detalle="Este código no corresponde a ninguna entrada." />;
  }

  const asiento = ticket.tipo === "vip" ? await obtenerAsiento(service, ticket.silla_id) : null;
  const descripcion = `${ticket.comprador_nombre} · ${describirAsiento(ticket.tipo as "vip" | "general", asiento)}`;

  if (ticket.estado_pago !== "verificado") {
    await service.from("accesos").insert({ ticket_id: ticket.id, resultado: "invalido", escaneado_por: perfil.id });
    return (
      <Resultado
        color="red"
        titulo="NO VÁLIDO"
        detalle={`${descripcion} — este ticket no está verificado (estado: ${ticket.estado_pago}). No dejar pasar.`}
      />
    );
  }

  if (ticket.qr_usado) {
    const usadoHaceMs = milisegundosDesde(ticket.qr_usado_en);
    const horaUso = ticket.qr_usado_en
      ? new Date(ticket.qr_usado_en).toLocaleTimeString("es-VE", { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : null;

    if (repetido === "1") {
      // Otro teléfono lo marcó entre que se abrió la pantalla y el toque.
      await service.from("accesos").insert({ ticket_id: ticket.id, resultado: "ya_usado", escaneado_por: perfil.id });
      return (
        <Resultado
          color="amber"
          titulo="YA VALIDADO"
          detalle={`${descripcion} — otro carril registró su ingreso hace ${Math.round(usadoHaceMs / 1000)} s. Si es la misma persona, pasa. Si es otra, NO.`}
        />
      );
    }

    if (usadoHaceMs < 90_000) {
      // Pantalla que ve la puerta justo después de tocar DEJAR ENTRAR (la
      // acción redirige aquí), o el mismo teléfono recargando. No se registra
      // de nuevo: el "valido" ya quedó en la bitácora.
      return (
        <Resultado
          color="green"
          titulo="VÁLIDO"
          detalle={`${descripcion} — ingreso registrado${horaUso ? ` a las ${horaUso}` : ""}.`}
        />
      );
    }

    await service.from("accesos").insert({ ticket_id: ticket.id, resultado: "ya_usado", escaneado_por: perfil.id });
    return (
      <Resultado
        color="red"
        titulo="YA USADO"
        detalle={`${descripcion} — ya ingresó${horaUso ? ` a las ${horaUso}` : ""}. No dejar pasar.`}
      />
    );
  }

  // Verificada y sin usar: mostrar y esperar el toque.
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-neutral-900 text-white px-6 text-center gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-neutral-400">Entrada verificada · sin usar</p>
        <h1 className="text-3xl font-bold leading-tight">{ticket.comprador_nombre}</h1>
        <p className="text-xl text-neutral-200">{describirAsiento(ticket.tipo as "vip" | "general", asiento)}</p>
      </div>
      {errorAccion === "1" ? (
        <p className="text-sm bg-red-700/60 rounded-lg px-3 py-2">No se pudo registrar por un problema de conexión. Toca de nuevo.</p>
      ) : null}
      <form action={registrarIngreso} className="w-full max-w-xs">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="w-full min-h-20 rounded-2xl bg-green-600 active:bg-green-700 text-white text-2xl font-bold tracking-wide shadow-lg"
        >
          DEJAR ENTRAR
        </button>
      </form>
      <p className="text-xs text-neutral-400 max-w-xs">
        Al tocar queda registrado el ingreso y este QR deja de servir. Si la persona no coincide con el nombre, no toques.
      </p>
    </main>
  );
}

// Fuera del componente a propósito: el lint de React marca Date.now() dentro
// del render como "impuro"; aquí es un Server Component que necesita la hora
// real para distinguir "recién registrado" de "entró hace rato".
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
