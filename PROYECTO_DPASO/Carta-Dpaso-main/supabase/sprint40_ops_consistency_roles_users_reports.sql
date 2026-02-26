-- Sprint 40: consistencia operativa salón/cocina/caja + usuarios internos + reportes por canal

-- ------------------------------------------------------------
-- 1) Estados y modalidad local/salón consistentes
-- ------------------------------------------------------------

update public.table_tickets
set status = 'ready', updated_at = now()
where status = 'served';

alter table if exists public.table_tickets
  drop constraint if exists table_tickets_status_check;

alter table if exists public.table_tickets
  add constraint table_tickets_status_check
  check (status in ('open', 'sent_to_kitchen', 'ready', 'closing', 'closed', 'cancelled'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'orders'
      AND c.conname = 'orders_modalidad_check'
  ) THEN
    ALTER TABLE public.orders DROP CONSTRAINT orders_modalidad_check;
  END IF;
END $$;

alter table if exists public.orders
  add constraint orders_modalidad_check
  check (lower(coalesce(modalidad, '')) in ('delivery','recojo','salon','salón','local','mesa'));

-- ------------------------------------------------------------
-- 2) Caja: pago efectivo solo con caja abierta + vínculo a sesión
-- ------------------------------------------------------------

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
  v_order_code text;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not (public.is_admin_user(v_uid) or public.is_role_cajero(v_uid)) then
    raise exception 'FORBIDDEN';
  end if;

  if p_order_id is null then
    raise exception 'ORDER_ID_REQUIRED';
  end if;

  if v_method not in ('cash', 'yape', 'plin', 'card', 'transfer', 'other') then
    raise exception 'INVALID_METHOD';
  end if;

  select * into v_order
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
    select cs.id into v_open_session_id
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
    v_open_session_id := null;
  end if;

  insert into public.order_payment_events(
    order_id, method, amount, cash_received, cash_change, reference, note, paid_at, admin_id
  ) values (
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

  if v_method = 'cash' then
    v_order_code := coalesce(nullif(trim(coalesce(v_order.short_code, '')), ''), v_order.id::text);
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
      v_open_session_id,
      'in',
      'Venta efectivo pedido ' || upper(v_order_code),
      round(coalesce(v_order.total, 0)::numeric, 2),
      v_uid,
      'order_sale',
      v_order.id,
      v_paid_at
    )
    on conflict (cash_session_id, order_id)
    where movement_source = 'order_sale' and order_id is not null
    do update set
      amount = excluded.amount,
      reason = excluded.reason,
      created_by = excluded.created_by,
      created_at = excluded.created_at;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id,
    'paid', coalesce(p_mark_paid, true),
    'payment_method', v_method,
    'cash_session_id', v_open_session_id,
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

-- ------------------------------------------------------------
-- 3) Salón: cierre solo pagado + order local completed/closed
-- ------------------------------------------------------------

