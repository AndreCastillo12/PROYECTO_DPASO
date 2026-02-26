-- Sprint 38: roles MVP + comandas cocina + reglas salón

create table if not exists public.admin_panel_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'cajero', 'mozo', 'cocina')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at_admin_panel_user_roles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_admin_panel_user_roles_updated_at on public.admin_panel_user_roles;
create trigger trg_admin_panel_user_roles_updated_at
before update on public.admin_panel_user_roles
for each row execute function public.set_updated_at_admin_panel_user_roles();

create or replace function public.get_admin_panel_role(uid uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select r.role
      from public.admin_panel_user_roles r
      where r.user_id = uid
      limit 1
    ),
    (
      select case when lower(coalesce(p.role, '')) in ('admin','cajero','mozo','cocina') then lower(p.role) else null end
      from public.profiles p
      where p.id = uid
      limit 1
    ),
    'admin'
  );
$$;

create or replace function public.is_admin_user(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.get_admin_panel_role(uid) = 'admin';
$$;

create or replace function public.is_role_cajero(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.get_admin_panel_role(uid) in ('admin', 'cajero');
$$;

create or replace function public.is_role_mozo(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.get_admin_panel_role(uid) in ('admin', 'mozo');
$$;

create or replace function public.is_role_cocina(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.get_admin_panel_role(uid) in ('admin', 'cocina');
$$;

revoke all on function public.get_admin_panel_role(uuid) from public;
revoke all on function public.is_admin_user(uuid) from public;
revoke all on function public.is_role_cajero(uuid) from public;
revoke all on function public.is_role_mozo(uuid) from public;
revoke all on function public.is_role_cocina(uuid) from public;

grant execute on function public.get_admin_panel_role(uuid) to authenticated;
grant execute on function public.is_admin_user(uuid) to authenticated;
grant execute on function public.is_role_cajero(uuid) to authenticated;
grant execute on function public.is_role_mozo(uuid) to authenticated;
grant execute on function public.is_role_cocina(uuid) to authenticated;

create table if not exists public.kitchen_commands (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.table_tickets(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'preparing', 'ready', 'cancelled')),
  note text,
  table_name_snapshot text,
  ticket_code_snapshot text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kitchen_command_items (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.kitchen_commands(id) on delete cascade,
  ticket_item_id uuid references public.table_ticket_items(id) on delete set null,
  plato_id uuid,
  qty integer not null check (qty > 0),
  name_snapshot text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kitchen_commands_ticket_idx on public.kitchen_commands(ticket_id, created_at desc);
create index if not exists kitchen_commands_status_idx on public.kitchen_commands(status, created_at);
create index if not exists kitchen_command_items_command_idx on public.kitchen_command_items(command_id, created_at);

create or replace function public.set_updated_at_kitchen_commands()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_kitchen_commands_updated_at on public.kitchen_commands;
create trigger trg_kitchen_commands_updated_at
before update on public.kitchen_commands
for each row execute function public.set_updated_at_kitchen_commands();

create or replace function public.set_updated_at_kitchen_command_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_kitchen_command_items_updated_at on public.kitchen_command_items;
create trigger trg_kitchen_command_items_updated_at
before update on public.kitchen_command_items
for each row execute function public.set_updated_at_kitchen_command_items();

alter table if exists public.kitchen_commands enable row level security;
alter table if exists public.kitchen_command_items enable row level security;

alter table if exists public.table_tickets enable row level security;
alter table if exists public.table_ticket_items enable row level security;

drop policy if exists kitchen_commands_select_role on public.kitchen_commands;
create policy kitchen_commands_select_role
on public.kitchen_commands
for select
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_cocina(auth.uid())
  or public.is_role_mozo(auth.uid())
);

drop policy if exists kitchen_commands_insert_role on public.kitchen_commands;
create policy kitchen_commands_insert_role
on public.kitchen_commands
for insert
to authenticated
with check (
  public.is_admin_user(auth.uid())
  or public.is_role_mozo(auth.uid())
);

drop policy if exists kitchen_commands_update_role on public.kitchen_commands;
create policy kitchen_commands_update_role
on public.kitchen_commands
for update
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_cocina(auth.uid())
)
with check (
  public.is_admin_user(auth.uid())
  or public.is_role_cocina(auth.uid())
);

drop policy if exists kitchen_command_items_select_role on public.kitchen_command_items;
create policy kitchen_command_items_select_role
on public.kitchen_command_items
for select
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_cocina(auth.uid())
  or public.is_role_mozo(auth.uid())
);

drop policy if exists kitchen_command_items_insert_role on public.kitchen_command_items;
create policy kitchen_command_items_insert_role
on public.kitchen_command_items
for insert
to authenticated
with check (
  public.is_admin_user(auth.uid())
  or public.is_role_mozo(auth.uid())
);

drop policy if exists table_tickets_role_select on public.table_tickets;
create policy table_tickets_role_select
on public.table_tickets
for select
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_mozo(auth.uid())
  or public.is_role_cajero(auth.uid())
  or public.is_role_cocina(auth.uid())
);

drop policy if exists table_tickets_role_insert on public.table_tickets;
create policy table_tickets_role_insert
on public.table_tickets
for insert
to authenticated
with check (
  public.is_admin_user(auth.uid())
  or public.is_role_mozo(auth.uid())
);

drop policy if exists table_tickets_role_update on public.table_tickets;
create policy table_tickets_role_update
on public.table_tickets
for update
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_mozo(auth.uid())
  or public.is_role_cajero(auth.uid())
)
with check (
  public.is_admin_user(auth.uid())
  or public.is_role_mozo(auth.uid())
  or public.is_role_cajero(auth.uid())
);

