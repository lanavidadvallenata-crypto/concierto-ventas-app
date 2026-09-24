-- Módulo Patrocinantes (24 sep 2026) — solo AGREGA. No toca ninguna tabla ni
-- constraint de las que usan el checkout público, Finanzas, Ventas o Acceso.
--
-- Qué hace:
--   1. Permite el canal 'patrocinio' en tickets (antes: web, manual, taquilla).
--   2. Crea la tabla patrocinantes (datos de la empresa, monto y referencia).
--
-- Seguro de correr con la venta abierta: no bloquea escrituras (ALTER de un
-- CHECK solo revalida filas existentes, todas cumplen) y el CREATE TABLE es nuevo.

-- 1. Canal nuevo -------------------------------------------------------------
alter table public.tickets drop constraint if exists tickets_canal_check;
alter table public.tickets
  add constraint tickets_canal_check check (canal in ('web', 'manual', 'taquilla', 'patrocinio'));

-- 2. Tabla de patrocinantes ---------------------------------------------------
create table if not exists public.patrocinantes (
  id uuid primary key default gen_random_uuid(),
  empresa text not null,
  contacto_nombre text not null,
  contacto_telefono text,
  contacto_email text not null,
  paquete text not null check (paquete in ('aliado', 'oficial')),
  monto_usd numeric(12,2) not null check (monto_usd >= 0),
  metodo_pago text not null,
  referencia_pago text,
  monto_bs numeric(14,2),
  tasa_aplicada numeric(14,4),
  -- Grupo de tickets de cortesía emitido para este patrocinante.
  grupo_id uuid,
  notas text,
  anulado_en timestamptz,
  anulado_por uuid,
  creado_por uuid not null,
  creado_en timestamptz not null default now()
);

create index if not exists patrocinantes_creado_en_idx on public.patrocinantes (creado_en desc);
create index if not exists patrocinantes_grupo_idx on public.patrocinantes (grupo_id);

-- RLS encendida y SIN policies: nadie con la clave pública puede leer ni
-- escribir. Solo el servidor (service role), que además exige rol admin.
alter table public.patrocinantes enable row level security;

-- 3. Permisos explícitos del Data API ----------------------------------------
-- Desde el 30 oct 2026 Supabase deja de dar permisos automáticos a las tablas
-- nuevas del schema public, así que se declaran aquí mismo. A propósito SOLO
-- se le da a service_role (el servidor, que además exige rol admin):
-- 'anon' y 'authenticated' NO reciben nada, para que esta tabla sea
-- inalcanzable desde el navegador incluso con la clave pública.
grant select, insert, update, delete on public.patrocinantes to service_role;

-- Verificación ---------------------------------------------------------------
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'tickets_canal_check';
-- select count(*) from public.patrocinantes;
-- select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'patrocinantes';
