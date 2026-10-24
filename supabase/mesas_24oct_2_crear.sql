-- ===========================================================================
-- Mesas nuevas (Anita, 24 oct) — paso 2 de 2: CREAR.
--
--   VIP           + fila D: 10 mesas × 10 sillas            → 4 filas, 400 sillas
--   Preferencial  + filas 3 y 4: 10 mesas × 8 sillas
--                 + filas 1 y 2: cada mesa pasa de 6 a 8 sillas
--                                                          → 4 filas, 320 sillas
--
-- Decisiones de Anita: máximo 8 Preferencial por compra (una mesa completa),
-- las sillas 7 y 8 de las mesas que ya estaban vendidas se venden libres, y
-- el cupo General sigue en 4.500.
--
-- ORDEN: correr SOLO después de que el código nuevo esté en producción (el
-- que dice "mesas de 8" y deja comprar 8). Con el código viejo funcionaría,
-- pero la tienda diría "mesas de 6" con mesas de 8.
--
-- Seguro de correr con la venta abierta:
--   · Todo va en un solo bloque: si algo falla, no queda nada a medias.
--   · No toca ninguna silla que ya existe ni su estado (vendida o apartada):
--     solo AGREGA mesas y sillas nuevas, todas "disponible".
--   · Idempotente: si se corre dos veces no duplica nada.
--   · Si la fila D ya existiera como Preferencial, o la 3/4 como VIP, se
--     detiene sin cambiar nada.
-- ===========================================================================

do $$
declare
  v_evento_id uuid;
  v_mesa_id uuid;
  v_zona text;
  v_fila text;
  i int;
  j int;
begin
  select id into v_evento_id from public.eventos limit 1;
  if v_evento_id is null then
    raise exception 'No hay evento creado.';
  end if;

  -- 1. VIP: fila D, 10 mesas de 10 sillas.
  for i in 1..10 loop
    select id, zona into v_mesa_id, v_zona
    from public.mesas_vip
    where evento_id = v_evento_id and fila = 'D' and numero = i;

    if v_mesa_id is null then
      insert into public.mesas_vip (evento_id, fila, numero, sillas_total, zona)
      values (v_evento_id, 'D', i, 10, 'vip')
      returning id into v_mesa_id;
    elsif v_zona <> 'vip' then
      raise exception 'La mesa D% ya existe y no es VIP. No se cambió nada.', i;
    end if;

    for j in 1..10 loop
      insert into public.sillas_vip (mesa_id, numero, estado)
      values (v_mesa_id, j, 'disponible')
      on conflict (mesa_id, numero) do nothing;
    end loop;
  end loop;

  -- 2. Preferencial: filas 1 a 4, todas de 8 sillas. En las filas 1 y 2 las
  --    mesas ya existen: se les agregan la 7 y la 8. Las 3 y 4 se crean.
  foreach v_fila in array array['1', '2', '3', '4'] loop
    for i in 1..10 loop
      select id, zona into v_mesa_id, v_zona
      from public.mesas_vip
      where evento_id = v_evento_id and fila = v_fila and numero = i;

      if v_mesa_id is null then
        insert into public.mesas_vip (evento_id, fila, numero, sillas_total, zona)
        values (v_evento_id, v_fila, i, 8, 'preferencial')
        returning id into v_mesa_id;
      elsif v_zona <> 'preferencial' then
        raise exception 'La mesa %-% ya existe y no es Preferencial. No se cambió nada.', v_fila, i;
      else
        update public.mesas_vip set sillas_total = 8 where id = v_mesa_id;
      end if;

      for j in 1..8 loop
        insert into public.sillas_vip (mesa_id, numero, estado)
        values (v_mesa_id, j, 'disponible')
        on conflict (mesa_id, numero) do nothing;
      end loop;
    end loop;
  end loop;
end $$;

-- Verificación. Debe dar:
--   vip           A, B, C, D → 10 mesas · 100 sillas cada fila · 10 por mesa
--   preferencial  1, 2, 3, 4 → 10 mesas · 80 sillas cada fila · 8 por mesa
-- y las "ocupadas" de las filas viejas, IGUALES a las del paso 1.
select
  m.zona,
  m.fila,
  count(distinct m.id)                                   as mesas,
  count(s.id)                                            as sillas,
  count(s.id) filter (where s.estado = 'disponible')     as disponibles,
  count(s.id) filter (where s.estado <> 'disponible')    as ocupadas,
  min(m.sillas_total) || '–' || max(m.sillas_total)      as sillas_por_mesa
from public.mesas_vip m
left join public.sillas_vip s on s.mesa_id = m.id
group by m.zona, m.fila
order by m.zona desc, m.fila;
