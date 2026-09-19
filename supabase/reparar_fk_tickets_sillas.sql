-- =========================================================
-- Reparar la relación tickets → sillas_vip
--
-- seed_vip.sql hizo `drop table public.sillas_vip cascade` y la volvió a
-- crear. El CASCADE eliminó la clave foránea tickets.silla_id → sillas_vip(id)
-- (y reservas.silla_id → sillas_vip) y nunca se recrearon. Sin esa FK,
-- Supabase no puede "embeber" sillas_vip dentro de una consulta de tickets,
-- y Finanzas/puerta fallaban con "No se encontró ese ticket" / "YA USADO".
--
-- La app ya NO depende de esta FK (consulta silla y mesa por separado), pero
-- conviene restaurarla por integridad: impide que un ticket apunte a una
-- silla que no existe.
--
-- Correr en el SQL Editor de Supabase cuando haya acceso. Es seguro
-- ejecutarlo más de una vez.
-- =========================================================

-- 1) Diagnóstico: ¿existe la FK hoy?
select conname, conrelid::regclass as tabla, confrelid::regclass as referencia
from pg_constraint
where contype = 'f' and conrelid = 'public.tickets'::regclass;

-- 2) Tickets huérfanos (apuntan a una silla que ya no existe porque el seed
--    regeneró las sillas con IDs nuevos). Son tickets de prueba anteriores al
--    seed; se les quita la silla para poder crear la FK. Revisar la lista
--    antes de correr el UPDATE.
select t.id, t.comprador_nombre, t.estado_pago, t.created_at
from public.tickets t
left join public.sillas_vip s on s.id = t.silla_id
where t.silla_id is not null and s.id is null;

update public.tickets t
set silla_id = null
where t.silla_id is not null
  and not exists (select 1 from public.sillas_vip s where s.id = t.silla_id);

-- 3) Recrear la FK (idempotente)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_silla_id_fkey'
  ) then
    alter table public.tickets
      add constraint tickets_silla_id_fkey
      foreign key (silla_id) references public.sillas_vip(id);
  end if;
end $$;

-- 4) Que PostgREST recargue su caché de relaciones (Supabase lo hace solo al
--    cambiar el schema, pero por si acaso):
notify pgrst, 'reload schema';

-- 5) Verificación: debe devolver una fila tickets_silla_id_fkey
select conname, conrelid::regclass as tabla, confrelid::regclass as referencia
from pg_constraint
where conname = 'tickets_silla_id_fkey';
