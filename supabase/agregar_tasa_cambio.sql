-- Tasa de cambio EUR/VES vigente (fuente: BCV vía dolarapi.com), actualizada
-- automáticamente todos los días a las 8am hora Venezuela por un cron de Vercel.
create table if not exists public.tasas_cambio (
  id uuid primary key default gen_random_uuid(),
  moneda text not null default 'EUR',
  valor numeric(12, 4) not null,
  actualizado_en timestamptz not null default now()
);

create index if not exists tasas_cambio_moneda_fecha_idx on public.tasas_cambio (moneda, actualizado_en desc);
