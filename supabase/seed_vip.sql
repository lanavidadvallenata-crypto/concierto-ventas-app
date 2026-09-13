-- =========================================================
-- Mapa VIP — La Navidad Vallenata
-- Estructura real: filas A, B, C (mesa 1-5 izquierda del pasillo,
-- mesa 6-10 derecha), 10 sillas por mesa = 300 VIP para el arranque.
-- Filas D y E quedan reservadas para cuando decidas ampliar hasta 500
-- (correr supabase/expandir_vip_d_e.sql en ese momento, no antes).
--
-- IMPORTANTE: este script reemplaza mesas_vip y sillas_vip desde cero.
-- Solo córrelo si esas tablas todavía están vacías (no has vendido nada).
-- Corre esto completo UNA sola vez en el SQL Editor de Supabase,
-- después de schema.sql.
-- =========================================================

drop table if exists public.sillas_vip cascade;
drop table if exists public.mesas_vip cascade;

create table public.mesas_vip (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  fila text not null,
  numero int not null,
  sillas_total int not null default 10,
  unique (evento_id, fila, numero)
);

create table public.sillas_vip (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid not null references public.mesas_vip(id) on delete cascade,
  numero int not null,
  estado text not null default 'disponible' check (estado in ('disponible', 'reservada', 'vendida')),
  unique (mesa_id, numero)
);

alter table public.mesas_vip enable row level security;
alter table public.sillas_vip enable row level security;

do $$
declare
  v_evento_id uuid;
  v_mesa_id uuid;
  v_fila text;
  i int;
  j int;
begin
  select id into v_evento_id from public.eventos limit 1;

  if v_evento_id is null then
    raise exception 'No hay evento creado — corre schema.sql primero.';
  end if;

  foreach v_fila in array array['A', 'B', 'C'] loop
    for i in 1..10 loop
      insert into public.mesas_vip (evento_id, fila, numero, sillas_total)
      values (v_evento_id, v_fila, i, 10)
      returning id into v_mesa_id;

      for j in 1..10 loop
        insert into public.sillas_vip (mesa_id, numero, estado)
        values (v_mesa_id, j, 'disponible');
      end loop;
    end loop;
  end loop;
end $$;

-- Verificación rápida: debe devolver mesas=30, sillas=300
select
  (select count(*) from public.mesas_vip) as mesas,
  (select count(*) from public.sillas_vip) as sillas;
