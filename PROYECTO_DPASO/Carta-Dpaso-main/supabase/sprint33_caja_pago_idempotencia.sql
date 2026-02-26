-- Sprint 33: Caja PRO follow-up (idempotencia de pagos + anti duplicados)

-- Un solo evento de pago por pedido para evitar duplicados por reintento/UI
create unique index if not exists order_payment_events_order_id_uidx
  on public.order_payment_events(order_id);

-- RPC idempotente: reintentos no duplican eventos/movimientos
-- (si el pedido ya está pagado y no se permite update, retorna estado actual)
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
    return jsonb_build_object(
      'order_id', v_order.id,
      'paid', true,
      'payment_method', lower(coalesce(v_order.payment_method, '')),
      'cash_received', v_order.cash_received,
      'cash_change', coalesce(v_order.cash_change, 0),
      'reference', v_order.payment_reference,
      'paid_at', coalesce(v_order.paid_at, v_order.updated_at, now()),
      'admin_id', coalesce(v_order.paid_by_admin_id, v_uid),
      'idempotent', true
    );
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
  )
  on conflict (order_id) do update set
    method = excluded.method,
    amount = excluded.amount,
    cash_received = excluded.cash_received,
    cash_change = excluded.cash_change,
    reference = excluded.reference,
    note = excluded.note,
    paid_at = excluded.paid_at,
    admin_id = excluded.admin_id;

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
    'admin_id', v_uid,
    'idempotent', false
  );
end;
$$;

revoke all on function public.rpc_register_order_payment(uuid, text, numeric, text, text, boolean, boolean) from public;
grant execute on function public.rpc_register_order_payment(uuid, text, numeric, text, text, boolean, boolean) to authenticated;
