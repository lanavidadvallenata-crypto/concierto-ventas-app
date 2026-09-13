import { createBrowserClient } from "@supabase/ssr";

// Cliente para componentes de navegador (formularios, dashboard en vivo).
// Usa la anon key — segura para exponer al cliente porque RLS controla el acceso real.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
