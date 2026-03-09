-- Sprint 51: historial real de tickets local/salón para Detalle del pedido

create table if not exists public.ticket_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.table_tickets(id) on delete cascade,
  order_id uuid null references public.orders(id) on delete set null,
  event_key text not null,
  event_label text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create index if not exists ticket_lifecycle_events_ticket_idx
  on public.ticket_lifecycle_events(ticket_id, created_at asc);

create index if not exists ticket_lifecycle_events_order_idx
  on public.ticket_lifecycle_events(order_id, created_at asc)
  where order_id is not null;

alter table if exists public.ticket_lifecycle_events enable row level security;

drop policy if exists ticket_lifecycle_events_admin_select on public.ticket_lifecycle_events;
create policy ticket_lifecycle_events_admin_select
on public.ticket_lifecycle_events
for select
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_cajero(auth.uid())
  or public.is_role_mozo(auth.uid())
  or public.is_role_cocina(auth.uid())
);

drop policy if exists ticket_lifecycle_events_admin_insert on public.ticket_lifecycle_events;
create policy ticket_lifecycle_events_admin_insert
on public.ticket_lifecycle_events
for insert
to authenticated
with check (
  public.is_admin_user(auth.uid())
  or public.is_role_cajero(auth.uid())
  or public.is_role_mozo(auth.uid())
  or public.is_role_cocina(auth.uid())
);

