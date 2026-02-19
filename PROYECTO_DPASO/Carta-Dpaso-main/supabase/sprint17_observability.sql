-- Sprint 17: Observabilidad y métricas operativas (idempotente)

create table if not exists public.app_event_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  level text not null default 'error',
  event_name text not null,
  context text,
  source text,
  user_id uuid,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists app_event_logs_created_at_idx on public.app_event_logs(created_at desc);
create index if not exists app_event_logs_event_name_idx on public.app_event_logs(event_name);
create index if not exists app_event_logs_source_idx on public.app_event_logs(source);

alter table public.app_event_logs enable row level security;

drop policy if exists app_event_logs_insert_public on public.app_event_logs;
create policy app_event_logs_insert_public
on public.app_event_logs
for insert
to anon, authenticated
with check (true);

drop policy if exists app_event_logs_select_admin on public.app_event_logs;
create policy app_event_logs_select_admin
on public.app_event_logs
for select
to authenticated
using (public.is_admin_user(auth.uid()));

-- RPC para registrar eventos desde front/admin con formato estructurado.
drop function if exists public.log_app_event(text, text, text, text, jsonb);
create or replace function public.log_app_event(
  p_event_name text,
  p_level text default 'error',
  p_context text default null,
  p_source text default 'unknown',
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level text := lower(coalesce(nullif(trim(p_level), ''), 'error'));
begin
  if v_level not in ('debug', 'info', 'warning', 'error', 'critical') then
    v_level := 'error';
  end if;

  insert into public.app_event_logs(level, event_name, context, source, user_id, payload)
  values (
    v_level,
    coalesce(nullif(trim(p_event_name), ''), 'unknown_event'),
    nullif(trim(coalesce(p_context, '')), ''),
    coalesce(nullif(trim(p_source), ''), 'unknown'),
    auth.uid(),
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.log_app_event(text, text, text, text, jsonb) from public;
grant execute on function public.log_app_event(text, text, text, text, jsonb) to anon, authenticated;

-- Tablero operativo: conversión, pedidos caídos y latencia media RPC (según logs).
drop function if exists public.rpc_operational_metrics(timestamptz, timestamptz);
create or replace function public.rpc_operational_metrics(
  date_from timestamptz,
  date_to timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_total_orders integer := 0;
  v_success_orders integer := 0;
  v_cancelled_orders integer := 0;
  v_checkout_failures integer := 0;
  v_avg_rpc_ms numeric := 0;
begin
  v_uid := auth.uid();
  if v_uid is null or not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  select count(*)::int,
         count(*) filter (where coalesce(o.estado, '') not in ('cancelled'))::int,
         count(*) filter (where coalesce(o.estado, '') = 'cancelled')::int
  into v_total_orders, v_success_orders, v_cancelled_orders
  from public.orders o
  where o.created_at between date_from and date_to;

  select count(*)::int
  into v_checkout_failures
  from public.app_event_logs l
  where l.created_at between date_from and date_to
    and l.event_name = 'checkout_error';

  select coalesce(avg((l.payload ->> 'rpc_ms')::numeric), 0)
  into v_avg_rpc_ms
  from public.app_event_logs l
  where l.created_at between date_from and date_to
    and l.event_name = 'checkout_rpc_result'
    and (l.payload ? 'rpc_ms');

  return jsonb_build_object(
    'total_orders', v_total_orders,
    'successful_orders', v_success_orders,
    'cancelled_orders', v_cancelled_orders,
    'conversion_rate', case when v_total_orders > 0 then round((v_success_orders::numeric / v_total_orders::numeric) * 100, 2) else 0 end,
    'dropped_orders', v_cancelled_orders + v_checkout_failures,
    'checkout_failures', v_checkout_failures,
    'avg_rpc_ms', round(coalesce(v_avg_rpc_ms, 0), 2)
  );
end;
$$;

revoke all on function public.rpc_operational_metrics(timestamptz, timestamptz) from public;
grant execute on function public.rpc_operational_metrics(timestamptz, timestamptz) to authenticated;
