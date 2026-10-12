-- ===========================================================================
-- Abona618 — el cobro de cuotas es un proceso ACOMPAÑADO por el equipo.
--
-- Decisión de Anita (12 oct): no se puede depender de que el comprador reporte
-- su pago por su cuenta — se le pierde de vista o no se acuerda. El equipo de
-- Ventas lo acompaña, recibe la referencia por WhatsApp y la registra; Finanzas
-- confirma contra el banco. El comprador TAMBIÉN puede reportar desde su
-- página si se adelanta, pero el sistema no cuenta con eso.
--
-- Eso obliga a saber de dónde salió cada reporte: un pago que registró Jenny
-- porque se lo mandaron por WhatsApp no tiene el mismo peso que uno que el
-- comprador metió él mismo, y cuando haya que reclamar algo hay que poder
-- decir quién lo anotó y por dónde llegó.
--
-- Correr después de abona618_endurecer_12oct.sql. Es idempotente.
-- ===========================================================================

-- Quién anotó el pago. NULL = lo reportó el comprador desde su página.
alter table public.cuotas add column if not exists reportado_por uuid;

-- Por dónde llegó: whatsapp, llamada, presencial, web (el comprador), otro.
alter table public.cuotas add column if not exists canal_reporte text;

alter table public.cuotas drop constraint if exists canal_reporte_valido;
alter table public.cuotas add constraint canal_reporte_valido
  check (canal_reporte is null or canal_reporte in ('whatsapp','llamada','presencial','web','otro'));

-- Si lo registró alguien del equipo, tuvo que decir por dónde le llegó.
alter table public.cuotas drop constraint if exists reporte_con_canal;
alter table public.cuotas add constraint reporte_con_canal
  check (reportado_por is null or canal_reporte is not null);

-- Nota libre de quien cobra: "pagó de más, le queda saldo a favor", "dijo que
-- paga el lunes", lo que haga falta para que el siguiente que atienda entienda.
alter table public.cuotas add column if not exists nota text;

-- La lista de cobranza del equipo ordena por fecha de vencimiento las cuotas
-- que nadie ha reportado todavía: es la consulta que se va a hacer todo el
-- día, varias veces por hora.
drop index if exists public.cuotas_por_cobrar_idx;
create index if not exists cuotas_por_cobrar_idx
  on public.cuotas (vence_el)
  where verificado_en is null and reportado_en is null;

notify pgrst, 'reload schema';