drop function if exists public.rpc_salon_finalize_ticket_payment(uuid, text, numeric, text, text);
create or replace function public.rpc_salon_finalize_ticket_payment(
  p_ticket_id uuid,
  p_method text,
  p_cash_received numeric default null,
  p_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ticket public.table_tickets%rowtype;
  v_table public.restaurant_tables%rowtype;
  v_order_id uuid;
  v_total numeric(10,2) := 0;
  v_payment jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not (public.is_admin_user(v_uid) or public.is_role_cajero(v_uid)) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_ticket
  from public.table_tickets tt
  where tt.id = p_ticket_id
  for update;

  if not found then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  if v_ticket.status in ('closed', 'cancelled') then
    raise exception 'TICKET_ALREADY_CLOSED';
  end if;

  select * into v_table from public.restaurant_tables rt where rt.id = v_ticket.table_id;
  if not found then
    raise exception 'TABLE_NOT_FOUND';
  end if;

  select coalesce(sum(ti.qty * ti.price_snapshot), 0)::numeric(10,2)
  into v_total
  from public.table_ticket_items ti
  where ti.ticket_id = v_ticket.id and ti.status = 'active';

  if v_total <= 0 then
    raise exception 'EMPTY_TICKET';
  end if;

  v_order_id := v_ticket.generated_order_id;

  if v_order_id is null then
    insert into public.orders(
      nombre_cliente, telefono, modalidad, direccion, referencia, comentario,
      subtotal, delivery_fee, total, estado, paid, table_number, table_id, ticket_id
    ) values (
      coalesce(nullif(trim(v_table.table_name), ''), 'Mesa local'),
      '000000000',
      'local',
      v_table.table_name,
      'Ticket local',
      null,
      v_total,
      0,
      v_total,
      'completed',
      false,
      v_table.table_name,
      v_table.id,
      v_ticket.id
    ) returning id into v_order_id;

    insert into public.order_items(order_id, plato_id, nombre_snapshot, precio_snapshot, cantidad, subtotal)
    select v_order_id, ti.plato_id, ti.name_snapshot, ti.price_snapshot, ti.qty,
           round((ti.qty * ti.price_snapshot)::numeric, 2)
    from public.table_ticket_items ti
    where ti.ticket_id = v_ticket.id and ti.status = 'active';
  end if;

  -- obliga pago exitoso antes del cierre real
  select public.rpc_register_order_payment(
    v_order_id,
    p_method,
    p_cash_received,
    p_reference,
    p_note,
    true,
    false
  ) into v_payment;

  if coalesce((v_payment->>'paid')::boolean, false) is not true then
    raise exception 'PAYMENT_NOT_COMPLETED';
  end if;

  update public.orders o
  set estado = 'completed',
      paid = true,
      modalidad = 'local',
      updated_at = now()
  where o.id = v_order_id;

  update public.table_tickets tt
  set
    status = 'closed',
    payment_status = 'paid',
    generated_order_id = v_order_id,
    closed_at = now(),
    closed_by = v_uid,
    updated_at = now()
  where tt.id = v_ticket.id;

  return jsonb_build_object(
    'ticket_id', v_ticket.id,
    'order_id', v_order_id,
    'payment', coalesce(v_payment, '{}'::jsonb),
    'status', 'closed',
    'payment_status', 'paid'
  );
end;
$$;

revoke all on function public.rpc_salon_finalize_ticket_payment(uuid, text, numeric, text, text) from public;
grant execute on function public.rpc_salon_finalize_ticket_payment(uuid, text, numeric, text, text) to authenticated;

-- ------------------------------------------------------------
-- 4) Cocina web/local sin duplicados y sin delivered automático
-- ------------------------------------------------------------

drop function if exists public.rpc_sync_web_orders_to_kitchen();
create or replace function public.rpc_sync_web_orders_to_kitchen()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  rec record;
  v_command_id uuid;
  v_count integer := 0;
  v_status text;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not (public.is_admin_user(v_uid) or public.is_role_cocina(v_uid) or public.is_role_mozo(v_uid)) then
    raise exception 'FORBIDDEN';
  end if;

  for rec in
    select o.id, o.estado, o.short_code, o.comentario, o.created_at
    from public.orders o
    where lower(coalesce(o.modalidad, '')) not in ('salon', 'salón', 'mesa', 'local')
  loop
    if lower(coalesce(rec.estado, '')) in ('delivered', 'cancelled', 'completed', 'closed') then
      update public.kitchen_commands kc
      set status = 'cancelled', updated_at = now()
      where kc.source_type = 'web' and kc.order_id = rec.id and kc.status <> 'cancelled';
      continue;
    end if;

    v_status := case
      when lower(coalesce(rec.estado, '')) in ('preparing') then 'preparing'
      when lower(coalesce(rec.estado, '')) in ('ready') then 'ready'
      else 'pending'
    end;

    insert into public.kitchen_commands(
      source_type, order_id, status, note, table_name_snapshot, ticket_code_snapshot, created_by, created_at
    ) values (
      'web', rec.id, v_status,
      nullif(trim(coalesce(rec.comentario, '')), ''),
      'Pedido web',
      upper(coalesce(nullif(trim(coalesce(rec.short_code, '')), ''), left(replace(rec.id::text, '-', ''), 8))),
      v_uid,
      rec.created_at
    )
    on conflict (order_id)
    where source_type = 'web' and order_id is not null
    do update set
      status = excluded.status,
      note = excluded.note,
      ticket_code_snapshot = excluded.ticket_code_snapshot,
      updated_at = now()
    returning id into v_command_id;

    delete from public.kitchen_command_items where command_id = v_command_id;

    insert into public.kitchen_command_items(command_id, ticket_item_id, plato_id, qty, name_snapshot)
    select v_command_id, null, oi.plato_id, sum(oi.cantidad)::integer,
           max(coalesce(nullif(trim(coalesce(oi.nombre_snapshot, '')), ''), 'Producto'))
    from public.order_items oi
    where oi.order_id = rec.id
    group by oi.plato_id, lower(trim(coalesce(oi.nombre_snapshot, '')));

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.rpc_sync_web_orders_to_kitchen() from public;
grant execute on function public.rpc_sync_web_orders_to_kitchen() to authenticated;

