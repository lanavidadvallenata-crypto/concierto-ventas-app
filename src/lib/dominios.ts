// Un solo lugar para las decisiones de dominio del sistema.
//
// El sitio vive en varios hosts a la vez (lanavidadvallenata.com,
// 618producciones.lanavidadvallenata.com, equipo.lanavidadvallenata.com…) y
// todos sirven la MISMA app contra la MISMA base de datos. El problema es que
// la sesión del equipo (cookie de Supabase) es por host: quien inicia sesión
// en un dominio no queda logueado en los otros. En la práctica eso se veía
// como "me saca al login", "el QR me pide contraseña en la puerta", etc.
//
// Regla: todo lo interno (ventas, finanzas, dashboard, admin, acceso, login)
// vive en UN solo host — el del equipo — y cualquier otro host redirige ahí.
// Lo público (/, /comprar) se sirve desde cualquier dominio sin tocarlo.

export const HOST_EQUIPO = "equipo.lanavidadvallenata.com";
export const URL_EQUIPO = `https://${HOST_EQUIPO}`;

// Dominio raíz: cualquier host que termine así es "nuestro" y se canonicaliza.
// Hosts de preview de Vercel y localhost NO terminan así, y se dejan en paz
// para que el desarrollo y las previews sigan funcionando.
export const DOMINIO_RAIZ = "lanavidadvallenata.com";

export const RUTAS_EQUIPO = ["/ventas", "/taquilla", "/dashboard", "/finanzas", "/admin", "/acceso", "/login"];

export function esHostPropio(host: string) {
  const h = host.split(":")[0].toLowerCase();
  return h === DOMINIO_RAIZ || h.endsWith(`.${DOMINIO_RAIZ}`);
}

export function esRutaEquipo(path: string) {
  return RUTAS_EQUIPO.some((p) => path === p || path.startsWith(`${p}/`));
}