create or replace function public.rpc_ticket_log_event(
  p_ticket_id uuid,
  p_event_key text,
  p_event_label text,
  p_payload jsonb default '{}'::jsonb,
  p_order_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not (
    public.is_admin_user(v_uid)
    or public.is_role_cajero(v_uid)
    or public.is_role_mozo(v_uid)
    or public.is_role_cocina(v_uid)
  ) then
    raise exception 'FORBIDDEN';
  end if;

  insert into public.ticket_lifecycle_events(ticket_id, order_id, event_key, event_label, payload, created_by)
  values (
    p_ticket_id,
    p_order_id,
    lower(trim(coalesce(p_event_key, 'unknown'))),
    coalesce(nullif(trim(coalesce(p_event_label, '')), ''), 'Evento'),
    coalesce(p_payload, '{}'::jsonb),
    v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.rpc_ticket_log_event(uuid, text, text, jsonb, uuid) from public;
grant execute on function public.rpc_ticket_log_event(uuid, text, text, jsonb, uuid) to authenticated;

-- Registrar apertura real de ticket.
drop function if exists public.rpc_salon_open_ticket(uuid, text);
create or replace function public.rpc_salon_open_ticket(p_table_id uuid, p_notes text default null)
returns public.table_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.table_tickets%rowtype;
  v_ticket public.table_tickets%rowtype;
  v_table public.restaurant_tables%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not (public.is_admin_user(v_uid) or public.is_role_mozo(v_uid)) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_table
  from public.restaurant_tables rt
  where rt.id = p_table_id;

  if not found then
    raise exception 'TABLE_NOT_FOUND';
  end if;

  select * into v_existing
  from public.table_tickets tt
  where tt.table_id = p_table_id
    and tt.status not in ('closed', 'cancelled')
  order by tt.opened_at desc
  limit 1;

  if found then
    return v_existing;
  end if;

  insert into public.table_tickets(table_id, status, payment_status, opened_by, notes)
  values (p_table_id, 'open', 'unpaid', v_uid, nullif(trim(coalesce(p_notes, '')), ''))
  returning * into v_ticket;

  perform public.rpc_ticket_log_event(
    v_ticket.id,
    'ticket_opened',
    'Ticket abierto',
    jsonb_build_object('table_id', v_table.id, 'table_name', v_table.table_name),
    null
  );

  return v_ticket;
end;
$$;

revoke all on function public.rpc_salon_open_ticket(uuid, text) from public;
grant execute on function public.rpc_salon_open_ticket(uuid, text) to authenticated;

-- Registrar paso a cobro u otros cambios de estado operativos del ticket.
drop function if exists public.rpc_salon_set_ticket_status(uuid, text);
create or replace function public.rpc_salon_set_ticket_status(
  p_ticket_id uuid,
  p_next_status text
)
returns public.table_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ticket public.table_tickets%rowtype;
  v_next text := lower(trim(coalesce(p_next_status, '')));
  v_label text := null;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not (public.is_admin_user(v_uid) or public.is_role_mozo(v_uid) or public.is_role_cajero(v_uid)) then
    raise exception 'FORBIDDEN';
  end if;

  if v_next not in ('open', 'sent_to_kitchen', 'ready', 'closing', 'cancelled') then
    raise exception 'INVALID_STATUS';
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

  update public.table_tickets tt
  set status = v_next,
      updated_at = now()
  where tt.id = v_ticket.id
  returning * into v_ticket;

  if v_next = 'closing' then
    v_label := 'Pasó a cobro';
  elsif v_next = 'open' then
    v_label := 'Volvió a edición';
  elsif v_next = 'ready' then
    v_label := 'Pedido listo';
  end if;

  if v_label is not null then
    perform public.rpc_ticket_log_event(v_ticket.id, 'ticket_status_' || v_next, v_label, jsonb_build_object('status', v_next), v_ticket.generated_order_id);
  end if;

  return v_ticket;
end;
$$;

revoke all on function public.rpc_salon_set_ticket_status(uuid, text) from public;
grant execute on function public.rpc_salon_set_ticket_status(uuid, text) to authenticated;

-- Envío a cocina con evento real de primera/adicional.
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
  v_command_id uuid;
  v_pending_qty integer;
  v_command_count integer := 0;
  v_label text;
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

  with sent_by_item as (
    select
      kci.ticket_item_id,
      sum(kci.qty)::integer as qty_sent
    from public.kitchen_command_items kci
    join public.kitchen_commands kc on kc.id = kci.command_id
    where kc.ticket_id = v_ticket.id
      and coalesce(kc.source_type, 'salon') = 'salon'
      and kci.ticket_item_id is not null
    group by kci.ticket_item_id
  ), pending_items as (
    select
      ti.id,
      greatest(0, ti.qty - coalesce(sbi.qty_sent, 0))::integer as pending_qty,
      not (
        lower(coalesce(c.nombre, '')) like any (array['%bebida%','%drink%','%trago%'])
        or lower(coalesce(ti.name_snapshot, '')) like any (array['%bebida%','%gaseosa%','%jugo%','%agua%','%cerveza%'])
      ) as kitchen_required
    from public.table_ticket_items ti
    left join sent_by_item sbi on sbi.ticket_item_id = ti.id
    left join public.platos p on p.id = ti.plato_id
    left join public.categorias c on c.id = p.categoria_id
    where ti.ticket_id = v_ticket.id
      and ti.status = 'active'
  )
  select coalesce(sum(case when pi.kitchen_required then pi.pending_qty else 0 end), 0)::integer
  into v_pending_qty
  from pending_items pi;

  if coalesce(v_pending_qty, 0) <= 0 then
    raise exception 'NOTHING_TO_SEND';
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

  with sent_by_item as (
    select
      kci.ticket_item_id,
      sum(kci.qty)::integer as qty_sent
    from public.kitchen_command_items kci
    join public.kitchen_commands kc on kc.id = kci.command_id
    where kc.ticket_id = v_ticket.id
      and coalesce(kc.source_type, 'salon') = 'salon'
      and kci.ticket_item_id is not null
    group by kci.ticket_item_id
  )
  insert into public.kitchen_command_items(command_id, ticket_item_id, plato_id, qty, name_snapshot)
  select
    v_command_id,
    ti.id,
    ti.plato_id,
    greatest(0, ti.qty - coalesce(sbi.qty_sent, 0))::integer,
    case
      when nullif(trim(coalesce(ti.notes, '')), '') is not null
        then coalesce(ti.name_snapshot, 'Producto') || ' (Obs: ' || trim(ti.notes) || ')'
      else coalesce(ti.name_snapshot, 'Producto')
    end
  from public.table_ticket_items ti
  left join sent_by_item sbi on sbi.ticket_item_id = ti.id
  left join public.platos p on p.id = ti.plato_id
  left join public.categorias c on c.id = p.categoria_id
  where ti.ticket_id = v_ticket.id
    and ti.status = 'active'
    and greatest(0, ti.qty - coalesce(sbi.qty_sent, 0)) > 0
    and not (
      lower(coalesce(c.nombre, '')) like any (array['%bebida%','%drink%','%trago%'])
      or lower(coalesce(ti.name_snapshot, '')) like any (array['%bebida%','%gaseosa%','%jugo%','%agua%','%cerveza%'])
    );

  update public.table_tickets tt
  set status = 'sent_to_kitchen',
      updated_at = now()
  where tt.id = v_ticket.id
    and tt.status not in ('closed', 'cancelled');

  select count(*)::integer into v_command_count
  from public.kitchen_commands kc
  where kc.ticket_id = v_ticket.id
    and coalesce(kc.source_type, 'salon') = 'salon';

  v_label := case when v_command_count <= 1 then 'Primera comanda enviada a cocina' else 'Comanda adicional enviada a cocina' end;

  perform public.rpc_ticket_log_event(
    v_ticket.id,
    case when v_command_count <= 1 then 'kitchen_command_first_sent' else 'kitchen_command_additional_sent' end,
    v_label,
    jsonb_build_object('command_id', v_command_id, 'command_number', v_command_count, 'note', nullif(trim(coalesce(p_note, '')), '')),
    v_ticket.generated_order_id
  );

  return v_command_id;
end;
$$;

revoke all on function public.rpc_salon_send_to_kitchen(uuid, text) from public;
grant execute on function public.rpc_salon_send_to_kitchen(uuid, text) to authenticated;

-- Cocina: registrar preparación/listo/servido en historial de ticket salón.
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
  v_prev_status text;
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

  v_prev_status := v_cmd.status;

  update public.kitchen_commands kc
  set status = v_next,
      updated_at = now()
  where kc.id = v_cmd.id
  returning * into v_cmd;

  if coalesce(v_cmd.source_type, 'salon') = 'salon' then
    if v_next = 'preparing' then
      perform public.rpc_ticket_log_event(v_cmd.ticket_id, 'kitchen_preparing', 'Preparación iniciada', jsonb_build_object('command_id', v_cmd.id), null);
    end if;

    if v_next = 'ready' then
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

      perform public.rpc_ticket_log_event(v_cmd.ticket_id, 'kitchen_ready', 'Pedido listo', jsonb_build_object('command_id', v_cmd.id), v_cmd.order_id);
      perform public.rpc_ticket_log_event(v_cmd.ticket_id, 'served_to_table', 'Entregado en mesa', jsonb_build_object('command_id', v_cmd.id), v_cmd.order_id);
    end if;
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

-- Cierre/pago: registrar pago y cierre como eventos reales.
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
  v_has_pending_kitchen boolean := false;
  v_unsent_qty integer := 0;
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

  select exists (
    select 1
    from public.kitchen_commands kc
    where kc.ticket_id = v_ticket.id
      and coalesce(kc.source_type, 'salon') = 'salon'
      and kc.status in ('pending', 'preparing')
  ) into v_has_pending_kitchen;

  with sent_by_item as (
    select
      kci.ticket_item_id,
      sum(kci.qty)::integer as qty_sent
    from public.kitchen_command_items kci
    join public.kitchen_commands kc on kc.id = kci.command_id
    where kc.ticket_id = v_ticket.id
      and coalesce(kc.source_type, 'salon') = 'salon'
      and kci.ticket_item_id is not null
    group by kci.ticket_item_id
  ), pending_items as (
    select
      greatest(0, ti.qty - coalesce(sbi.qty_sent, 0))::integer as pending_qty,
      not (
        lower(coalesce(c.nombre, '')) like any (array['%bebida%','%drink%','%trago%'])
        or lower(coalesce(ti.name_snapshot, '')) like any (array['%bebida%','%gaseosa%','%jugo%','%agua%','%cerveza%'])
      ) as kitchen_required
    from public.table_ticket_items ti
    left join sent_by_item sbi on sbi.ticket_item_id = ti.id
    left join public.platos p on p.id = ti.plato_id
    left join public.categorias c on c.id = p.categoria_id
    where ti.ticket_id = v_ticket.id
      and ti.status = 'active'
  )
  select coalesce(sum(case when pi.kitchen_required then pi.pending_qty else 0 end), 0)::integer
  into v_unsent_qty
  from pending_items pi;

  if v_has_pending_kitchen or coalesce(v_unsent_qty, 0) > 0 then
    raise exception 'TICKET_KITCHEN_PENDING';
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

  perform public.rpc_ticket_log_event(
    v_ticket.id,
    'payment_registered',
    'Pago registrado',
    jsonb_build_object(
      'order_id', v_order_id,
      'method', v_payment->>'payment_method',
      'cash_received', v_payment->>'cash_received',
      'cash_change', v_payment->>'cash_change'
    ),
    v_order_id
  );

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

  perform public.rpc_ticket_log_event(
    v_ticket.id,
    'ticket_closed',
    'Ticket cerrado',
    jsonb_build_object('order_id', v_order_id),
    v_order_id
  );

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
