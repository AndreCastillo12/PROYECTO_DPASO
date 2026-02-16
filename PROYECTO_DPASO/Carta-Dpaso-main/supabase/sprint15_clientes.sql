-- Sprint 15: Clientes (CRM básico)

create extension if not exists pgcrypto;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  normalized_phone text,
  auth_user_id uuid references auth.users(id),
  email text,
  account_type text not null default 'guest',
  total_orders integer not null default 0,
  total_spent numeric(12,2) not null default 0,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.customers
  add column if not exists normalized_phone text,
  add column if not exists auth_user_id uuid references auth.users(id),
  add column if not exists email text,
  add column if not exists account_type text not null default 'guest',
  add column if not exists total_orders integer not null default 0,
  add column if not exists total_spent numeric(12,2) not null default 0,
  add column if not exists last_order_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

drop index if exists public.customers_phone_uidx;
create unique index if not exists customers_guest_phone_uidx on public.customers(phone) where auth_user_id is null;
create unique index if not exists customers_auth_user_uidx on public.customers(auth_user_id) where auth_user_id is not null;
create index if not exists customers_last_order_idx on public.customers(last_order_at desc);
create index if not exists customers_total_spent_idx on public.customers(total_spent desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customers_account_type_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_account_type_check
      check (account_type in ('guest','registered'));
  end if;
end $$;


alter table if exists public.orders
  add column if not exists customer_id uuid references public.customers(id);

create index if not exists orders_customer_id_idx on public.orders(customer_id);

create or replace function public.set_updated_at_customers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at_customers();

alter table public.customers enable row level security;

drop policy if exists customers_admin_select on public.customers;
create policy customers_admin_select
on public.customers for select
to authenticated
using (public.is_admin_user(auth.uid()));

drop policy if exists customers_admin_insert on public.customers;
create policy customers_admin_insert
on public.customers for insert
to authenticated
with check (public.is_admin_user(auth.uid()));

drop policy if exists customers_admin_update on public.customers;
create policy customers_admin_update
on public.customers for update
to authenticated
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

drop policy if exists customers_admin_delete on public.customers;
create policy customers_admin_delete
on public.customers for delete
to authenticated
using (public.is_admin_user(auth.uid()));

-- Backfill opcional: reconstruir clientes desde pedidos históricos
-- Vincula pedidos viejos por teléfono cuando no tengan customer_id.
drop function if exists public.rpc_backfill_customers_from_orders();
create or replace function public.rpc_backfill_customers_from_orders()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_count integer := 0;
  rec record;
  v_customer_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  for rec in
    select distinct on (trim(coalesce(o.telefono, '')))
      trim(coalesce(o.telefono, '')) as phone,
      nullif(trim(coalesce(o.nombre_cliente, '')), '') as name
    from public.orders o
    where nullif(trim(coalesce(o.telefono, '')), '') is not null
    order by trim(coalesce(o.telefono, '')), o.created_at desc
  loop
    insert into public.customers(name, phone, normalized_phone, account_type)
    values (
      coalesce(rec.name, 'Cliente'),
      rec.phone,
      nullif(regexp_replace(rec.phone, '[^0-9]+', '', 'g'), ''),
      'guest'
    )
    on conflict (phone) where auth_user_id is null do update
      set name = excluded.name,
          normalized_phone = excluded.normalized_phone,
          updated_at = now()
    returning id into v_customer_id;

    update public.orders o
    set customer_id = v_customer_id
    where trim(coalesce(o.telefono, '')) = rec.phone
      and o.customer_id is null;

    v_count := v_count + 1;
  end loop;

  update public.customers c
  set
    name = coalesce(
      (
        select nullif(trim(coalesce(o2.nombre_cliente, '')), '')
        from public.orders o2
        where o2.customer_id = c.id
          and nullif(trim(coalesce(o2.nombre_cliente, '')), '') is not null
        order by o2.created_at desc
        limit 1
      ),
      c.name
    ),
    account_type = case when c.auth_user_id is null then 'guest' else 'registered' end,
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

  -- Evita que cuentas registradas hereden pedidos históricos de invitado por mismo teléfono.
  -- Conserva solo pedidos desde la creación de la cuenta registrada.
  update public.orders o
  set customer_id = null
  from public.customers c
  where o.customer_id = c.id
    and c.auth_user_id is not null
    and o.created_at < c.created_at;

  return jsonb_build_object('processed_phones', v_count);
end;
$$;

revoke all on function public.rpc_backfill_customers_from_orders() from public;
grant execute on function public.rpc_backfill_customers_from_orders() to authenticated;


-- Historial del cliente autenticado (seguro, sin exponer otros clientes)
drop function if exists public.rpc_my_orders();
create or replace function public.rpc_my_orders()
returns table (
  id uuid,
  short_code text,
  estado text,
  modalidad text,
  total numeric,
  created_at timestamptz,
  paid boolean,
  payment_method text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  return query
  select
    o.id,
    o.short_code,
    o.estado,
    o.modalidad,
    o.total,
    o.created_at,
    o.paid,
    o.payment_method
  from public.orders o
  join public.customers c on c.id = o.customer_id
  where c.auth_user_id = v_uid
  order by o.created_at desc
  limit 120;
end;
$$;

revoke all on function public.rpc_my_orders() from public;
grant execute on function public.rpc_my_orders() to authenticated;


-- Limpieza inicial post-migración: desvincula pedidos de invitado previos al registro de cuenta.
update public.orders o
set customer_id = null
from public.customers c
where o.customer_id = c.id
  and c.auth_user_id is not null
  and o.created_at < c.created_at;
