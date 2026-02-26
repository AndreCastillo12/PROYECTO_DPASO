-- Sprint 39: fixes de cocina + caja + visibilidad de pedidos salón

-- Extender comandas para soportar origen web
alter table if exists public.kitchen_commands
  add column if not exists source_type text not null default 'salon';

alter table if exists public.kitchen_commands
  add column if not exists order_id uuid references public.orders(id) on delete cascade;

alter table if exists public.kitchen_commands
  drop constraint if exists kitchen_commands_source_type_check;

alter table if exists public.kitchen_commands
  add constraint kitchen_commands_source_type_check
  check (source_type in ('salon', 'web'));

create unique index if not exists kitchen_commands_salon_ticket_uidx
  on public.kitchen_commands(ticket_id)
  where source_type = 'salon';

create unique index if not exists kitchen_commands_web_order_uidx
  on public.kitchen_commands(order_id)
  where source_type = 'web' and order_id is not null;

-- RLS de comandas web
alter table if exists public.kitchen_commands enable row level security;
alter table if exists public.kitchen_command_items enable row level security;

-- Fix envío salón -> cocina (evitar min(uuid))
drop function if exists public.rpc_salon_send_to_kitchen(uuid, text);
create or replace function public.rpc_salon_send_to_kitchen(
  p_ticket_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ticket public.table_tickets%rowtype;
  v_table public.restaurant_tables%rowtype;
  v_existing uuid;
  v_command_id uuid;
  v_item_count integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not (public.is_admin_user(v_uid) or public.is_role_mozo(v_uid)) then
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
    raise exception 'TICKET_CLOSED';
  end if;

  select count(*) into v_item_count
  from public.table_ticket_items ti
  where ti.ticket_id = v_ticket.id
    and ti.status = 'active';

  if v_item_count <= 0 then
    raise exception 'EMPTY_TICKET';
  end if;

  select kc.id into v_existing
  from public.kitchen_commands kc
  where kc.ticket_id = v_ticket.id
    and kc.status in ('pending', 'preparing')
  order by kc.created_at desc
  limit 1;

  if v_existing is not null then
    raise exception 'COMMAND_ALREADY_OPEN';
  end if;

  select * into v_table
  from public.restaurant_tables rt
  where rt.id = v_ticket.table_id;

  insert into public.kitchen_commands (
    ticket_id,
    table_id,
    status,
    note,
    table_name_snapshot,
    ticket_code_snapshot,
    source_type,
    created_by
  )
  values (
    v_ticket.id,
    v_ticket.table_id,
    'pending',
    nullif(trim(coalesce(p_note, '')), ''),
    coalesce(v_table.table_name, 'Mesa'),
    upper(left(replace(v_ticket.id::text, '-', ''), 8)),
    'salon',
    v_uid
  )
  returning id into v_command_id;

  insert into public.kitchen_command_items(command_id, ticket_item_id, plato_id, qty, name_snapshot)
  select
    v_command_id,
    (array_agg(ti.id order by ti.created_at))[1] as ticket_item_id,
    ti.plato_id,
    sum(ti.qty)::integer,
    max(ti.name_snapshot)
  from public.table_ticket_items ti
  where ti.ticket_id = v_ticket.id
    and ti.status = 'active'
  group by ti.plato_id, lower(trim(coalesce(ti.name_snapshot, '')));

  update public.table_tickets tt
  set status = 'sent_to_kitchen',
      updated_at = now()
  where tt.id = v_ticket.id
    and tt.status not in ('closed', 'cancelled');

  return v_command_id;
end;
$$;

revoke all on function public.rpc_salon_send_to_kitchen(uuid, text) from public;
grant execute on function public.rpc_salon_send_to_kitchen(uuid, text) to authenticated;

-- Sync de pedidos web a comandas
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
    select o.id,
           o.estado,
           o.short_code,
           o.comentario,
           o.created_at
    from public.orders o
    where lower(coalesce(o.modalidad, '')) not in ('salon', 'salón', 'mesa', 'local')
  loop
    if lower(coalesce(rec.estado, '')) in ('delivered', 'cancelled') then
      update public.kitchen_commands kc
      set status = 'cancelled',
          updated_at = now()
      where kc.source_type = 'web'
        and kc.order_id = rec.id
        and kc.status <> 'cancelled';
      continue;
    end if;

    v_status := case
      when lower(coalesce(rec.estado, '')) in ('preparing') then 'preparing'
      when lower(coalesce(rec.estado, '')) in ('ready') then 'ready'
      else 'pending'
    end;

    insert into public.kitchen_commands(
      source_type,
      order_id,
      status,
      note,
      table_name_snapshot,
      ticket_code_snapshot,
      created_by,
      created_at
    )
    values (
      'web',
      rec.id,
      v_status,
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

    delete from public.kitchen_command_items kci
    where kci.command_id = v_command_id;

    insert into public.kitchen_command_items(command_id, ticket_item_id, plato_id, qty, name_snapshot)
    select
      v_command_id,
      null,
      oi.plato_id,
      sum(oi.cantidad)::integer,
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

-- Registrar pago con movimiento de caja (efectivo) y permitir cajero

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

  if v_method = 'cash' and v_open_session_id is not null then
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

-- Avance de comanda soportando salón y web

drop function if exists public.rpc_kitchen_update_command_status(uuid, text);
create or replace function public.rpc_kitchen_update_command_status(
  p_command_id uuid,
  p_next_status text
)
returns public.kitchen_commands
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cmd public.kitchen_commands%rowtype;
  v_next text := lower(trim(coalesce(p_next_status, '')));
  v_order_status text;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not (public.is_admin_user(v_uid) or public.is_role_cocina(v_uid)) then
    raise exception 'FORBIDDEN';
  end if;

  if v_next not in ('preparing', 'ready') then
    raise exception 'INVALID_STATUS';
  end if;

  select * into v_cmd
  from public.kitchen_commands kc
  where kc.id = p_command_id
  for update;

  if not found then
    raise exception 'COMMAND_NOT_FOUND';
  end if;

  if v_cmd.status = 'pending' and v_next <> 'preparing' then
    raise exception 'INVALID_TRANSITION';
  end if;

  if v_cmd.status = 'preparing' and v_next <> 'ready' then
    raise exception 'INVALID_TRANSITION';
  end if;

  if v_cmd.status = 'ready' then
    return v_cmd;
  end if;

  update public.kitchen_commands kc
  set status = v_next,
      updated_at = now()
  where kc.id = v_cmd.id
  returning * into v_cmd;

  if coalesce(v_cmd.source_type, 'salon') = 'salon' and v_next = 'ready' then
    update public.table_tickets tt
    set status = 'ready',
        updated_at = now()
    where tt.id = v_cmd.ticket_id
      and tt.status not in ('closed', 'cancelled');

    update public.orders o
    set estado = 'ready'
    where o.ticket_id = v_cmd.ticket_id
      and lower(coalesce(o.modalidad, '')) in ('salon', 'salón', 'local', 'mesa')
      and lower(coalesce(o.estado, '')) not in ('delivered', 'cancelled');
  end if;

  if coalesce(v_cmd.source_type, 'salon') = 'web' and v_cmd.order_id is not null then
    v_order_status := case when v_next = 'ready' then 'ready' else 'preparing' end;
    update public.orders o
    set estado = v_order_status,
        updated_at = now()
    where o.id = v_cmd.order_id
      and lower(coalesce(o.estado, '')) not in ('delivered', 'cancelled');
  end if;

  return v_cmd;
end;
$$;

revoke all on function public.rpc_kitchen_update_command_status(uuid, text) from public;
grant execute on function public.rpc_kitchen_update_command_status(uuid, text) to authenticated;
