-- ===========================================================================
-- Mesas nuevas (Anita, 24 oct) — paso 1 de 2: REVISAR. Solo lee, no cambia nada.
--
-- Hoy debería verse:
--   vip           A, B, C   → 10 mesas y 100 sillas cada fila
--   preferencial  1, 2      → 10 mesas y 60 sillas cada fila
-- y NO debe existir todavía la fila D en VIP ni las filas 3 y 4 en Preferencial.
-- Si ves algo distinto, no corras el paso 2: manda captura.
-- ===========================================================================

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