-- ------------------------------------------------------------
-- 5) Reportes por canal: web vs local
-- ------------------------------------------------------------

drop function if exists public.rpc_sales_channel_summary(timestamptz, timestamptz);
create or replace function public.rpc_sales_channel_summary(date_from timestamptz, date_to timestamptz)
returns table(
  channel text,
  total_sales numeric,
  orders_count integer,
  avg_ticket numeric
)
language sql
security definer
set search_path = ''
as $$
  with base as (
    select
      case
        when lower(coalesce(o.modalidad, '')) in ('salon', 'salón', 'mesa', 'local') then 'local'
        else 'web'
      end as channel,
      coalesce(o.total, 0)::numeric as total
    from public.orders o
    where o.created_at >= date_from
      and o.created_at <= date_to
      and lower(coalesce(o.estado, '')) not in ('cancelled')
  )
  select
    b.channel,
    coalesce(sum(b.total), 0)::numeric as total_sales,
    count(*)::integer as orders_count,
    case when count(*) > 0 then round((sum(b.total) / count(*))::numeric, 2) else 0 end::numeric as avg_ticket
  from base b
  group by b.channel
  order by b.channel;
$$;

revoke all on function public.rpc_sales_channel_summary(timestamptz, timestamptz) from public;
grant execute on function public.rpc_sales_channel_summary(timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- 6) Usuarios internos y roles (backend)
-- ------------------------------------------------------------

alter table if exists public.admin_panel_user_roles enable row level security;

drop policy if exists admin_panel_user_roles_admin_select on public.admin_panel_user_roles;
create policy admin_panel_user_roles_admin_select
on public.admin_panel_user_roles
for select
to authenticated
using (public.is_admin_user(auth.uid()));

drop policy if exists admin_panel_user_roles_admin_insert on public.admin_panel_user_roles;
create policy admin_panel_user_roles_admin_insert
on public.admin_panel_user_roles
for insert
to authenticated
with check (public.is_admin_user(auth.uid()));

drop policy if exists admin_panel_user_roles_admin_update on public.admin_panel_user_roles;
create policy admin_panel_user_roles_admin_update
on public.admin_panel_user_roles
for update
to authenticated
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

create or replace function public.rpc_admin_set_user_role(p_user_id uuid, p_role text)
returns public.admin_panel_user_roles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := lower(trim(coalesce(p_role, '')));
  v_row public.admin_panel_user_roles%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  if v_role not in ('admin', 'cajero', 'mozo', 'cocina') then
    raise exception 'INVALID_ROLE';
  end if;

  insert into public.admin_panel_user_roles(user_id, role)
  values (p_user_id, v_role)
  on conflict (user_id) do update set role = excluded.role, updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rpc_admin_set_user_role(uuid, text) from public;
grant execute on function public.rpc_admin_set_user_role(uuid, text) to authenticated;

create or replace function public.rpc_admin_list_users()
returns table(
  user_id uuid,
  email text,
  created_at timestamptz,
  nombre text,
  apellidos text,
  role text
)
language sql
security definer
set search_path = ''
as $$
  select
    u.id as user_id,
    u.email,
    u.created_at,
    p.nombre,
    p.apellidos,
    coalesce(r.role, 'admin') as role
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.admin_panel_user_roles r on r.user_id = u.id
  where public.is_admin_user(auth.uid())
  order by u.created_at desc;
$$;

revoke all on function public.rpc_admin_list_users() from public;
grant execute on function public.rpc_admin_list_users() to authenticated;
