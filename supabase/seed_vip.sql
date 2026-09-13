-- =========================================================
-- Mapa VIP — La Navidad Vallenata
-- 50 mesas x 10 sillas = 500 puestos VIP
-- Correr UNA sola vez en el SQL Editor de Supabase, después de schema.sql
-- =========================================================

do $$
declare
  v_evento_id uuid;
  v_mesa_id uuid;
  i int;
  j int;
begin
  select id into v_evento_id from public.eventos limit 1;

  if v_evento_id is null then
    raise exception 'No hay evento creado — corre schema.sql primero.';
  end if;

  for i in 1..50 loop
    insert into public.mesas_vip (evento_id, numero, sillas_total)
    values (v_evento_id, i, 10)
    returning id into v_mesa_id;

    for j in 1..10 loop
      insert into public.sillas_vip (mesa_id, numero, estado)
      values (v_mesa_id, j, 'disponible');
    end loop;
  end loop;
end $$;

-- Verificación rápida: debe devolver 50 y 500
select
  (select count(*) from public.mesas_vip) as mesas,
  (select count(*) from public.sillas_vip) as sillas;
