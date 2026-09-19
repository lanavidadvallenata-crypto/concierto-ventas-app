import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { HOST_EQUIPO, esHostPropio, esRutaEquipo } from "@/lib/dominios";

// Protege /ventas, /dashboard, /finanzas, /acceso, /admin — sin sesión, redirige a /login.
// /acceso/[token] (la página que abre el QR en la puerta) SÍ requiere login:
// el token aleatorio prueba que el TICKET es válido, pero no prueba que quien
// lo está escaneando es parte del equipo — sin este gate, cualquiera que
// consiga ver/fotografiar el QR de otra persona (por ejemplo, en la fila)
// podría abrir el link él mismo y "quemar" esa entrada antes de que su dueño
// llegue a la puerta. El personal de acceso inicia sesión UNA vez (antes de
// que abran las puertas, con buena señal) y la sesión queda guardada en su
// teléfono para todo el evento — no tiene que volver a loguearse entre cada
// escaneo.
const PROTEGIDAS = ["/ventas", "/dashboard", "/finanzas", "/admin", "/acceso"];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase();

  // Un solo host para todo lo interno (ver src/lib/dominios.ts). Si alguien del
  // equipo abre /finanzas, /ventas, el login o un QR desde lanavidadvallenata.com
  // o desde 618producciones.*, lo mandamos al host del equipo, que es donde
  // vive su sesión. Así una sola vez que inician sesión les sirve para todo:
  // ventas, finanzas, dashboard y escanear en la puerta.
  if (esHostPropio(host) && host !== HOST_EQUIPO && esRutaEquipo(path)) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = HOST_EQUIPO;
    url.port = "";
    return NextResponse.redirect(url, 307);
  }

  // Subdominio del equipo: al entrar por la raíz debe mandar directo al login
  // del equipo (o a /ventas si ya hay sesión — eso lo decide /login abajo) en
  // vez de mostrar el home público de compradores.
  if (host === HOST_EQUIPO && path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const esProtegida = PROTEGIDAS.some((p) => path.startsWith(p));

  // El 100% del tráfico público (/, /comprar) pasaba por aquí y disparaba una
  // llamada a Supabase Auth por cada visita, aunque esas rutas no la necesitan.
  // En una venta con pico de tráfico ("hora cero") eso multiplica innecesariamente
  // la carga sobre Supabase justo cuando más importa que aguante. Si la ruta no
  // está protegida ni es /login, no tocamos Supabase para nada.
  if (!esProtegida && path !== "/login") {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (esProtegida && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (path === "/login" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/ventas";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
