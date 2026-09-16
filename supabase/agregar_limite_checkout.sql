-- Registro de intentos de checkout público, para frenar bots/abuso con un
-- límite simple por IP (ver src/lib/rate-limit.ts). No se auto-purga; pesa
-- poco (una fila liviana por intento) y se puede limpiar más adelante si
-- hace falta.
create table public.intentos_checkout (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  accion text not null,
  creado_en timestamptz not null default now()
);

create index on public.intentos_checkout (ip, accion, creado_en desc);
