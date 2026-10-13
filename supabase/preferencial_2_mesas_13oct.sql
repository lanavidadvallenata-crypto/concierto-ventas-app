-- ===========================================================================
-- Zona PREFERENCIAL — paso 2 de 2: las 20 mesas (Anita, 13 oct)
--
-- Correr SOLO después de preferencial_1_estructura_13oct.sql Y de que el
-- código nuevo esté en producción. En cuanto esto corre, la pestaña
-- "Preferencial" aparece sola en lanavidadvallenata.com/comprar.
--
-- 2 filas ("1" y "2") × 10 mesas × 6 sillas = 120 puestos a $70.
-- La fila se guarda como "1" y "2" (no choca con A, B, C del VIP) y en
-- pantalla se lee "Preferencial · Fila 1 · Mesa 4 · Silla 3".
--
-- Idempotente: si una mesa ya existe no la duplica (ni sus sillas).
-- ===========================================================================

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

  foreach v_fila in array array['1', '2'] loop
    for i in 1..10 loop
      select id into v_mesa_id
      from public.mesas_vip
      where evento_id = v_evento_id and fila = v_fila and numero = i;

      if v_mesa_id is null then
        insert into public.mesas_vip (evento_id, fila, numero, sillas_total, zona)
        values (v_evento_id, v_fila, i, 6, 'preferencial')
        returning id into v_mesa_id;
      else
        update public.mesas_vip set zona = 'preferencial', sillas_total = 6 where id = v_mesa_id;
      end if;

      for j in 1..6 loop
        insert into public.sillas_vip (mesa_id, numero, estado)
        values (v_mesa_id, j, 'disponible')
        on conflict (mesa_id, numero) do nothing;
      end loop;
    end loop;
  end loop;
end $$;

-- Verificación: preferencial = 20 mesas / 120 sillas; vip = 30 / 300.
select m.zona, count(distinct m.id) as mesas, count(s.id) as sillas
from public.mesas_vip m
left join public.sillas_vip s on s.mesa_id = m.id
group by m.zona
order by m.zona;
