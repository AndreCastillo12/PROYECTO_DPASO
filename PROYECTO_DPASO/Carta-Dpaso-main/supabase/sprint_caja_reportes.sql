-- Sprint 14: Caja + Reportes (idempotente)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Orders: compatibilidad mínima para caja/reportes
-- ---------------------------------------------------------------------------
alter table if exists public.orders
  add column if not exists payment_method text,
  add column if not exists paid boolean not null default false,
  add column if not exists paid_at timestamptz,
  add column if not exists zone_id uuid;

alter table if exists public.orders
  alter column delivery_fee set default 0;

-- ---------------------------------------------------------------------------
-- Caja
-- ---------------------------------------------------------------------------
create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by uuid references auth.users(id),
  closed_by uuid references auth.users(id),
  opening_amount numeric(10,2) not null default 0,
  closing_amount numeric(10,2),
  expected_amount numeric(10,2),
  difference numeric(10,2),
  notes text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_sessions_status_check check (status in ('open','closed'))
);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions(id) on delete cascade,
  type text not null,
  reason text not null,
  amount numeric(10,2) not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint cash_movements_type_check check (type in ('in','out')),
  constraint cash_movements_amount_check check (amount >= 0)
);

create index if not exists cash_sessions_status_idx on public.cash_sessions(status);
create index if not exists cash_sessions_opened_at_idx on public.cash_sessions(opened_at);
create index if not exists cash_movements_session_idx on public.cash_movements(cash_session_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger cash_sessions
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at_cash_sessions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_cash_sessions_updated_at on public.cash_sessions;
create trigger trg_cash_sessions_updated_at
before update on public.cash_sessions
for each row execute function public.set_updated_at_cash_sessions();

-- ---------------------------------------------------------------------------
-- Seguridad helper
-- ---------------------------------------------------------------------------
create or replace function public.is_admin_user(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = uid
      and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin_user(uuid) from public;
grant execute on function public.is_admin_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;

drop policy if exists cash_sessions_admin_select on public.cash_sessions;
create policy cash_sessions_admin_select
on public.cash_sessions for select
to authenticated
using (public.is_admin_user(auth.uid()));

drop policy if exists cash_sessions_admin_insert on public.cash_sessions;
create policy cash_sessions_admin_insert
on public.cash_sessions for insert
to authenticated
with check (public.is_admin_user(auth.uid()));

drop policy if exists cash_sessions_admin_update on public.cash_sessions;
create policy cash_sessions_admin_update
on public.cash_sessions for update
to authenticated
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

drop policy if exists cash_sessions_admin_delete on public.cash_sessions;
create policy cash_sessions_admin_delete
on public.cash_sessions for delete
to authenticated
using (public.is_admin_user(auth.uid()));

drop policy if exists cash_movements_admin_select on public.cash_movements;
create policy cash_movements_admin_select
on public.cash_movements for select
to authenticated
using (public.is_admin_user(auth.uid()));

drop policy if exists cash_movements_admin_insert on public.cash_movements;
create policy cash_movements_admin_insert
on public.cash_movements for insert
to authenticated
with check (public.is_admin_user(auth.uid()));

drop policy if exists cash_movements_admin_update on public.cash_movements;
create policy cash_movements_admin_update
on public.cash_movements for update
to authenticated
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

drop policy if exists cash_movements_admin_delete on public.cash_movements;
create policy cash_movements_admin_delete
on public.cash_movements for delete
to authenticated
using (public.is_admin_user(auth.uid()));

-- ---------------------------------------------------------------------------
-- RPC: abrir caja
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_open_cash_session(numeric, text);
create or replace function public.rpc_open_cash_session(opening_amount numeric, notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  if exists (select 1 from public.cash_sessions cs where cs.status = 'open') then
    raise exception 'OPEN_SESSION_EXISTS';
  end if;

  insert into public.cash_sessions(opened_by, opening_amount, notes, status)
  values (v_uid, coalesce(opening_amount, 0), nullif(trim(coalesce(notes, '')), ''), 'open')
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.rpc_open_cash_session(numeric, text) from public;
grant execute on function public.rpc_open_cash_session(numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: cerrar caja
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_close_cash_session(uuid, numeric, text);
create or replace function public.rpc_close_cash_session(session_id uuid, closing_amount numeric, notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_session public.cash_sessions%rowtype;
  v_closed_at timestamptz;
  v_cash_sales numeric := 0;
  v_mov_in numeric := 0;
  v_mov_out numeric := 0;
  v_expected numeric := 0;
  v_diff numeric := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_session
  from public.cash_sessions cs
  where cs.id = session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_session.status <> 'open' then
    raise exception 'SESSION_ALREADY_CLOSED';
  end if;

  v_closed_at := now();

  select coalesce(sum(o.total), 0)
  into v_cash_sales
  from public.orders o
  where o.created_at >= v_session.opened_at
    and o.created_at <= v_closed_at
    and coalesce(o.estado, '') <> 'cancelled'
    and coalesce(o.paid, false) = true
    and lower(coalesce(o.payment_method, '')) = 'cash';

  select coalesce(sum(cm.amount), 0)
  into v_mov_in
  from public.cash_movements cm
  where cm.cash_session_id = v_session.id
    and cm.type = 'in';

  select coalesce(sum(cm.amount), 0)
  into v_mov_out
  from public.cash_movements cm
  where cm.cash_session_id = v_session.id
    and cm.type = 'out';

  v_expected := coalesce(v_session.opening_amount, 0) + v_cash_sales + v_mov_in - v_mov_out;
  v_diff := coalesce(closing_amount, 0) - v_expected;

  update public.cash_sessions
  set
    closed_at = v_closed_at,
    closed_by = v_uid,
    closing_amount = coalesce(closing_amount, 0),
    expected_amount = v_expected,
    difference = v_diff,
    notes = coalesce(nullif(trim(coalesce(notes, '')), ''), v_session.notes),
    status = 'closed'
  where id = v_session.id;

  return jsonb_build_object(
    'session_id', v_session.id,
    'opening_amount', v_session.opening_amount,
    'closing_amount', coalesce(closing_amount, 0),
    'expected_amount', v_expected,
    'difference', v_diff,
    'closed_at', v_closed_at
  );
end;
$$;

revoke all on function public.rpc_close_cash_session(uuid, numeric, text) from public;
grant execute on function public.rpc_close_cash_session(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: resumen de caja
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_cash_summary(uuid);
create or replace function public.rpc_cash_summary(session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_session public.cash_sessions%rowtype;
  v_to timestamptz;
  v_total_sales numeric := 0;
  v_total_orders int := 0;
  v_total_delivery numeric := 0;
  v_total_pickup numeric := 0;
  v_mov_in numeric := 0;
  v_mov_out numeric := 0;
  v_cash_sales numeric := 0;
  v_payments jsonb := '{}'::jsonb;
  v_expected numeric := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_session
  from public.cash_sessions cs
  where cs.id = session_id;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  v_to := coalesce(v_session.closed_at, now());

  select
    coalesce(sum(o.total), 0),
    count(*)::int,
    coalesce(sum(case when o.modalidad = 'Delivery' then o.total else 0 end), 0),
    coalesce(sum(case when o.modalidad = 'Recojo' then o.total else 0 end), 0)
  into
    v_total_sales,
    v_total_orders,
    v_total_delivery,
    v_total_pickup
  from public.orders o
  where o.created_at >= v_session.opened_at
    and o.created_at <= v_to
    and coalesce(o.estado, '') <> 'cancelled'
    and coalesce(o.paid, false) = true;

  select coalesce(sum(cm.amount), 0)
  into v_mov_in
  from public.cash_movements cm
  where cm.cash_session_id = v_session.id
    and cm.type = 'in';

  select coalesce(sum(cm.amount), 0)
  into v_mov_out
  from public.cash_movements cm
  where cm.cash_session_id = v_session.id
    and cm.type = 'out';

  select coalesce(sum(o.total), 0)
  into v_cash_sales
  from public.orders o
  where o.created_at >= v_session.opened_at
    and o.created_at <= v_to
    and coalesce(o.estado, '') <> 'cancelled'
    and coalesce(o.paid, false) = true
    and lower(coalesce(o.payment_method, '')) = 'cash';

  select coalesce(
    jsonb_object_agg(method_key, amount_sum),
    '{}'::jsonb
  )
  into v_payments
  from (
    select
      coalesce(nullif(lower(o.payment_method), ''), 'unknown') as method_key,
      coalesce(sum(o.total), 0) as amount_sum
    from public.orders o
    where o.created_at >= v_session.opened_at
      and o.created_at <= v_to
      and coalesce(o.estado, '') <> 'cancelled'
      and coalesce(o.paid, false) = true
    group by coalesce(nullif(lower(o.payment_method), ''), 'unknown')
  ) t;

  v_expected := coalesce(v_session.opening_amount, 0) + v_cash_sales + v_mov_in - v_mov_out;

  return jsonb_build_object(
    'opening_amount', v_session.opening_amount,
    'expected_amount', coalesce(v_session.expected_amount, v_expected),
    'closing_amount', v_session.closing_amount,
    'difference', coalesce(v_session.difference, coalesce(v_session.closing_amount, 0) - v_expected),
    'totals_by_payment_method', v_payments,
    'total_orders', v_total_orders,
    'total_sales', v_total_sales,
    'total_delivery', v_total_delivery,
    'total_pickup', v_total_pickup,
    'movements_in', v_mov_in,
    'movements_out', v_mov_out
  );
end;
$$;

revoke all on function public.rpc_cash_summary(uuid) from public;
grant execute on function public.rpc_cash_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: reportes
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_sales_report(timestamptz, timestamptz, text);
create or replace function public.rpc_sales_report(date_from timestamptz, date_to timestamptz, group_by text)
returns table (
  label text,
  total_sales numeric,
  orders_count bigint,
  total_qty bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_from timestamptz := coalesce(date_from, now() - interval '7 days');
  v_to timestamptz := coalesce(date_to, now());
  v_group text := lower(coalesce(group_by, 'day'));
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  if v_group = 'day' then
    return query
    select
      to_char(date_trunc('day', o.created_at), 'YYYY-MM-DD') as label,
      coalesce(sum(o.total), 0)::numeric as total_sales,
      count(*)::bigint as orders_count,
      0::bigint as total_qty
    from public.orders o
    where o.created_at between v_from and v_to
      and coalesce(o.estado, '') <> 'cancelled'
      and coalesce(o.paid, false) = true
    group by date_trunc('day', o.created_at)
    order by date_trunc('day', o.created_at);

  elseif v_group = 'status' then
    return query
    select
      coalesce(o.estado, 'unknown') as label,
      coalesce(sum(o.total), 0)::numeric,
      count(*)::bigint,
      0::bigint
    from public.orders o
    where o.created_at between v_from and v_to
    group by coalesce(o.estado, 'unknown')
    order by 2 desc;

  elseif v_group = 'payment_method' then
    return query
    select
      coalesce(nullif(lower(o.payment_method), ''), 'unknown') as label,
      coalesce(sum(o.total), 0)::numeric,
      count(*)::bigint,
      0::bigint
    from public.orders o
    where o.created_at between v_from and v_to
      and coalesce(o.estado, '') <> 'cancelled'
      and coalesce(o.paid, false) = true
    group by coalesce(nullif(lower(o.payment_method), ''), 'unknown')
    order by 2 desc;

  elseif v_group = 'modalidad' then
    return query
    select
      coalesce(o.modalidad, 'unknown') as label,
      coalesce(sum(o.total), 0)::numeric,
      count(*)::bigint,
      0::bigint
    from public.orders o
    where o.created_at between v_from and v_to
      and coalesce(o.estado, '') <> 'cancelled'
      and coalesce(o.paid, false) = true
    group by coalesce(o.modalidad, 'unknown')
    order by 2 desc;

  elseif v_group = 'zone' then
    return query
    select
      coalesce(nullif(trim(concat_ws(' - ', o.provincia, o.distrito)), ''), 'Sin zona') as label,
      coalesce(sum(o.total), 0)::numeric,
      count(*)::bigint,
      0::bigint
    from public.orders o
    where o.created_at between v_from and v_to
      and coalesce(o.estado, '') <> 'cancelled'
      and coalesce(o.paid, false) = true
    group by coalesce(nullif(trim(concat_ws(' - ', o.provincia, o.distrito)), ''), 'Sin zona')
    order by 2 desc;

  elseif v_group = 'top_products' then
    return query
    select
      coalesce(oi.nombre_snapshot, 'Sin nombre') as label,
      coalesce(sum(oi.subtotal), 0)::numeric,
      count(distinct oi.order_id)::bigint,
      coalesce(sum(oi.cantidad), 0)::bigint
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.created_at between v_from and v_to
      and coalesce(o.estado, '') <> 'cancelled'
      and coalesce(o.paid, false) = true
    group by coalesce(oi.nombre_snapshot, 'Sin nombre')
    order by 4 desc, 2 desc;

  else
    raise exception 'INVALID_GROUP_BY';
  end if;
end;
$$;

revoke all on function public.rpc_sales_report(timestamptz, timestamptz, text) from public;
grant execute on function public.rpc_sales_report(timestamptz, timestamptz, text) to authenticated;
