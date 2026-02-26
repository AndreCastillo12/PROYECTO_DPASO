-- Sprint 26: Endurecer Caja para operación real (idempotente)

-- ---------------------------------------------------------------------------
-- Integridad base
-- ---------------------------------------------------------------------------
create unique index if not exists cash_sessions_single_open_uidx
  on public.cash_sessions (status)
  where status = 'open';

alter table if exists public.cash_sessions
  drop constraint if exists cash_sessions_opening_amount_nonnegative;

alter table if exists public.cash_sessions
  add constraint cash_sessions_opening_amount_nonnegative check (opening_amount >= 0);

alter table if exists public.cash_movements
  drop constraint if exists cash_movements_amount_positive;

alter table if exists public.cash_movements
  add constraint cash_movements_amount_positive check (amount > 0);

create index if not exists orders_cash_paid_at_idx on public.orders (paid_at);
create index if not exists orders_cash_status_idx on public.orders (paid, estado, payment_method);

-- ---------------------------------------------------------------------------
-- Trigger de ventas para movimientos automáticos (solo efectivo pagado)
-- ---------------------------------------------------------------------------
create or replace function public.trg_orders_register_cash_sale_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_effective_time timestamptz;
  v_session_id uuid;
  v_qualifies boolean;
  v_order_code text;
  v_amount numeric;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  v_effective_time := coalesce(new.paid_at, new.updated_at, now());
  v_amount := round(coalesce(new.total, 0)::numeric, 2);

  v_qualifies := (
    coalesce(new.paid, false) = true
    and lower(coalesce(new.estado, '')) <> 'cancelled'
    and lower(coalesce(new.payment_method, '')) = 'cash'
    and v_amount > 0
  );

  if not v_qualifies then
    delete from public.cash_movements cm
    where cm.order_id = new.id
      and coalesce(cm.movement_source, 'manual') = 'order_sale';
    return new;
  end if;

  select cs.id into v_session_id
  from public.cash_sessions cs
  where cs.opened_at <= v_effective_time
    and (cs.closed_at is null or v_effective_time <= cs.closed_at)
  order by cs.opened_at desc
  limit 1;

  if v_session_id is null then
    return new;
  end if;

  v_order_code := coalesce(nullif(trim(coalesce(new.short_code, '')), ''), new.id::text);

  insert into public.cash_movements(
    cash_session_id,
    type,
    reason,
    amount,
    created_by,
    movement_source,
    order_id,
    created_at
  )
  values (
    v_session_id,
    'in',
    'Venta efectivo pedido ' || upper(v_order_code),
    v_amount,
    null,
    'order_sale',
    new.id,
    v_effective_time
  )
  on conflict (order_id)
  where movement_source = 'order_sale' and order_id is not null
  do update set
    cash_session_id = excluded.cash_session_id,
    amount = excluded.amount,
    reason = excluded.reason,
    created_at = excluded.created_at;

  return new;
end;
$$;

revoke all on function public.trg_orders_register_cash_sale_movement() from public;
grant execute on function public.trg_orders_register_cash_sale_movement() to authenticated;

