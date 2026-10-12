-- ===========================================================================
-- Abona618 — pago en cuotas. Tablas nuevas, ADITIVO PURO.
--
-- No altera ninguna tabla existente, no toca una sola fila de `tickets` y no
-- cambia ninguna política. Si algo de esto falla, el sistema de venta sigue
-- funcionando exactamente igual que ahora.
--
-- El plan se amarra a la compra por `grupo_id`, el mismo que ya agrupa los
-- tickets de una compra. Por eso `tickets` no necesita una columna nueva.
--
-- No hay foreign key hacia `tickets` a propósito: `grupo_id` no es único en
-- esa tabla (una compra de 4 entradas son 4 filas con el mismo grupo), así que
-- Postgres no admitiría la referencia. La integridad se valida en el servidor.
--
-- Correr completo en el SQL editor de Supabase. Es idempotente.
-- ===========================================================================

create table if not exists public.planes_pago (
  id                     uuid primary key default gen_random_uuid(),

  -- La compra a la que pertenece el plan: tickets.grupo_id.
  grupo_id               uuid not null unique,

  total_usd              numeric(10,2) not null check (total_usd > 0),
  tipo                   text not null check (tipo in ('vip','general')),
  cantidad               smallint not null check (cantidad > 0),

  -- al_dia → en_mora (lo marca el cron cuando algo vence) → vencido/anulado
  -- completado = pagó el 100 %, ya se le mandaron los QR
  -- vencido    = lo anuló una persona desde Cobranza por falta de pago
  -- anulado    = lo anuló una persona desde Finanzas (rechazo de la compra)
  -- El cron NUNCA anula (Anita, 12 oct): detecta, marca en mora y avisa.
  estado                 text not null default 'al_dia'
                         check (estado in ('al_dia','en_mora','vencido','completado','anulado')),

  -- Sello de aceptación del disclaimer. El correo de anulación lo cita tal
  -- cual: "las condiciones que aceptaste el 12 de octubre a las 3:42 p. m.".
  -- La versión queda guardada por si las condiciones cambian después: a cada
  -- comprador se le reclama lo que aceptó él, no lo que diga la página hoy.
  acepto_condiciones_en  timestamptz not null default now(),
  condiciones_version    text not null default 'v1',

  creado_por             uuid,
  canal                  text,
  creado_en              timestamptz not null default now(),
  completado_en          timestamptz,
  anulado_en             timestamptz,
  anulado_por            uuid,
  notas                  text
);

create table if not exists public.cuotas (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.planes_pago(id) on delete cascade,

  -- 1 es siempre la inicial. Máximo 3 pagos con el calendario actual; el
  -- margen hasta 4 es para no tener que migrar si se agrega una fecha.
  orden            smallint not null check (orden between 1 and 4),
  etiqueta         text not null,
  porcentaje       numeric(5,4) not null check (porcentaje > 0 and porcentaje <= 1),
  monto_usd        numeric(10,2) not null check (monto_usd > 0),

  -- La fecha queda congelada por fila: si el calendario del evento cambia,
  -- los planes ya vendidos conservan las fechas que el comprador aceptó.
  vence_el         date not null,

  -- Tres momentos distintos, que no hay que confundir:
  --   reportado_en  → el comprador dice que pagó (todavía no es plata)
  --   verificado_en → Finanzas vio el dinero en el banco. ESTO es "pagada".
  reportado_en     timestamptz,
  verificado_en    timestamptz,
  verificado_por   uuid,

  monto_bs         numeric(14,2),
  tasa_aplicada    numeric(14,4),
  metodo_pago      text,
  referencia_pago  text,

  -- Para que el cron no mande dos veces el mismo aviso el mismo día.
  ultimo_aviso_en  timestamptz,
  avisos_enviados  smallint not null default 0,

  unique (plan_id, orden)
);

-- Índices --------------------------------------------------------------------

create index if not exists planes_pago_estado_idx
  on public.planes_pago (estado);

-- Contar las VIP que están ocupando el tope de 100, sin escanear la tabla.
create index if not exists planes_pago_vip_activos_idx
  on public.planes_pago (tipo, estado)
  where tipo = 'vip' and estado in ('al_dia','en_mora','completado');

create index if not exists cuotas_plan_idx
  on public.cuotas (plan_id);

-- El cron diario busca exactamente esto: cuotas sin verificar por fecha.
create index if not exists cuotas_pendientes_idx
  on public.cuotas (vence_el)
  where verificado_en is null;

-- Finanzas: lo que el comprador reportó y nadie ha verificado todavía.
create index if not exists cuotas_reportadas_idx
  on public.cuotas (reportado_en)
  where verificado_en is null and reportado_en is not null;

-- Permisos -------------------------------------------------------------------
-- RLS activo SIN políticas = nadie entra por la Data API. Solo el servidor,
-- con la service role key. Los grants explícitos son obligatorios desde el
-- cambio de la Data API de octubre de 2026.

alter table public.planes_pago enable row level security;
alter table public.cuotas      enable row level security;

revoke all on public.planes_pago from anon, authenticated;
revoke all on public.cuotas      from anon, authenticated;
grant  all on public.planes_pago to service_role;
grant  all on public.cuotas      to service_role;

-- Documentación en la propia base ---------------------------------------------

comment on table public.planes_pago is
  'Abona618: un plan de pago en cuotas por compra. Se amarra a tickets por grupo_id.';
comment on table public.cuotas is
  'Abona618: los pagos de un plan. orden 1 es la inicial. Pagada = verificado_en no nulo.';

-- ===========================================================================
-- Interruptor y tope editables sin redeploy.
-- ===========================================================================

create table if not exists public.abona618_config (
  -- Una sola fila, siempre id = 1. El check impide que alguien cree una
  -- segunda configuración y el sistema lea la equivocada.
  id                      smallint primary key default 1 check (id = 1),

  activo                  boolean  not null default false,

  tope_vip                smallint not null default 100 check (tope_vip >= 0),
  aviso_tope_vip          smallint not null default 90  check (aviso_tope_vip >= 0),

  -- Para que el cron avise UNA vez al cruzar el umbral y no todos los días.
  -- Al subir el tope, poner este campo en null para volver a ser avisada.
  aviso_tope_enviado_en   timestamptz,

  actualizado_en          timestamptz not null default now(),

  constraint aviso_menor_que_tope check (aviso_tope_vip <= tope_vip)
);

insert into public.abona618_config (id) values (1) on conflict (id) do nothing;

alter table public.abona618_config enable row level security;
revoke all on public.abona618_config from anon, authenticated;
grant  all on public.abona618_config to service_role;

comment on table public.abona618_config is
  'Abona618: interruptor general y tope de VIP en plan. Una sola fila (id = 1).';

-- Para encender el módulo cuando todo esté probado:
--   update public.abona618_config set activo = true, actualizado_en = now() where id = 1;
--
-- Para apagarlo de emergencia:
--   update public.abona618_config set activo = false, actualizado_en = now() where id = 1;
--
-- Para subir el tope de VIP en plan de 100 a 150 y volver a recibir aviso:
--   update public.abona618_config
--      set tope_vip = 150, aviso_tope_vip = 140,
--          aviso_tope_enviado_en = null, actualizado_en = now()
--    where id = 1;

-- PostgREST tiene que ver las tablas nuevas o el servidor responde
-- "relation does not exist" y el módulo queda cerrado sin decir por qué.
notify pgrst, 'reload schema';
