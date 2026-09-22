import { createServiceClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/perfil";
import { obtenerAsiento, describirAsiento } from "@/lib/asiento";
import { registrarIngreso } from "./actions";
import BotonDejarEntrar from "./BotonDejarEntrar";
import { marcaIngresoValida } from "@/lib/marca-ingreso";

// Pantalla de la puerta. Abrir el enlace del QR NO cambia nada: solo muestra
// la entrada. El ingreso se registra con el toque en "DEJAR ENTRAR"
// (ver actions.ts — por qué no se valida al cargar la página).
//
// Estados:
//   - LISTO PARA ENTRAR (oscuro + botón verde): verificada y sin usar.
//   - VÁLIDO (verde): SOLO en el teléfono que acaba de tocar DEJAR ENTRAR
//     (marca firmada ?ok=, 2 min; ver src/lib/marca-ingreso.ts).
//   - YA USADO (rojo): cualquier otro escaneo de un QR ya usado, aunque sea
//     segundos después — incluida una copia del mismo QR (reenvío, captura).
//   - NO VÁLIDO / INVÁLIDO (rojo): no verificado / token desconocido.
export default async function ValidarAccesoPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ repetido?: string; error?: string; ok?: string }>;
}) {
  const { token } = await params;
  const { repetido, error: errorAccion, ok } = await searchParams;

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

    if (marcaIngresoValida(token, ok)) {
      // Este teléfono acaba de tocar DEJAR ENTRAR (o recarga esa pantalla).
      // No se registra de nuevo: el "valido" ya quedó en la bitácora.
      return (
        <Resultado
          color="green"
          titulo="VÁLIDO"
          detalle={`${descripcion} — ingreso registrado${horaUso ? ` a las ${horaUso}` : ""}.`}
        />
      );
    }

    await service.from("accesos").insert({ ticket_id: ticket.id, resultado: "ya_usado", escaneado_por: perfil.id });
    const hace = textoHace(usadoHaceMs);
    return (
      <Resultado
        color="red"
        titulo="YA USADO"
        detalle={
          repetido === "1"
            ? `${descripcion} — otro teléfono registró este QR hace ${hace}. Si la persona que tienes enfrente es la que acaba de pasar, no hagas nada más. Si es otra persona, NO pasa: es una copia.`
            : `${descripcion} — ya ingresó${horaUso ? ` a las ${horaUso}` : ""} (hace ${hace}). No dejar pasar: este QR ya se usó.`
        }
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
        <BotonDejarEntrar />
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

function textoHace(ms: number): string {
  if (!Number.isFinite(ms)) return "un rato";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
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