drop trigger if exists trg_orders_register_cash_sale_movement on public.orders;
create trigger trg_orders_register_cash_sale_movement
after update of paid, payment_method, estado, paid_at, total on public.orders
for each row
execute function public.trg_orders_register_cash_sale_movement();

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
  v_amount numeric(10,2);
  v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  v_amount := round(coalesce(opening_amount, 0)::numeric, 2);
  if v_amount < 0 then
    raise exception 'INVALID_OPENING_AMOUNT';
  end if;

  if exists (select 1 from public.cash_sessions cs where cs.status = 'open') then
    raise exception 'OPEN_SESSION_EXISTS';
  end if;

  insert into public.cash_sessions(opened_by, opening_amount, notes, status)
  values (v_uid, v_amount, nullif(trim(coalesce(notes, '')), ''), 'open')
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.rpc_open_cash_session(numeric, text) from public;
grant execute on function public.rpc_open_cash_session(numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: registrar movimiento manual
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_register_cash_movement(uuid, text, numeric, text);
create or replace function public.rpc_register_cash_movement(
  p_session_id uuid,
  p_type text,
  p_amount numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_id uuid;
  v_type text;
  v_reason text;
  v_amount numeric(10,2);
  v_status text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  v_type := lower(coalesce(p_type, ''));
  if v_type not in ('in', 'out') then
    raise exception 'INVALID_MOVEMENT_TYPE';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'MOVEMENT_REASON_REQUIRED';
  end if;

  v_amount := round(coalesce(p_amount, 0)::numeric, 2);
  if v_amount <= 0 then
    raise exception 'INVALID_MOVEMENT_AMOUNT';
  end if;

  select cs.status into v_status
  from public.cash_sessions cs
  where cs.id = p_session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_status <> 'open' then
    raise exception 'SESSION_NOT_OPEN';
  end if;

  insert into public.cash_movements(
    cash_session_id,
    type,
    reason,
    amount,
    created_by,
    movement_source,
    created_at
  ) values (
    p_session_id,
    v_type,
    v_reason,
    v_amount,
    v_uid,
    'manual',
    now()
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.rpc_register_cash_movement(uuid, text, numeric, text) from public;
grant execute on function public.rpc_register_cash_movement(uuid, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: resumen de caja (determinístico y separado efectivo/no-efectivo)
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
  v_from timestamptz;
  v_to timestamptz;
  v_total_sales numeric := 0;
  v_total_orders int := 0;
  v_total_delivery numeric := 0;
  v_total_pickup numeric := 0;
  v_mov_in numeric := 0;
  v_mov_out numeric := 0;
  v_cash_sales numeric := 0;
  v_non_cash_sales numeric := 0;
  v_payments jsonb := '{}'::jsonb;
  v_expected_cash numeric := 0;
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

  v_from := v_session.opened_at;
  v_to := coalesce(v_session.closed_at, now());

  select
    coalesce(sum(o.total), 0),
    count(*)::int,
    coalesce(sum(case when o.modalidad = 'Delivery' then o.total else 0 end), 0),
    coalesce(sum(case when o.modalidad = 'Recojo' then o.total else 0 end), 0),
    coalesce(sum(case when lower(coalesce(o.payment_method, '')) = 'cash' then o.total else 0 end), 0),
    coalesce(sum(case when lower(coalesce(o.payment_method, '')) <> 'cash' then o.total else 0 end), 0)
  into
    v_total_sales,
    v_total_orders,
    v_total_delivery,
    v_total_pickup,
    v_cash_sales,
    v_non_cash_sales
  from public.orders o
  where coalesce(o.paid, false) = true
    and lower(coalesce(o.estado, '')) <> 'cancelled'
    and coalesce(o.paid_at, o.updated_at, o.created_at) >= v_from
    and coalesce(o.paid_at, o.updated_at, o.created_at) <= v_to;

  select coalesce(sum(cm.amount), 0)
  into v_mov_in
  from public.cash_movements cm
  where cm.cash_session_id = v_session.id
    and cm.type = 'in'
    and coalesce(cm.movement_source, 'manual') = 'manual';

  select coalesce(sum(cm.amount), 0)
  into v_mov_out
  from public.cash_movements cm
  where cm.cash_session_id = v_session.id
    and cm.type = 'out'
    and coalesce(cm.movement_source, 'manual') = 'manual';

  select coalesce(
    jsonb_object_agg(method_key, amount_sum),
    '{}'::jsonb
  )
  into v_payments
  from (
    select
      coalesce(nullif(lower(o.payment_method), ''), 'unknown') as method_key,
      round(coalesce(sum(o.total), 0)::numeric, 2) as amount_sum
    from public.orders o
    where coalesce(o.paid, false) = true
      and lower(coalesce(o.estado, '')) <> 'cancelled'
      and coalesce(o.paid_at, o.updated_at, o.created_at) >= v_from
      and coalesce(o.paid_at, o.updated_at, o.created_at) <= v_to
    group by coalesce(nullif(lower(o.payment_method), ''), 'unknown')
  ) t;

  v_expected_cash := round((coalesce(v_session.opening_amount, 0) + v_cash_sales + v_mov_in - v_mov_out)::numeric, 2);

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'opened_at', v_session.opened_at,
    'closed_at', v_session.closed_at,
    'opening_amount', round(coalesce(v_session.opening_amount, 0)::numeric, 2),
    'expected_cash_amount', v_expected_cash,
    'expected_amount', v_expected_cash,
    'closing_amount', round(coalesce(v_session.closing_amount, 0)::numeric, 2),
    'difference', round(coalesce(v_session.difference, coalesce(v_session.closing_amount, 0) - v_expected_cash)::numeric, 2),
    'totals_by_payment_method', v_payments,
    'total_paid_orders', v_total_orders,
    'total_sales', round(v_total_sales::numeric, 2),
    'cash_sales', round(v_cash_sales::numeric, 2),
    'non_cash_sales', round(v_non_cash_sales::numeric, 2),
    'total_delivery', round(v_total_delivery::numeric, 2),
    'total_pickup', round(v_total_pickup::numeric, 2),
    'movements_in', round(v_mov_in::numeric, 2),
    'movements_out', round(v_mov_out::numeric, 2)
  );
end;
$$;

revoke all on function public.rpc_cash_summary(uuid) from public;
grant execute on function public.rpc_cash_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: cerrar caja
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_close_cash_session(uuid, numeric, text);
create or replace function public.rpc_close_cash_session(
  session_id uuid,
  p_closing_amount numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_session public.cash_sessions%rowtype;
  v_closing_amount numeric(10,2);
  v_summary jsonb;
  v_expected numeric(10,2);
  v_diff numeric(10,2);
  v_closed_at timestamptz;
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

  v_closing_amount := round(coalesce(p_closing_amount, -1)::numeric, 2);
  if v_closing_amount < 0 then
    raise exception 'INVALID_CLOSING_AMOUNT';
  end if;

  select public.rpc_cash_summary(session_id) into v_summary;
  v_expected := round(coalesce((v_summary->>'expected_cash_amount')::numeric, 0)::numeric, 2);
  v_diff := round((v_closing_amount - v_expected)::numeric, 2);
  v_closed_at := now();

  update public.cash_sessions
  set
    closed_at = v_closed_at,
    closed_by = v_uid,
    closing_amount = v_closing_amount,
    expected_amount = v_expected,
    difference = v_diff,
    notes = coalesce(nullif(trim(coalesce(p_notes, '')), ''), notes),
    status = 'closed'
  where id = v_session.id;

  return coalesce(v_summary, '{}'::jsonb) || jsonb_build_object(
    'session_id', v_session.id,
    'status', 'closed',
    'closed_by', v_uid,
    'closed_at', v_closed_at,
    'closing_amount', v_closing_amount,
    'expected_cash_amount', v_expected,
    'expected_amount', v_expected,
    'difference', v_diff
  );
end;
$$;

revoke all on function public.rpc_close_cash_session(uuid, numeric, text) from public;
grant execute on function public.rpc_close_cash_session(uuid, numeric, text) to authenticated;
