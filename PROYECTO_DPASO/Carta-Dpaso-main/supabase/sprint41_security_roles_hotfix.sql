-- Sprint 41: hotfix crítico seguridad panel admin + roles + cocina web

-- 1) Rol admin panel sin fallback inseguro
create table if not exists public.admin_panel_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'cajero', 'mozo', 'cocina')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.get_admin_panel_role(uid uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when lower(coalesce(r.role, '')) in ('admin','cajero','mozo','cocina')
          then lower(r.role)
        else null
      end
      from public.admin_panel_user_roles r
      where r.user_id = uid
      limit 1
    ),
    'none'
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

-- 2) Hardening policies admin roles
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

-- 3) Pedidos/clientes: internos autorizados y clientes web sólo sus pedidos
alter table if exists public.orders enable row level security;

drop policy if exists orders_customer_select_own on public.orders;
create policy orders_customer_select_own
on public.orders
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists orders_admin_select_all on public.orders;
create policy orders_admin_select_all
on public.orders
for select
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_cajero(auth.uid())
  or public.is_role_mozo(auth.uid())
  or public.is_role_cocina(auth.uid())
);

drop policy if exists orders_admin_update_all on public.orders;
create policy orders_admin_update_all
on public.orders
for update
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_cajero(auth.uid())
  or public.is_role_mozo(auth.uid())
  or public.is_role_cocina(auth.uid())
)
with check (
  public.is_admin_user(auth.uid())
  or public.is_role_cajero(auth.uid())
  or public.is_role_mozo(auth.uid())
  or public.is_role_cocina(auth.uid())
);

alter table if exists public.customers enable row level security;

drop policy if exists customers_admin_select on public.customers;
create policy customers_admin_select
on public.customers
for select
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_cajero(auth.uid())
);

drop policy if exists customers_admin_insert on public.customers;
create policy customers_admin_insert
on public.customers
for insert
to authenticated
with check (
  public.is_admin_user(auth.uid())
  or public.is_role_cajero(auth.uid())
);

drop policy if exists customers_admin_update on public.customers;
create policy customers_admin_update
on public.customers
for update
to authenticated
using (
  public.is_admin_user(auth.uid())
  or public.is_role_cajero(auth.uid())
)
with check (
  public.is_admin_user(auth.uid())
  or public.is_role_cajero(auth.uid())
);

drop policy if exists customers_admin_delete on public.customers;
create policy customers_admin_delete
on public.customers
for delete
to authenticated
using (public.is_admin_user(auth.uid()));

-- 4) Usuarios internos: sólo whitelist (admin_panel_user_roles)
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

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'USER_NOT_FOUND';
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

create or replace function public.rpc_admin_set_user_role_by_email(p_email text, p_role text)
returns public.admin_panel_user_roles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := lower(trim(coalesce(p_role, '')));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_target_user_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  if v_email = '' then
    raise exception 'EMAIL_REQUIRED';
  end if;

  if v_role not in ('admin', 'cajero', 'mozo', 'cocina') then
    raise exception 'INVALID_ROLE';
  end if;

  select u.id into v_target_user_id
  from auth.users u
  where lower(coalesce(u.email, '')) = v_email
  order by u.created_at desc
  limit 1;

  if v_target_user_id is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  return public.rpc_admin_set_user_role(v_target_user_id, v_role);
end;
$$;

revoke all on function public.rpc_admin_set_user_role_by_email(text, text) from public;
grant execute on function public.rpc_admin_set_user_role_by_email(text, text) to authenticated;

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
    r.user_id,
    u.email,
    u.created_at,
    p.nombre,
    p.apellidos,
    r.role
  from public.admin_panel_user_roles r
  join auth.users u on u.id = r.user_id
  left join public.profiles p on p.id = r.user_id
  where public.is_admin_user(auth.uid())
  order by u.created_at desc;
$$;

revoke all on function public.rpc_admin_list_users() from public;
grant execute on function public.rpc_admin_list_users() to authenticated;

-- 5) Cocina web: ticket_id nullable si source_type='web'
alter table if exists public.kitchen_commands
  alter column ticket_id drop not null;

alter table if exists public.kitchen_commands
  alter column table_id drop not null;

alter table if exists public.kitchen_commands
  drop constraint if exists kitchen_commands_source_type_check;

alter table if exists public.kitchen_commands
  add constraint kitchen_commands_source_type_check
  check (source_type in ('salon', 'web'));

alter table if exists public.kitchen_commands
  drop constraint if exists kitchen_commands_origin_requirements_check;

alter table if exists public.kitchen_commands
  add constraint kitchen_commands_origin_requirements_check
  check (
    (source_type = 'salon' and ticket_id is not null and table_id is not null)
    or
    (source_type = 'web' and order_id is not null)
  );

create or replace function public.rpc_sync_web_orders_to_kitchen()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inserted integer := 0;
  rec record;
  v_command_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not (public.is_admin_user(v_uid) or public.is_role_cocina(v_uid) or public.is_role_mozo(v_uid)) then
    raise exception 'FORBIDDEN';
  end if;

  for rec in
    select o.id as order_id
    from public.orders o
    where lower(coalesce(o.modalidad, '')) in ('delivery', 'recojo')
      and lower(coalesce(o.estado, '')) in ('pendiente', 'confirmado', 'en_preparacion', 'en preparación')
      and not exists (
        select 1
        from public.kitchen_commands kc
        where kc.order_id = o.id
          and kc.source_type = 'web'
          and kc.status in ('pending', 'preparing', 'ready')
      )
    order by o.created_at asc
  loop
    insert into public.kitchen_commands(
      ticket_id,
      table_id,
      status,
      note,
      table_name_snapshot,
      ticket_code_snapshot,
      source_type,
      order_id,
      created_by
    )
    values (
      null,
      null,
      'pending',
      'Pedido web',
      'WEB',
      upper(left(replace(rec.order_id::text, '-', ''), 8)),
      'web',
      rec.order_id,
      v_uid
    )
    on conflict (order_id)
    where source_type = 'web' and order_id is not null
    do update set
      note = excluded.note,
      updated_at = now()
    returning id into v_command_id;

    insert into public.kitchen_command_items(command_id, ticket_item_id, plato_id, qty, name_snapshot)
    select
      v_command_id,
      null,
      oi.plato_id,
      oi.cantidad,
      coalesce(oi.nombre_producto, 'Producto')
    from public.order_items oi
    where oi.order_id = rec.order_id
    on conflict do nothing;

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.rpc_sync_web_orders_to_kitchen() from public;
grant execute on function public.rpc_sync_web_orders_to_kitchen() to authenticated;
