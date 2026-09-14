-- Bloqueo temporal de sillas VIP mientras el comprador público completa el pago.
-- reservado_hasta = NULL  -> sin bloqueo activo (disponible, o vendida/reservada permanente con ticket)
-- reservado_hasta > now() -> bloqueada temporalmente, nadie más puede tomarla
-- reservado_hasta < now() -> bloqueo vencido, se trata como disponible de nuevo (limpieza perezosa,
--                             sin necesidad de un cron corriendo cada minuto)
alter table public.sillas_vip
  add column if not exists reservado_hasta timestamptz;

-- Limpieza perezosa: libera cualquier silla cuyo bloqueo ya venció y que todavía no tiene
-- un ticket asociado (si ya tiene ticket, reservado_hasta se dejó en NULL al crear el ticket
-- y esta consulta no la toca).
create or replace function public.liberar_sillas_vencidas()
returns void
language sql
as $$
  update public.sillas_vip
  set estado = 'disponible', reservado_hasta = null
  where estado = 'reservada'
    and reservado_hasta is not null
    and reservado_hasta < now();
$$;
