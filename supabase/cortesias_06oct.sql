-- Módulo Cortesías (6 oct 2026) — solo AGREGA.
--
-- Problema que resuelve: el sistema sabía emitir entradas sin cobrar, pero esa
-- capacidad estaba amarrada a Patrocinios, que obliga a registrar un monto y a
-- elegir uno de los dos paquetes fijos. Un canje con un influencer o el premio
-- de un sorteo ocupan aforo real pero NO son dinero y NO son patrocinio:
-- meterlos ahí descuadra la recaudación contra el banco.
--
-- Qué hace:
--   1. Permite el canal 'cortesia' y el método 'cortesia' en tickets.
--   2. Crea la tabla cortesias (beneficiario, motivo, detalle, entradas).
--
-- Seguro de correr con la venta abierta: no bloquea escrituras y el
-- CREATE TABLE es nuevo.

-- 1. Canal y método nuevos ----------------------------------------------------
alter table public.tickets drop constraint if exists tickets_canal_check;
alter table public.tickets
  add constraint tickets_canal_check
  check (canal in ('web', 'manual', 'taquilla', 'patrocinio', 'cortesia'));

-- 'cortesia' como método es el que dice "aquí no hubo pago". Es más honesto
-- que falsear un efectivo que nunca entró.
alter table public.tickets drop constraint if exists tickets_metodo_pago_check;
alter table public.tickets
  add constraint tickets_metodo_pago_check
  check (metodo_pago in ('pago_movil', 'transferencia', 'zelle', 'binance',
                         'efectivo_usd', 'efectivo_bs', 'cortesia'));

-- 2. Tabla de cortesías -------------------------------------------------------
create table if not exists public.cortesias (
  id uuid primary key default gen_random_uuid(),
  beneficiario text not null,
  motivo text not null check (motivo in ('canje', 'sorteo', 'prensa', 'staff', 'invitacion', 'otro')),
  -- Por qué se dio: "3 reels en IG", "ganadora del sorteo del 5 oct".
  detalle text,
  contacto_email text not null,
  contacto_telefono text,
  cantidad_vip integer not null default 0 check (cantidad_vip >= 0),
  cantidad_general integer not null default 0 check (cantidad_general >= 0),
  -- Una cortesía mixta emite dos grupos de tickets (uno VIP, uno general).
  grupos uuid[] not null default '{}',
  notas text,
  anulado_en timestamptz,
  anulado_por uuid,
  creado_por uuid not null,
  creado_en timestamptz not null default now(),
  constraint cortesias_al_menos_una check (cantidad_vip + cantidad_general > 0)
);

create index if not exists cortesias_creado_en_idx on public.cortesias (creado_en desc);
create index if not exists cortesias_motivo_idx on public.cortesias (motivo);

-- RLS encendida y SIN policies: solo el servidor (service role), que además
-- exige rol admin.
alter table public.cortesias enable row level security;

-- Permisos explícitos del Data API (cambio Supabase del 30 oct 2026).
-- Solo service_role: anon y authenticated no reciben nada, a propósito.
grant select, insert, update, delete on public.cortesias to service_role;

-- Verificación ---------------------------------------------------------------
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conname in ('tickets_canal_check', 'tickets_metodo_pago_check');
-- select count(*) from public.cortesias;
