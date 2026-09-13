-- =========================================================
-- Ampliación del VIP — filas D y E (100 sillas cada una)
-- Corre esto SOLO cuando decidas ampliar el aforo VIP más allá
-- de las 300 iniciales (A, B, C), según el movimiento de venta.
-- Lleva el total VIP de 300 a 500.
-- =========================================================

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
    raise exception 'No hay evento creado.';
  end if;

  foreach v_fila in array array['D', 'E'] loop
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

-- Verificación: debe devolver mesas=50, sillas=500
select
  (select count(*) from public.mesas_vip) as mesas,
  (select count(*) from public.sillas_vip) as sillas;
