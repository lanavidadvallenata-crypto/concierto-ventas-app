-- Medición del embudo de venta (Anita, 29 oct): qué hace la gente en la web
-- antes de pagar, de dónde llega y dónde se queda.
--
-- SOLO AGREGA: una tabla nueva (eventos_web) y una función de lectura
-- (resumen_embudo). No toca tickets, sillas, planes ni cuotas. Se puede
-- correr más de una vez sin romper nada.
--
-- Orden: da igual. Si el código sube antes que este SQL, la web vende igual
-- (anotar un paso que falla no frena ninguna compra) y el dashboard muestra
-- "Falta activar la medición" en vez del embudo.
--
-- Sin datos personales: ni nombre, ni teléfono, ni correo, ni IP. "visitante"
-- es un código al azar que el navegador guarda 30 días.

create table if not exists public.eventos_web (
  id          bigint generated always as identity primary key,
  creado_en   timestamptz not null default now(),
  visitante   text,
  -- visita · zona · continuar · pago · expiro · reporto · whatsapp
  evento      text not null,
  ruta        text,
  zona        text,
  cantidad    int,
  valor_usd   numeric(10,2),
  grupo_id    uuid,
  en_cuotas   boolean,
  -- De dónde llegó: utm_source normalizado, o el sitio que lo mandó
  -- (instagram, facebook, whatsapp, google...).
  fuente      text,
  medio       text,
  campana     text,
  contenido   text,
  referidor   text,
  dispositivo text
);

create index if not exists eventos_web_creado_idx on public.eventos_web (creado_en);
create index if not exists eventos_web_evento_creado_idx on public.eventos_web (evento, creado_en);
create index if not exists eventos_web_visitante_idx on public.eventos_web (visitante, creado_en);
create index if not exists eventos_web_grupo_idx on public.eventos_web (grupo_id) where grupo_id is not null;

-- Nadie la lee ni la escribe desde el navegador: solo el servidor (service_role).
alter table public.eventos_web enable row level security;
revoke all on public.eventos_web from anon, authenticated;

