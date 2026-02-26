-- Sprint 36: Salón estable con tickets por mesa (sin depender de orders para edición)

-- 1) Extender orders para vincular ticket/mesa al generar pedido final
alter table if exists public.orders
  add column if not exists table_id uuid,
  add column if not exists ticket_id uuid;

-- Asegurar modalidad salón permitida
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'orders'
      AND c.conname = 'orders_modalidad_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_modalidad_check
      CHECK (lower(coalesce(modalidad, '')) in ('delivery','recojo','salon','salón'));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Tabla tickets de mesa
create table if not exists public.table_tickets (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.restaurant_tables(id) on delete restrict,
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  opened_by uuid references auth.users(id),
  closed_by uuid references auth.users(id),
  generated_order_id uuid references public.orders(id) on delete set null,
  notes text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists table_tickets_table_status_idx
  on public.table_tickets(table_id, status, opened_at desc);

create unique index if not exists table_tickets_one_open_per_table_uidx
  on public.table_tickets(table_id)
  where status = 'open';

-- 3) Items del ticket (snapshot de precio)
create table if not exists public.table_ticket_items (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.table_tickets(id) on delete cascade,
  plato_id uuid,
  qty integer not null check (qty > 0),
  price_snapshot numeric(10,2) not null check (price_snapshot >= 0),
  notes text,
  status text not null default 'active' check (status in ('active','voided','served')),
  name_snapshot text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists table_ticket_items_ticket_idx
  on public.table_ticket_items(ticket_id, created_at);

-- 4) updated_at triggers
create or replace function public.set_updated_at_table_tickets()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_table_tickets_updated_at on public.table_tickets;
create trigger trg_table_tickets_updated_at
before update on public.table_tickets
for each row execute function public.set_updated_at_table_tickets();

create or replace function public.set_updated_at_table_ticket_items()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_table_ticket_items_updated_at on public.table_ticket_items;
create trigger trg_table_ticket_items_updated_at
before update on public.table_ticket_items
for each row execute function public.set_updated_at_table_ticket_items();

-- 5) RLS
alter table if exists public.table_tickets enable row level security;
alter table if exists public.table_ticket_items enable row level security;

drop policy if exists table_tickets_admin_select on public.table_tickets;
create policy table_tickets_admin_select
on public.table_tickets
for select
to authenticated
using (public.is_admin_user(auth.uid()));

drop policy if exists table_tickets_admin_insert on public.table_tickets;
create policy table_tickets_admin_insert
on public.table_tickets
for insert
to authenticated
with check (public.is_admin_user(auth.uid()));

drop policy if exists table_tickets_admin_update on public.table_tickets;
create policy table_tickets_admin_update
on public.table_tickets
for update
to authenticated
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

drop policy if exists table_tickets_admin_delete on public.table_tickets;
create policy table_tickets_admin_delete
on public.table_tickets
for delete
to authenticated
using (public.is_admin_user(auth.uid()));

drop policy if exists table_ticket_items_admin_select on public.table_ticket_items;
create policy table_ticket_items_admin_select
on public.table_ticket_items
for select
to authenticated
using (public.is_admin_user(auth.uid()));

drop policy if exists table_ticket_items_admin_insert on public.table_ticket_items;
create policy table_ticket_items_admin_insert
on public.table_ticket_items
for insert
to authenticated
with check (public.is_admin_user(auth.uid()));

drop policy if exists table_ticket_items_admin_update on public.table_ticket_items;
create policy table_ticket_items_admin_update
on public.table_ticket_items
for update
to authenticated
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

drop policy if exists table_ticket_items_admin_delete on public.table_ticket_items;
create policy table_ticket_items_admin_delete
on public.table_ticket_items
for delete
to authenticated
using (public.is_admin_user(auth.uid()));