drop policy if exists table_ticket_items_role_select on public.table_ticket_items;
create policy table_ticket_items_role_select
on public.table_ticket_items
for select
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_mozo(auth.uid())
  or public.is_role_cajero(auth.uid())
  or public.is_role_cocina(auth.uid())
);

drop policy if exists table_ticket_items_role_insert on public.table_ticket_items;
create policy table_ticket_items_role_insert
on public.table_ticket_items
for insert
to authenticated
with check (
  public.is_admin_user(auth.uid())
  or public.is_role_mozo(auth.uid())
);

drop policy if exists table_ticket_items_role_update on public.table_ticket_items;
create policy table_ticket_items_role_update
on public.table_ticket_items
for update
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_mozo(auth.uid())
)
with check (
  public.is_admin_user(auth.uid())
  or public.is_role_mozo(auth.uid())
);

drop policy if exists table_ticket_items_role_delete on public.table_ticket_items;
create policy table_ticket_items_role_delete
on public.table_ticket_items
for delete
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_mozo(auth.uid())
);

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
    created_by
  )
  values (
    v_ticket.id,
    v_ticket.table_id,
    'pending',
    nullif(trim(coalesce(p_note, '')), ''),
    coalesce(v_table.table_name, 'Mesa'),
    upper(left(replace(v_ticket.id::text, '-', ''), 8)),
    v_uid
  )
  returning id into v_command_id;

  insert into public.kitchen_command_items(command_id, ticket_item_id, plato_id, qty, name_snapshot)
  select
    v_command_id,
    min(ti.id) as ticket_item_id,
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
  end if;

  return v_cmd;
end;
$$;

revoke all on function public.rpc_kitchen_update_command_status(uuid, text) from public;
grant execute on function public.rpc_kitchen_update_command_status(uuid, text) to authenticated;

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

  if not (public.is_admin_user(v_uid) or public.is_role_mozo(v_uid)) then
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
      'delivered',
      true,
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

  update public.orders o
  set estado = 'delivered',
      paid = true,
      updated_at = now()
  where o.id = v_order_id
    and lower(coalesce(o.modalidad, '')) in ('salon', 'salón', 'local', 'mesa');

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
