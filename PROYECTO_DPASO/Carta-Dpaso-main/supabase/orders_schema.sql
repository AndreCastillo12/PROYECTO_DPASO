-- Extensión necesaria para gen_random_uuid()
create extension if not exists pgcrypto;

-- ===============================
-- TABLA: orders
-- ===============================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  nombre_cliente text not null,
  telefono text not null,
  modalidad text not null check (modalidad in ('Delivery', 'Recojo')),
  direccion text,
  referencia text,
  comentario text,
  total numeric(10,2) not null check (total >= 0),
  estado text not null default 'pendiente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_created_at on public.orders (created_at desc);

-- ===============================
-- TABLA: order_items
-- ===============================
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  plato_id uuid,
  nombre_snapshot text not null,
  precio_snapshot numeric(10,2) not null check (precio_snapshot >= 0),
  cantidad integer not null check (cantidad > 0),
  subtotal numeric(10,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

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
-- RLS
-- ===============================
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Insert público permitido (anon/authenticated)
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

-- Sin policies de SELECT para anon/authenticated => no lectura pública.