-- Sprint 32: Caja PRO (validaciones fuertes + reconciliación + pagos idempotentes)

-- Índice idempotente para no duplicar movimiento automático por pedido/sesión
create unique index if not exists cash_movements_order_sale_session_uidx
  on public.cash_movements(cash_session_id, order_id)
  where movement_source = 'order_sale' and order_id is not null;

-- Detecta pagos cash sin movimiento de caja dentro de una sesión

drop function if exists public.rpc_cash_detect_inconsistencies(uuid);
create or replace function public.rpc_cash_detect_inconsistencies(session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.cash_sessions%rowtype;
  v_from timestamptz;
  v_to timestamptz;
  v_missing_count integer := 0;
  v_order_ids jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  select cs.*
  into v_session
  from public.cash_sessions cs
  where cs.id = session_id;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  v_from := v_session.opened_at;
  v_to := coalesce(v_session.closed_at, now());

  with missing as (
    select o.id
    from public.orders o
    where coalesce(o.paid, false) = true
      and lower(coalesce(o.payment_method, '')) = 'cash'
      and lower(coalesce(o.estado, '')) <> 'cancelled'
      and coalesce(o.paid_at, o.updated_at, o.created_at) >= v_from
      and coalesce(o.paid_at, o.updated_at, o.created_at) <= v_to
      and not exists (
        select 1
        from public.cash_movements cm
        where cm.order_id = o.id
          and coalesce(cm.movement_source, 'manual') = 'order_sale'
          and cm.cash_session_id = v_session.id
      )
  )
  select
    count(*)::int,
    coalesce(jsonb_agg(id), '[]'::jsonb)
  into v_missing_count, v_order_ids
  from missing;

  return jsonb_build_object(
    'session_id', v_session.id,
    'missing_order_sale_count', coalesce(v_missing_count, 0),
    'order_ids', coalesce(v_order_ids, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.rpc_cash_detect_inconsistencies(uuid) from public;
grant execute on function public.rpc_cash_detect_inconsistencies(uuid) to authenticated;

-- Reconciliación idempotente de movimientos faltantes

drop function if exists public.rpc_cash_reconcile_missing_order_sales(uuid);
create or replace function public.rpc_cash_reconcile_missing_order_sales(session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.cash_sessions%rowtype;
  v_from timestamptz;
  v_to timestamptz;
  rec record;
  v_inserted integer := 0;
  v_order_code text;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  select cs.*
  into v_session
  from public.cash_sessions cs
  where cs.id = session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  v_from := v_session.opened_at;
  v_to := coalesce(v_session.closed_at, now());

  for rec in
    select o.id, o.total, o.short_code, coalesce(o.paid_at, o.updated_at, o.created_at) as paid_time
    from public.orders o
    where coalesce(o.paid, false) = true
      and lower(coalesce(o.payment_method, '')) = 'cash'
      and lower(coalesce(o.estado, '')) <> 'cancelled'
      and coalesce(o.paid_at, o.updated_at, o.created_at) >= v_from
      and coalesce(o.paid_at, o.updated_at, o.created_at) <= v_to
      and not exists (
        select 1
        from public.cash_movements cm
        where cm.order_id = o.id
          and coalesce(cm.movement_source, 'manual') = 'order_sale'
          and cm.cash_session_id = v_session.id
      )
  loop
    v_order_code := coalesce(nullif(trim(coalesce(rec.short_code, '')), ''), rec.id::text);

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
      v_session.id,
      'in',
      'Reconciliación venta efectivo pedido ' || upper(v_order_code),
      round(coalesce(rec.total, 0)::numeric, 2),
      v_uid,
      'order_sale',
      rec.id,
      rec.paid_time
    )
    on conflict (cash_session_id, order_id)
    where movement_source = 'order_sale' and order_id is not null
    do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'session_id', v_session.id,
    'inserted', v_inserted
  );
end;
$$;

revoke all on function public.rpc_cash_reconcile_missing_order_sales(uuid) from public;
grant execute on function public.rpc_cash_reconcile_missing_order_sales(uuid) to authenticated;

-- Guardado de pago idempotente + reglas caja

drop function if exists public.rpc_register_order_payment(uuid, text, numeric, text, text, boolean, boolean);
create or replace function public.rpc_register_order_payment(
  p_order_id uuid,
  p_method text,
  p_cash_received numeric default null,
  p_reference text default null,
  p_note text default null,
  p_mark_paid boolean default true,
  p_allow_update boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_method text := lower(btrim(coalesce(p_method, '')));
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_received numeric(10,2);
  v_change numeric(10,2) := 0;
  v_paid_at timestamptz := now();
  v_open_session_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  if p_order_id is null then
    raise exception 'ORDER_ID_REQUIRED';
  end if;

  if v_method not in ('cash', 'yape', 'plin', 'card', 'transfer', 'other') then
    raise exception 'INVALID_METHOD';
  end if;

  select *
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if coalesce(v_order.paid, false) = true and not coalesce(p_allow_update, false) then
    raise exception 'ALREADY_PAID';
  end if;

  if v_method in ('yape', 'plin', 'card', 'transfer') and v_reference is null then
    raise exception 'REFERENCE_REQUIRED';
  end if;

  if v_method = 'cash' then
    select cs.id
    into v_open_session_id
    from public.cash_sessions cs
    where cs.status = 'open'
    order by cs.opened_at desc
    limit 1;

    if v_open_session_id is null then
      raise exception 'CASH_SESSION_REQUIRED';
    end if;

    v_received := round(coalesce(p_cash_received, 0)::numeric, 2);
    if v_received <= 0 then
      raise exception 'CASH_RECEIVED_REQUIRED';
    end if;
    if v_received < round(coalesce(v_order.total, 0)::numeric, 2) then
      raise exception 'CASH_RECEIVED_LT_TOTAL';
    end if;
    v_change := round(v_received - round(coalesce(v_order.total, 0)::numeric, 2), 2);
  else
    v_received := null;
    v_change := 0;
  end if;

  insert into public.order_payment_events(
    order_id,
    method,
    amount,
    cash_received,
    cash_change,
    reference,
    note,
    paid_at,
    admin_id
  )
  values (
    v_order.id,
    v_method,
    round(coalesce(v_order.total, 0)::numeric, 2),
    v_received,
    v_change,
    v_reference,
    v_note,
    v_paid_at,
    v_uid
  );

  if coalesce(p_mark_paid, true) then
    update public.orders o
    set
      paid = true,
      payment_method = v_method,
      paid_at = v_paid_at,
      cash_received = v_received,
      cash_change = v_change,
      payment_reference = v_reference,
      payment_note = v_note,
      paid_by_admin_id = v_uid,
      updated_at = v_paid_at
    where o.id = v_order.id;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id,
    'paid', coalesce(p_mark_paid, true),
    'payment_method', v_method,
    'cash_received', v_received,
    'cash_change', v_change,
    'reference', v_reference,
    'paid_at', v_paid_at,
    'admin_id', v_uid
  );
end;
$$;

revoke all on function public.rpc_register_order_payment(uuid, text, numeric, text, text, boolean, boolean) from public;
grant execute on function public.rpc_register_order_payment(uuid, text, numeric, text, text, boolean, boolean) to authenticated;

-- Cierre de caja: bloquear si hay pagos cash sin movimiento reconciliado

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
  v_inconsistency jsonb;
  v_missing_count integer := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  select cs.* into v_session
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

  select public.rpc_cash_detect_inconsistencies(session_id) into v_inconsistency;
  v_missing_count := coalesce((v_inconsistency->>'missing_order_sale_count')::int, 0);
  if v_missing_count > 0 then
    raise exception 'UNRECONCILED_ORDER_SALES';
  end if;

  select public.rpc_cash_summary(session_id) into v_summary;
  v_expected := round(coalesce((v_summary->>'expected_cash_amount')::numeric, 0)::numeric, 2);
  v_diff := round((v_closing_amount - v_expected)::numeric, 2);
  v_closed_at := now();

  update public.cash_sessions cs
  set
    closed_at = v_closed_at,
    closed_by = v_uid,
    closing_amount = v_closing_amount,
    expected_amount = v_expected,
    difference = v_diff,
    notes = coalesce(nullif(trim(coalesce(p_notes, '')), ''), cs.notes),
    status = 'closed'
  where cs.id = v_session.id;

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