-- ---------------------------------------------------------------------------
-- resumen_embudo: todo lo que pinta el dashboard en UNA consulta.
--   p_desde / p_hasta: el período (Hoy, 7 días, Todo).
--   p_zona: null = todas; 'vip' | 'preferencial' | 'general' filtra los pasos
--           que tienen zona (continuar, pago, reportó, confirmado).
-- "Confirmada" = Finanzas confirmó el pago de contado o la inicial del plan.
-- ---------------------------------------------------------------------------
create or replace function public.resumen_embudo(
  p_desde timestamptz,
  p_hasta timestamptz default now(),
  p_zona  text default null
) returns jsonb
language sql
stable
set search_path = public
as $$
with
ev as (
  select e.*, coalesce(e.visitante, 'anon-' || e.id) as quien
  from eventos_web e
  where e.creado_en >= p_desde and e.creado_en < p_hasta
),
confirmadas as (
  select distinct t.grupo_id
  from tickets t
  where t.estado_pago = 'verificado' and t.grupo_id is not null
  union
  select p.grupo_id
  from planes_pago p
  join cuotas q on q.plan_id = p.id
  where q.orden = 1 and q.verificado_en is not null
),
-- Cada compra web con su canal: la última visita del mismo visitante que
-- trajo fuente, antes de reportar (aunque sea de días anteriores al período).
compras_web as (
  select r.grupo_id, r.quien, r.zona, r.valor_usd, r.en_cuotas,
         (r.grupo_id in (select grupo_id from confirmadas)) as confirmada,
         coalesce((
           select v.fuente from eventos_web v
           where r.visitante is not null and v.visitante = r.visitante and v.evento = 'visita'
             and v.fuente is not null and v.fuente <> '' and v.creado_en <= r.creado_en
           order by v.creado_en desc limit 1
         ), 'directo') as canal,
         (
           select v.campana from eventos_web v
           where r.visitante is not null and v.visitante = r.visitante and v.evento = 'visita'
             and v.fuente is not null and v.fuente <> '' and v.creado_en <= r.creado_en
           order by v.creado_en desc limit 1
         ) as campana
  from ev r
  where r.evento = 'reporto' and r.grupo_id is not null
),
-- Cada visitante del período cuenta en UN solo canal: el último que lo trajo
-- (si nunca trajo fuente, "directo"). Así los canales suman el total.
canal_visitante as (
  select quien,
         coalesce((array_agg(fuente order by creado_en desc) filter (where fuente is not null and fuente <> ''))[1], 'directo') as canal
  from ev where evento = 'visita'
  group by quien
),
visitas_por_canal as (
  select canal, count(*) as visitantes from canal_visitante group by canal
),
-- El paso más avanzado de cada visitante. Es acumulado: quien llegó al pago
-- también cuenta como que entró a la tienda, aunque su navegador no haya
-- mandado ese paso (bloqueador, mala señal). Así el embudo nunca sube.
niveles as (
  select quien, 1 as n from ev where evento = 'visita'
  union all select quien, 2 from ev where (evento = 'visita' and ruta like '/comprar%') or evento = 'zona'
  union all select quien, 3 from ev where evento = 'continuar' and (p_zona is null or zona = p_zona)
  union all select quien, 4 from ev where evento in ('pago', 'expiro') and (p_zona is null or zona = p_zona)
  union all select quien, 5 from compras_web where p_zona is null or zona = p_zona
  union all select quien, 6 from compras_web where confirmada and (p_zona is null or zona = p_zona)
),
nivel as (
  select quien, max(n) as n from niveles group by quien
)
select jsonb_build_object(
  'desde', p_desde,
  'hasta', p_hasta,
  'primer_evento', (select min(creado_en) from eventos_web),
  'pasos', jsonb_build_object(
    'visitantes', (select count(*) from nivel where n >= 1),
    'tienda',     (select count(*) from nivel where n >= 2),
    'continuar',  (select count(*) from nivel where n >= 3),
    'pago',       (select count(*) from nivel where n >= 4),
    'reporto',    (select count(*) from nivel where n >= 5),
    'confirmado', (select count(*) from nivel where n >= 6)
  ),
  'fugas', jsonb_build_object(
    -- Llegaron al pago y se les acabaron los 15 minutos sin reportar.
    'expiraron', (select count(distinct quien) from ev where evento = 'expiro' and (p_zona is null or zona = p_zona)),
    -- Tocaron "Escríbenos por WhatsApp" mientras compraban (no cuenta a
    -- quien ya compró y escribe desde su página de compra o de su entrada).
    'whatsapp',  (select count(distinct quien) from ev where evento = 'whatsapp'
                  and coalesce(ruta, '') not like '/compra/%' and coalesce(ruta, '') not like '/entrada/%'),
    'whatsapp_compradores', (select count(distinct quien) from ev where evento = 'whatsapp'
                  and (ruta like '/compra/%' or ruta like '/entrada/%'))
  ),
  'compras_web', jsonb_build_object(
    'reportadas',        (select count(*) from compras_web where p_zona is null or zona = p_zona),
    'confirmadas',       (select count(*) from compras_web where confirmada and (p_zona is null or zona = p_zona)),
    'en_cuotas',         (select count(*) from compras_web where en_cuotas and (p_zona is null or zona = p_zona)),
    'valor_reportado',   (select coalesce(sum(valor_usd), 0) from compras_web where p_zona is null or zona = p_zona),
    'valor_confirmado',  (select coalesce(sum(valor_usd), 0) from compras_web where confirmada and (p_zona is null or zona = p_zona))
  ),
  'canales', coalesce((
    select jsonb_agg(c order by c.valor_confirmado desc, c.visitantes desc) from (
      select k.canal,
             coalesce(v.visitantes, 0) as visitantes,
             count(cw.grupo_id) as compras,
             count(cw.grupo_id) filter (where cw.confirmada) as confirmadas,
             coalesce(sum(cw.valor_usd) filter (where cw.confirmada), 0) as valor_confirmado
      from (select canal from visitas_por_canal union select canal from compras_web) k
      left join visitas_por_canal v on v.canal = k.canal
      left join compras_web cw on cw.canal = k.canal
      group by k.canal, v.visitantes
    ) c
  ), '[]'::jsonb),
  'campanas', coalesce((
    select jsonb_agg(c order by c.valor_confirmado desc) from (
      select canal, campana, count(*) as compras,
             count(*) filter (where confirmada) as confirmadas,
             coalesce(sum(valor_usd) filter (where confirmada), 0) as valor_confirmado
      from compras_web where campana is not null and campana <> ''
      group by canal, campana
    ) c
  ), '[]'::jsonb),
  -- En vivo: no depende del período.
  'vivo', jsonb_build_object(
    'activos_5min', (select count(distinct coalesce(visitante, 'anon-' || id)) from eventos_web
                     where creado_en > now() - interval '5 minutes'),
    'en_pago', (
      select count(distinct p.visitante) from eventos_web p
      where p.evento = 'pago' and p.creado_en > now() - interval '15 minutes' and p.visitante is not null
        and not exists (
          select 1 from eventos_web x
          where x.visitante = p.visitante and x.evento in ('reporto', 'expiro') and x.creado_en >= p.creado_en
        )
    )
  )
);
$$;

-- Solo el servidor la llama. Por defecto Postgres deja ejecutar funciones a
-- todo el mundo: se le quita a anon/authenticated.
revoke all on function public.resumen_embudo(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.resumen_embudo(timestamptz, timestamptz, text) to service_role;

-- Verificación: debe devolver un JSON con "pasos", "canales", "vivo"...
select public.resumen_embudo(now() - interval '1 day');
