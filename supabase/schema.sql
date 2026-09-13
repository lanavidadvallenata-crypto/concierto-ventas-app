-- =========================================================
-- La Navidad Vallenata — Sistema de venta de boletería
-- Schema Supabase (Postgres)
-- Replica la lógica ya probada del sistema anterior (Artifacts),
-- ahora sobre infraestructura propia del evento (sin cuentas de Claude)
-- =========================================================

-- Roles del equipo: ventas, finanzas, admin, acceso
create type public.role_evento as enum ('ventas', 'finanzas', 'admin', 'acceso');

create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol public.role_evento not null default 'ventas',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Evento (preparado para más de uno a futuro, aunque hoy es solo este)
create table public.eventos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null default 'La Navidad Vallenata',
  fecha date not null default '2026-12-04',
  venue text not null default 'Hangar Grano de Oro',
  ciudad text not null default 'Maracaibo',
  aforo_general_total int not null default 4500,
  created_at timestamptz not null default now()
);

-- Mapa VIP: filas (A, B, C...) con mesas numeradas 1-10 repetidas por fila
create table public.mesas_vip (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  fila text not null,
  numero int not null,
  sillas_total int not null default 10,
  unique (evento_id, fila, numero)
);

create table public.sillas_vip (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid not null references public.mesas_vip(id) on delete cascade,
  numero int not null,
  estado text not null default 'disponible' check (estado in ('disponible', 'reservada', 'vendida')),
  unique (mesa_id, numero)
);

-- Inventario general (no numerado, solo contador de cupo)
-- El control real de cuánto queda se calcula: aforo_general_total - count(tickets tipo general no cancelados)

-- Reservas temporales (hold de 45 min mientras se verifica el pago)
create table public.reservas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('vip', 'general')),
  silla_id uuid references public.sillas_vip(id),
  cantidad_general int, -- solo aplica si tipo = 'general'
  reservado_por uuid references public.perfiles(id),
  expira_en timestamptz not null default (now() + interval '45 minutes'),
  estado text not null default 'activa' check (estado in ('activa', 'confirmada', 'vencida', 'cancelada')),
  created_at timestamptz not null default now()
);

-- Tickets vendidos (uno por comprador; si compra varios generales, uno por asistente)
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  tipo text not null check (tipo in ('vip', 'general')),
  silla_id uuid references public.sillas_vip(id), -- solo si tipo = 'vip'

  comprador_nombre text not null,
  comprador_telefono text not null,
  comprador_email text,

  precio numeric(10,2) not null,
  moneda text not null default 'USD',
  metodo_pago text not null check (metodo_pago in ('pago_movil', 'transferencia', 'zelle', 'binance')),
  referencia_pago text,

  estado_pago text not null default 'pendiente' check (estado_pago in ('pendiente', 'verificado', 'rechazado')),
  verificado_por uuid references public.perfiles(id),
  verificado_en timestamptz,

  -- Control cruzado anti-fraude: quien vende no puede verificar su propia venta
  vendido_por uuid references public.perfiles(id) not null,

  -- QR seguro: token generado con crypto (no Math.random), nunca el ID de la silla directo
  qr_token text unique,
  qr_enviado_en timestamptz,
  qr_usado boolean not null default false,
  qr_usado_en timestamptz,
  qr_usado_por uuid references public.perfiles(id),

  created_at timestamptz not null default now()
);

create index on public.tickets (estado_pago);
create index on public.tickets (qr_token);

-- Bitácora de acceso en puerta (escaneo)
create table public.accesos (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets(id),
  resultado text not null check (resultado in ('valido', 'ya_usado', 'invalido')),
  escaneado_por uuid references public.perfiles(id),
  escaneado_en timestamptz not null default now()
);

-- =========================================================
-- Regla de negocio crítica (constraint a nivel de app, documentada aquí):
-- verificado_por debe ser distinto de vendido_por (Finanzas separado de Ventas).
-- Se aplica en el backend, no en SQL, porque necesita comparar contra el usuario
-- autenticado en el momento de la acción.
-- =========================================================

-- RLS: cada rol ve y hace solo lo suyo. Se activa cuando se conecten credenciales reales.
alter table public.tickets enable row level security;
alter table public.perfiles enable row level security;
alter table public.accesos enable row level security;
-- Políticas detalladas se añaden en la fase de conexión con Supabase real (ver README).
