-- Sprint 37: Salón POS + precuenta + cobro integrado (sin romper delivery/recojo)

-- Extensión de estados de ticket y estado de pago
alter table if exists public.table_tickets
  add column if not exists payment_status text not null default 'unpaid';

alter table if exists public.table_tickets
  drop constraint if exists table_tickets_status_check;

alter table if exists public.table_tickets
  add constraint table_tickets_status_check
  check (status in ('open', 'sent_to_kitchen', 'ready', 'served', 'closing', 'closed', 'cancelled'));

alter table if exists public.table_tickets
  drop constraint if exists table_tickets_payment_status_check;

alter table if exists public.table_tickets
  add constraint table_tickets_payment_status_check
  check (payment_status in ('unpaid', 'paid'));

-- Apertura de ticket controlada (1 abierto por mesa)
drop function if exists public.rpc_salon_open_ticket(uuid, text);
create or replace function public.rpc_salon_open_ticket(p_table_id uuid, p_notes text default null)
returns public.table_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_table public.restaurant_tables%rowtype;
  v_existing public.table_tickets%rowtype;
  v_ticket public.table_tickets%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_table
  from public.restaurant_tables rt
  where rt.id = p_table_id
  for update;

  if not found then
    raise exception 'TABLE_NOT_FOUND';
  end if;

  if not coalesce(v_table.active, false) then
    raise exception 'TABLE_INACTIVE';
  end if;

  select * into v_existing
  from public.table_tickets tt
  where tt.table_id = v_table.id
    and tt.status <> 'closed'
    and tt.status <> 'cancelled'
  order by tt.opened_at desc
  limit 1;

  if found then
    return v_existing;
  end if;

  insert into public.table_tickets(table_id, status, payment_status, opened_by, notes)
  values (v_table.id, 'open', 'unpaid', v_uid, nullif(trim(coalesce(p_notes, '')), ''))
  returning * into v_ticket;

  return v_ticket;
end;
$$;

revoke all on function public.rpc_salon_open_ticket(uuid, text) from public;
grant execute on function public.rpc_salon_open_ticket(uuid, text) to authenticated;

-- Cierre/cobro del ticket: genera order final salón + pago normal
-- cash requiere caja abierta por rpc_register_order_payment

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

  if not public.is_admin_user(v_uid) then
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

  select * into v_table
  from public.restaurant_tables rt
  where rt.id = v_ticket.table_id;

  if not found then
    raise exception 'TABLE_NOT_FOUND';
  end if;

  select coalesce(sum(ti.qty * ti.price_snapshot), 0)::numeric(10,2)
  into v_total
  from public.table_ticket_items ti
  where ti.ticket_id = v_ticket.id
    and ti.status = 'active';

  if v_total <= 0 then
    raise exception 'EMPTY_TICKET';
  end if;

  v_order_id := v_ticket.generated_order_id;

  if v_order_id is null then
    insert into public.orders(
      nombre_cliente,
      telefono,
      modalidad,
      direccion,
      referencia,
      comentario,
      subtotal,
      delivery_fee,
      total,
      estado,
      paid,
      table_number,
      table_id,
      ticket_id
    )
    values (
      coalesce(nullif(trim(v_table.table_name), ''), 'Mesa salón'),
      '000000000',
      'salon',
      v_table.table_name,
      'Ticket salón',
      null,
      v_total,
      0,
      v_total,
      'pending',
      false,
      v_table.table_name,
      v_table.id,
      v_ticket.id
    )
    returning id into v_order_id;

    insert into public.order_items(
      order_id,
      plato_id,
      nombre_snapshot,
      precio_snapshot,
      cantidad,
      subtotal
    )
    select
      v_order_id,
      ti.plato_id,
      ti.name_snapshot,
      ti.price_snapshot,
      ti.qty,
      round((ti.qty * ti.price_snapshot)::numeric, 2)
    from public.table_ticket_items ti
    where ti.ticket_id = v_ticket.id
      and ti.status = 'active';
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
