import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Cliente para Server Components / Route Handlers — respeta la sesión del usuario logueado.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Se puede ignorar si se llama desde un Server Component sin permiso de escritura.
          }
        },
      },
    }
  );
}

// Cliente con service_role — SOLO para operaciones de servidor que necesitan
// saltarse RLS (ej. el cron que envía el QR tras verificar el pago).
// NUNCA exponer esta key al navegador.
import { createClient as createRawClient } from "@supabase/supabase-js";

export function createServiceClient() {
  return createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
