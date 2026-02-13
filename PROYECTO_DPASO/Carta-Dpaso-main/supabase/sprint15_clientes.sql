-- Sprint 15: Clientes (CRM básico)

create extension if not exists pgcrypto;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  normalized_phone text,
  total_orders integer not null default 0,
  total_spent numeric(12,2) not null default 0,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.customers
  add column if not exists normalized_phone text,
  add column if not exists total_orders integer not null default 0,
  add column if not exists total_spent numeric(12,2) not null default 0,
  add column if not exists last_order_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists customers_phone_uidx on public.customers(phone);
create index if not exists customers_last_order_idx on public.customers(last_order_at desc);
create index if not exists customers_total_spent_idx on public.customers(total_spent desc);

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
    select
      trim(o.telefono) as phone,
      max(nullif(trim(coalesce(o.nombre_cliente, '')), '')) as name
    from public.orders o
    where nullif(trim(coalesce(o.telefono, '')), '') is not null
    group by trim(o.telefono)
  loop
    insert into public.customers(name, phone, normalized_phone)
    values (
      coalesce(rec.name, 'Cliente'),
      rec.phone,
      nullif(regexp_replace(rec.phone, '[^0-9]+', '', 'g'), '')
    )
    on conflict (phone) do update
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

  return jsonb_build_object('processed_phones', v_count);
end;
$$;

revoke all on function public.rpc_backfill_customers_from_orders() from public;
grant execute on function public.rpc_backfill_customers_from_orders() to authenticated;
