-- MIGRACIÓN SEGURA (idempotente) para pedidos públicos en Supabase
-- Ejecuta este script aunque ya hayas corrido versiones previas.

create extension if not exists pgcrypto;

-- ===============================
-- TABLA: orders
-- ===============================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  nombre_cliente text not null,
  telefono text not null,
  modalidad text not null,
  direccion text,
  referencia text,
  comentario text,
  total numeric(10,2) not null,
  estado text not null default 'pendiente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders
  alter column id set default gen_random_uuid(),
  alter column nombre_cliente set not null,
  alter column telefono set not null,
  alter column modalidad set not null,
  alter column total set not null,
  alter column estado set default 'pendiente',
  alter column created_at set default now(),
  alter column updated_at set default now();

-- CHECK de modalidad (Delivery / Recojo)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_modalidad_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_modalidad_check
      check (modalidad in ('Delivery', 'Recojo'));
  end if;
end $$;

-- CHECK de total >= 0
DO $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_total_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_total_check
      check (total >= 0);
  end if;
end $$;

create index if not exists idx_orders_created_at on public.orders (created_at desc);

-- ===============================
-- TABLA: order_items
-- ===============================
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  plato_id uuid,
  nombre_snapshot text not null,
  precio_snapshot numeric(10,2) not null,
  cantidad integer not null,
  subtotal numeric(10,2) not null,
  created_at timestamptz not null default now()
);

alter table public.order_items
  alter column id set default gen_random_uuid(),
  alter column order_id set not null,
  alter column nombre_snapshot set not null,
  alter column precio_snapshot set not null,
  alter column cantidad set not null,
  alter column subtotal set not null,
  alter column created_at set default now();

-- FK order_items -> orders con ON DELETE CASCADE
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_items_order_id_fkey'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_order_id_fkey
      foreign key (order_id) references public.orders(id) on delete cascade;
  end if;
end $$;

-- CHECKS de order_items
DO $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_items_precio_snapshot_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_precio_snapshot_check
      check (precio_snapshot >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_items_cantidad_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_cantidad_check
      check (cantidad > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_items_subtotal_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_subtotal_check
      check (subtotal >= 0);
  end if;
end $$;

create index if not exists idx_order_items_order_id on public.order_items (order_id);

-- ===============================
-- TRIGGER updated_at en orders
-- ===============================
create or replace function public.set_updated_at_orders()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_orders on public.orders;
create trigger trg_set_updated_at_orders
before update on public.orders
for each row
execute function public.set_updated_at_orders();

-- ===============================
-- RLS + POLICIES (solo INSERT público)
-- ===============================
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Public can insert orders" on public.orders;
create policy "Public can insert orders"
on public.orders
for insert
to anon, authenticated
with check (true);

drop policy if exists "Public can insert order_items" on public.order_items;
create policy "Public can insert order_items"
on public.order_items
for insert
to anon, authenticated
with check (true);

-- IMPORTANTE: no crear policies de SELECT público.

-- ===============================
-- GRANTS
-- ===============================
grant usage on schema public to anon, authenticated;
grant insert on public.orders to anon, authenticated;
grant insert on public.order_items to anon, authenticated;
