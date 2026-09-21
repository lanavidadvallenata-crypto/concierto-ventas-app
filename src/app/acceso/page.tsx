import Link from "next/link";
import { redirect } from "next/navigation";
import { requerirPerfil } from "@/lib/perfil";
import { createServiceClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import EntradaManual from "./EntradaManual";
import { interpretarConsulta, rangoCompra, patronIlike, telefonoEnmascarado } from "@/lib/buscar-entrada";
import { codigoEntrada } from "@/lib/qr";
import { codigoCompra } from "@/lib/compra";

// Puerta — "si el QR no escanea". Acepta, en una sola caja:
//   · el código de entrada de 10 caracteres que va debajo de cada QR,
//   · el código de compra de 8 caracteres (asunto del correo),
//   · el enlace o el código secreto completo,
//   · o el nombre / teléfono del comprador.
// Nunca marca nada aquí: cada resultado abre la pantalla de la entrada, donde
// el ingreso se registra con DEJAR ENTRAR (mismo control que el QR).

type Fila = {
  id: string;
  grupo_id: string | null;
  comprador_nombre: string;
  comprador_telefono: string | null;
  tipo: "vip" | "general";
  silla_id: string | null;
  estado_pago: string;
  qr_token: string | null;
  qr_usado: boolean;
  qr_usado_en: string | null;
};

const COLUMNAS = "id, grupo_id, comprador_nombre, comprador_telefono, tipo, silla_id, estado_pago, qr_token, qr_usado, qr_usado_en";

export default async function AccesoPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const perfil = await requerirPerfil();

  if (perfil.rol !== "acceso" && perfil.rol !== "admin") {
    return (
      <>
        <Nav perfil={perfil} />
        <main className="max-w-md mx-auto w-full px-4 py-6">
          <p className="text-sm text-neutral-500">No tienes permiso para ver esta sección.</p>
        </main>
      </>
    );
  }

  const { q } = await searchParams;
  const consulta = interpretarConsulta(q);
  const service = createServiceClient();

  let filas: Fila[] = [];
  let aviso: string | null = null;
  let error: string | null = null;

  if (consulta.tipo === "token") {
    redirect(`/acceso/${consulta.token}`);
  }

  if (consulta.tipo === "codigo") {
    const { data, error: e } = await service.from("tickets").select(COLUMNAS).like("qr_token", `${consulta.codigo}%`).limit(5);
    if (e) error = e.message;
    const encontrados = (data ?? []) as Fila[];
    if (encontrados.length === 1 && encontrados[0].qr_token) redirect(`/acceso/${encontrados[0].qr_token}`);
    filas = encontrados;
    if (!e && encontrados.length === 0) {
      // Puede ser un nombre de 10 letras: se busca como texto.
      const r = await buscarTexto(service, consulta.texto);
      filas = r.filas; error = r.error;
      if (filas.length === 0 && !error) aviso = `Ningún código de entrada empieza por ${consulta.codigo.slice(0, 5)}-${consulta.codigo.slice(5)}. Revisa letra por letra o busca por el nombre del comprador.`;
    }
  }

  if (consulta.tipo === "compra") {
    const { desde, hasta } = rangoCompra(consulta.prefijo);
    let query = service.from("tickets").select(COLUMNAS).gte("grupo_id", desde);
    query = hasta ? query.lt("grupo_id", hasta) : query.lte("grupo_id", "ffffffff-ffff-ffff-ffff-ffffffffffff");
    const { data, error: e } = await query.order("created_at", { ascending: true }).limit(40);
    if (e) error = e.message;
    filas = (data ?? []) as Fila[];
    if (!e && filas.length === 0) aviso = `No hay ninguna compra ${consulta.prefijo.toUpperCase()}.`;
  }

  if (consulta.tipo === "texto") {
    if (consulta.texto.length < 3) {
      aviso = "Escribe al menos 3 letras del nombre o 4 números del teléfono.";
    } else {
      const r = await buscarTexto(service, consulta.texto);
      filas = r.filas; error = r.error;
      if (filas.length === 0 && !error) aviso = `No hay entradas pagadas a nombre de "${consulta.texto}".`;
    }
  }

  if (error) console.error("Búsqueda en puerta:", error);

  // Asientos VIP de los resultados (dos consultas simples, sin embeds).
  const sillaIds = [...new Set(filas.map((f) => f.silla_id).filter(Boolean))] as string[];
  const { data: sillas } = sillaIds.length
    ? await service.from("sillas_vip").select("id, numero, mesa_id").in("id", sillaIds)
    : { data: [] as { id: string; numero: number; mesa_id: string }[] };
  const mesaIds = [...new Set((sillas ?? []).map((s) => s.mesa_id))];
  const { data: mesas } = mesaIds.length
    ? await service.from("mesas_vip").select("id, numero, fila").in("id", mesaIds)
    : { data: [] as { id: string; numero: number; fila: string }[] };
  const sillaPorId = new Map((sillas ?? []).map((s) => [s.id, s]));
  const mesaPorId = new Map((mesas ?? []).map((m) => [m.id, m]));
  const asientoDe = (f: Fila) => {
    if (f.tipo !== "vip") return "General";
    const s = f.silla_id ? sillaPorId.get(f.silla_id) : null;
    const m = s ? mesaPorId.get(s.mesa_id) : null;
    return s && m ? `VIP · Fila ${m.fila} · Mesa ${m.numero} · Silla ${s.numero}` : "VIP";
  };

  return (
    <>
      <Nav perfil={perfil} />
      <main className="max-w-md mx-auto w-full px-4 py-6 flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Control de acceso</h1>
          <p className="text-sm text-neutral-500">
            Lo normal es escanear el QR con la cámara del teléfono. Si no escanea (pantalla rota, poco brillo, sin QR a mano), búscalo aquí.
          </p>
        </div>

        <EntradaManual q={q} />

        {error ? (
          <p className="text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2">No se pudo buscar por un problema de conexión. Intenta de nuevo.</p>
        ) : null}
        {aviso ? <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">{aviso}</p> : null}

        {filas.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-neutral-500">
              {filas.length} {filas.length === 1 ? "entrada" : "entradas"}. Confirma con la persona el nombre del comprador y los últimos 4 números del teléfono antes de abrir.
            </p>
            {filas.map((f) => {
              const codigo = codigoEntrada(f.qr_token);
              const pagada = f.estado_pago === "verificado" && f.qr_token;
              const hora = f.qr_usado_en
                ? new Date(f.qr_usado_en).toLocaleTimeString("es-VE", { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit" })
                : null;
              return (
                <div key={f.id} className="bg-white border border-neutral-200 rounded-xl p-3 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight">{f.comprador_nombre}</p>
                      <p className="text-sm text-neutral-600">{asientoDe(f)}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        Tel. {telefonoEnmascarado(f.comprador_telefono)}
                        {f.grupo_id ? ` · compra ${codigoCompra(f.grupo_id)}` : ""}
                        {codigo ? ` · código ${codigo}` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 ${
                        !pagada ? "bg-neutral-100 text-neutral-600" : f.qr_usado ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"
                      }`}
                    >
                      {!pagada ? `No pagada (${f.estado_pago})` : f.qr_usado ? `Ya entró${hora ? ` ${hora}` : ""}` : "Sin usar"}
                    </span>
                  </div>
                  {pagada && !f.qr_usado ? (
                    <Link
                      href={`/acceso/${f.qr_token}`}
                      className="min-h-11 flex items-center justify-center rounded-lg bg-neutral-900 text-white text-sm font-semibold"
                    >
                      Abrir esta entrada
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </main>
    </>
  );
}

async function buscarTexto(service: ReturnType<typeof createServiceClient>, texto: string): Promise<{ filas: Fila[]; error: string | null }> {
  const digitos = texto.replace(/\D/g, "");
  const letras = texto.replace(/[^a-záéíóúñü]/gi, "");
  let query = service.from("tickets").select(COLUMNAS).eq("estado_pago", "verificado");
  if (digitos.length >= 4 && letras.length === 0) {
    query = query.ilike("comprador_telefono", `%${digitos.slice(-4)}%`);
  } else {
    query = query.or(`comprador_nombre.ilike.${patronIlike(texto)}`);
  }
  const { data, error } = await query.order("comprador_nombre", { ascending: true }).limit(30);
  return { filas: (data ?? []) as Fila[], error: error?.message ?? null };
}
