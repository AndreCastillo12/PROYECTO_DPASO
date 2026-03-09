-- Sprint 50: comandas parciales para salón + bloqueo de cobro por cocina pendiente

-- Permite múltiples envíos a cocina por ticket, enviando solo cantidades pendientes.
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
      greatest(0, ti.qty - coalesce(sbi.qty_sent, 0))::integer as pending_qty
    from public.table_ticket_items ti
    left join sent_by_item sbi on sbi.ticket_item_id = ti.id
    where ti.ticket_id = v_ticket.id
      and ti.status = 'active'
  )
  select coalesce(sum(pi.pending_qty), 0)::integer
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
    ti.name_snapshot
  from public.table_ticket_items ti
  left join sent_by_item sbi on sbi.ticket_item_id = ti.id
  where ti.ticket_id = v_ticket.id
    and ti.status = 'active'
    and greatest(0, ti.qty - coalesce(sbi.qty_sent, 0)) > 0;

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

-- Bloquea cobro/cierre si existe cocina pendiente o platos aún no enviados.
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
    select greatest(0, ti.qty - coalesce(sbi.qty_sent, 0))::integer as pending_qty
    from public.table_ticket_items ti
    left join sent_by_item sbi on sbi.ticket_item_id = ti.id
    where ti.ticket_id = v_ticket.id
      and ti.status = 'active'
  )
  select coalesce(sum(pi.pending_qty), 0)::integer
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
