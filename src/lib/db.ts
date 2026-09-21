import type { SupabaseClient } from "@supabase/supabase-js";

// PostgREST en Supabase devuelve como máximo 1.000 filas por consulta y NO
// avisa (db-max-rows). Con 4.500 generales + 300 VIP, el dashboard se
// quedaba "congelado" a partir del ticket 1.001. Este helper pagina con
// .range() hasta traer todo.
//
// `filtros` recibe el builder ya con .select() y devuelve el builder con los
// .eq()/.order() que hagan falta (tipado laxo a propósito: los genéricos de
// PostgrestFilterBuilder no se dejan pasar como parámetro sin pelear).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Builder = any;

export async function seleccionarTodo<T extends Record<string, unknown>>(
  service: SupabaseClient,
  tabla: string,
  columnas: string,
  filtros?: (q: Builder) => Builder
): Promise<{ data: T[]; error: string | null }> {
  const PAGINA = 1000;
  const todo: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    let q: Builder = service.from(tabla).select(columnas);
    if (filtros) q = filtros(q);
    const { data, error } = (await q.range(desde, desde + PAGINA - 1)) as { data: T[] | null; error: { message: string } | null };
    if (error) return { data: todo, error: error.message };
    const filas = data ?? [];
    todo.push(...filas);
    if (filas.length < PAGINA) break;
  }
  return { data: todo, error: null };
}
