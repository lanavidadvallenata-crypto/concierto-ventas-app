-- ===========================================================================
-- Abona618 — endurecimiento después de la auditoría del 12 de octubre.
--
-- `abona618_12oct.sql` usa `create table if not exists`, que es idempotente
-- pero NO migrable: si se le agregan constraints y se vuelve a correr sobre
-- las tablas ya creadas, el bloque entero se salta en silencio y las
-- constraints nunca llegan. Por eso van aquí, con ALTER.
--
-- Lo que añade son redes de seguridad para estados que el código ya no
-- produce, pero que la base permitía: un plan "completado" sin fecha de
-- completado, un plan "anulado" sin fecha de anulación, un pago verificado
-- antes de haber sido reportado. Si una de estas constraints salta alguna vez,
-- es que hay un camino de código que nadie previó — que es justamente para lo
-- que sirven.
--
-- Correr después de `abona618_12oct.sql`. Es idempotente.
-- ===========================================================================

-- Un plan completado tiene que tener su fecha de completado -----------------
alter table public.planes_pago drop constraint if exists completado_con_fecha;
alter table public.planes_pago add constraint completado_con_fecha
  check (estado <> 'completado' or completado_en is not null);

-- Y un plan anulado, la suya ------------------------------------------------
alter table public.planes_pago drop constraint if exists anulado_con_fecha;
alter table public.planes_pago add constraint anulado_con_fecha
  check (estado <> 'anulado' or anulado_en is not null);

-- Un plan completado no puede estar anulado al mismo tiempo. Este era el
-- estado imposible que se producía al verificar la última cuota de un plan ya
-- anulado: quedaba estado='completado' con anulado_en poblado, y el sistema
-- ordenaba entregar los QR de una silla que ya se había revendido.
alter table public.planes_pago drop constraint if exists completado_no_anulado;
alter table public.planes_pago add constraint completado_no_anulado
  check (completado_en is null or anulado_en is null);

-- Tope de cantidad, que hasta ahora solo vivía en TypeScript (MAX_POR_COMPRA)
alter table public.planes_pago drop constraint if exists cantidad_razonable;
alter table public.planes_pago add constraint cantidad_razonable
  check (cantidad between 1 and 20);

-- No se puede verificar un pago antes de que exista -------------------------
alter table public.cuotas drop constraint if exists verificado_despues_de_reportado;
alter table public.cuotas add constraint verificado_despues_de_reportado
  check (reportado_en is null or verificado_en is null or verificado_en >= reportado_en);

-- Índices: quitar los que no sirven y arreglar el que sí ---------------------

-- Redundante: el unique (plan_id, orden) ya crea un btree con plan_id como
-- columna líder, que cubre exactamente las mismas consultas.
drop index if exists public.cuotas_plan_idx;

-- Ninguna consulta del módulo filtra solo por estado: solo costaba escrituras.
drop index if exists public.planes_pago_estado_idx;

-- El anterior indexaba (tipo, estado) dentro de un predicado que ya fija las
-- dos columnas a constantes, así que la clave no aportaba selectividad y había
-- que ir al heap por cada fila para leer `cantidad`. Con cantidad en el índice,
-- el conteo del tope VIP se resuelve sin tocar la tabla.
drop index if exists public.planes_pago_vip_activos_idx;
create index if not exists planes_pago_vip_activos_idx
  on public.planes_pago (cantidad)
  where tipo = 'vip' and estado in ('al_dia','en_mora','completado');

notify pgrst, 'reload schema';
