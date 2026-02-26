-- Sprint 30: pago auditable en detalle pedido + fix backfill clientes sin ON CONFLICT inválido

-- ---------------------------------------------------------------------------
-- Pago auditable
-- ---------------------------------------------------------------------------
alter table if exists public.orders
  add column if not exists payment_reference text,
  add column if not exists payment_note text,
  add column if not exists paid_by_admin_id uuid references auth.users(id);

create table if not exists public.order_payment_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  method text not null,
  amount numeric(10,2) not null,
  cash_received numeric(10,2),
  cash_change numeric(10,2),
  reference text,
  note text,
  paid_at timestamptz not null default now(),
  admin_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists order_payment_events_order_id_idx on public.order_payment_events(order_id, created_at desc);
create index if not exists order_payment_events_admin_id_idx on public.order_payment_events(admin_id, created_at desc);

alter table if exists public.order_payment_events enable row level security;

drop policy if exists order_payment_events_admin_select on public.order_payment_events;
create policy order_payment_events_admin_select
on public.order_payment_events
for select
to authenticated
using (public.is_admin_user(auth.uid()));

drop policy if exists order_payment_events_admin_insert on public.order_payment_events;
create policy order_payment_events_admin_insert
on public.order_payment_events
for insert
to authenticated
with check (public.is_admin_user(auth.uid()));

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

-- ---------------------------------------------------------------------------
-- Fix: backfill clientes sin ON CONFLICT(phone)
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_backfill_customers_from_orders();
create or replace function public.rpc_backfill_customers_from_orders()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  rec record;
  v_customer_id uuid;
  v_processed integer := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  for rec in
    select
      o.id as order_id,
      o.user_id,
      nullif(btrim(coalesce(o.nombre_cliente, '')), '') as name,
      nullif(btrim(coalesce(o.telefono, '')), '') as phone,
      nullif(regexp_replace(coalesce(o.telefono, ''), '[^0-9]+', '', 'g'), '') as normalized_phone
    from public.orders o
    where o.customer_id is null
    order by o.created_at asc
  loop
    v_customer_id := null;

    if rec.user_id is not null then
      select c.id
      into v_customer_id
      from public.customers c
      where c.user_id = rec.user_id
         or c.auth_user_id = rec.user_id
      order by c.updated_at desc nulls last, c.created_at desc
      limit 1;

      if v_customer_id is null then
        insert into public.customers(
          name,
          phone,
          normalized_phone,
          user_id,
          auth_user_id,
          created_at,
          updated_at
        )
        values (
          coalesce(rec.name, 'Cliente'),
          rec.phone,
          rec.normalized_phone,
          rec.user_id,
          rec.user_id,
          now(),
          now()
        )
        returning id into v_customer_id;
      else
        update public.customers c
        set
          name = coalesce(rec.name, c.name),
          phone = coalesce(rec.phone, c.phone),
          normalized_phone = coalesce(rec.normalized_phone, c.normalized_phone),
          updated_at = now()
        where c.id = v_customer_id;
      end if;
    else
      -- Invitado: no merge automático por teléfono.
      insert into public.customers(
        name,
        phone,
        normalized_phone,
        user_id,
        auth_user_id,
        created_at,
        updated_at
      )
      values (
        coalesce(rec.name, 'Cliente invitado'),
        rec.phone,
        rec.normalized_phone,
        null,
        null,
        now(),
        now()
      )
      returning id into v_customer_id;
    end if;

    update public.orders o
    set customer_id = v_customer_id
    where o.id = rec.order_id;

    v_processed := v_processed + 1;
  end loop;

  update public.customers c
  set
    total_orders = coalesce(s.total_orders, 0),
    total_spent = coalesce(s.total_spent, 0),
    last_order_at = s.last_order_at,
    updated_at = now()
  from (
    select
      o.customer_id,
      count(*)::int as total_orders,
      coalesce(sum(o.total), 0)::numeric(12,2) as total_spent,
      max(o.created_at) as last_order_at
    from public.orders o
    where o.customer_id is not null
    group by o.customer_id
  ) s
  where c.id = s.customer_id;

  return jsonb_build_object('processed_orders', v_processed);
end;
$$;

revoke all on function public.rpc_backfill_customers_from_orders() from public;
grant execute on function public.rpc_backfill_customers_from_orders() to authenticated;
