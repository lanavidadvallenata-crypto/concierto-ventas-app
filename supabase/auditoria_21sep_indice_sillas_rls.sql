-- =========================================================
-- Auditoría 21 sep 2026 — dos candados en la base de datos.
-- Seguro de correr más de una vez. Correr en el SQL Editor de Supabase.
-- =========================================================

-- 1) Una silla no puede tener dos tickets vivos a la vez.
--    El código ya evita esto en el 99,9 % de los casos (reservas atómicas),
--    pero este índice lo hace imposible aunque dos compras se crucen en el
--    mismo milisegundo: la segunda falla con 23505 y la app le dice al
--    comprador que elija otra silla.
--    Antes de crearlo, si hubiera duplicados viejos (pruebas), quedarían
--    listados aquí; hay que rechazar uno de cada par antes de continuar.
select silla_id, count(*) as tickets_vivos
from public.tickets
where silla_id is not null and estado_pago <> 'rechazado'
group by silla_id
having count(*) > 1;

create unique index if not exists tickets_silla_viva_uq
  on public.tickets (silla_id)
  where silla_id is not null and estado_pago <> 'rechazado';

-- 2) RLS en TODAS las tablas del schema public. Las tablas creadas por
--    schema.sql/seed_vip.sql ya lo tienen; las que se agregaron después
--    (tasas_cambio, intentos_checkout) y eventos/reservas se aseguran aquí.
--    Sin políticas, RLS activo = solo el service role (servidor) puede leer
--    o escribir; la anon key del navegador no ve nada. (Verificado el 21 sep
--    que la anon key ya devolvía [] en todas: este paso es por si acaso.)
alter table public.eventos           enable row level security;
alter table public.reservas          enable row level security;
alter table public.tasas_cambio      enable row level security;
alter table public.intentos_checkout enable row level security;
alter table public.tickets           enable row level security;
alter table public.perfiles          enable row level security;
alter table public.accesos           enable row level security;
alter table public.mesas_vip         enable row level security;
alter table public.sillas_vip        enable row level security;

notify pgrst, 'reload schema';

-- Verificación: todas con rls = true, y el índice presente.
select c.relname as tabla, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

select indexname from pg_indexes where indexname = 'tickets_silla_viva_uq';
