-- ===========================================================================
-- Zona PREFERENCIAL — paso 1 de 2: la estructura (Anita, 13 oct)
--
-- Entre VIP ($140) y General ($30) se abre una zona de mesas redondas de 6
-- puestos a $70 por persona: 2 filas × 10 mesas × 6 = 120 puestos. Salen de
-- las 200 VIP que estaban guardadas (filas D y E): quedan 80 de reserva.
--
-- Las mesas y sillas Preferencial viven en las MISMAS tablas que las VIP
-- (mesas_vip / sillas_vip) con una columna nueva `zona`. Así el mapa, el
-- bloqueo de 15 minutos mientras pagan, el índice de "una silla, un ticket
-- vivo" y el QR con asiento funcionan igual sin duplicar nada.
--
-- ORDEN OBLIGATORIO (para no tocar lo que está vendiendo):
--   1. Correr ESTE archivo. Es inofensivo con el código actual: solo amplía
--      los tipos permitidos y agrega la columna `zona` con valor 'vip' para
--      todas las mesas que ya existen. No crea mesas.
--   2. Subir el código nuevo (lee `zona`).
--   3. Correr preferencial_2_mesas_13oct.sql, que crea las 20 mesas.
--      Si se corriera ANTES del código nuevo, el mapa VIP de hoy mostraría
--      las mesas nuevas como si fueran VIP a $140.
--
-- Idempotente: se puede correr dos veces sin daño.
-- ===========================================================================

-- 1. Los tres lugares que limitan el tipo de entrada.
alter table public.tickets drop constraint if exists tickets_tipo_check;
alter table public.tickets
  add constraint tickets_tipo_check check (tipo in ('vip', 'preferencial', 'general'));

alter table public.reservas drop constraint if exists reservas_tipo_check;
alter table public.reservas
  add constraint reservas_tipo_check check (tipo in ('vip', 'preferencial', 'general'));

alter table public.planes_pago drop constraint if exists planes_pago_tipo_check;
alter table public.planes_pago
  add constraint planes_pago_tipo_check check (tipo in ('vip', 'preferencial', 'general'));

-- 2. La zona de cada mesa. Todo lo existente es VIP.
alter table public.mesas_vip
  add column if not exists zona text not null default 'vip';

alter table public.mesas_vip drop constraint if exists mesas_vip_zona_check;
alter table public.mesas_vip
  add constraint mesas_vip_zona_check check (zona in ('vip', 'preferencial'));

create index if not exists mesas_vip_zona_idx on public.mesas_vip (zona);

-- Verificación: debe devolver 0 mesas preferencial todavía, y todas 'vip'.
select zona, count(*) as mesas
from public.mesas_vip
group by zona;
