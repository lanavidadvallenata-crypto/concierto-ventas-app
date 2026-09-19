-- =========================================================
-- Feedback del equipo (19 sep 2026): compra múltiple, preventa, taquilla,
-- precio en Bs fijado en el ticket.
--
-- CORRER ANTES de desplegar el código que lo usa. Es seguro ejecutarlo
-- más de una vez.
-- =========================================================

alter table public.tickets
  -- Agrupa los tickets de una misma compra (varias sillas / varias generales
  -- con una sola referencia de pago). Finanzas verifica el grupo completo.
  add column if not exists grupo_id uuid,
  -- Monto en bolívares que se le dijo al comprador que pagara, y la tasa con
  -- la que se calculó. Se fija al comprar; no cambia si la tasa cambia después.
  add column if not exists precio_bs numeric(14,2),
  add column if not exists tasa_aplicada numeric(12,4),
  -- Etapa de precio con la que se vendió (preventa / regular). Sirve para
  -- contar el cupo de preventa.
  add column if not exists etapa text not null default 'regular',
  -- Por dónde entró: web (comprador), manual (vendedor por WhatsApp), taquilla
  -- (boleto físico el día del evento, sin QR).
  add column if not exists canal text not null default 'web';

-- Tickets anteriores registrados por un vendedor: canal manual.
update public.tickets set canal = 'manual' where vendido_por is not null and canal = 'web';

-- Cada ticket viejo sin grupo es su propio grupo.
update public.tickets set grupo_id = id where grupo_id is null;

create index if not exists tickets_grupo_id_idx on public.tickets (grupo_id);
create index if not exists tickets_etapa_tipo_idx on public.tickets (etapa, tipo, estado_pago);

-- Métodos nuevos: efectivo en dólares y en bolívares (taquilla / manual).
alter table public.tickets drop constraint if exists tickets_metodo_pago_check;
alter table public.tickets
  add constraint tickets_metodo_pago_check
  check (metodo_pago in ('pago_movil', 'transferencia', 'zelle', 'binance', 'efectivo_usd', 'efectivo_bs'));

alter table public.tickets drop constraint if exists tickets_etapa_check;
alter table public.tickets add constraint tickets_etapa_check check (etapa in ('preventa', 'regular'));

alter table public.tickets drop constraint if exists tickets_canal_check;
alter table public.tickets add constraint tickets_canal_check check (canal in ('web', 'manual', 'taquilla'));

notify pgrst, 'reload schema';

-- Verificación: debe listar grupo_id, precio_bs, tasa_aplicada, etapa, canal
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'tickets'
  and column_name in ('grupo_id', 'precio_bs', 'tasa_aplicada', 'etapa', 'canal')
order by column_name;
