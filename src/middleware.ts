import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Protege /ventas, /finanzas, /acceso, /admin — sin sesión, redirige a /login.
// /acceso/[token] (la página que abre el QR en la puerta) NO requiere login a propósito:
// el token largo y aleatorio ya es la prueba de validez, y el personal de acceso
// no debería tener que iniciar sesión parado en la entrada del evento.
const PROTEGIDAS = ["/ventas", "/finanzas", "/admin"];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
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
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
