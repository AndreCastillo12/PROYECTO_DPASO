-- Sprint 8: horario + delivery fee + mínimo para delivery
-- Idempotente

create extension if not exists pgcrypto;

create table if not exists public.store_settings (
  id uuid primary key default gen_random_uuid(),
  is_open boolean not null default true,
  open_time time null,
  close_time time null,
  closed_message text not null default 'Estamos cerrados. Vuelve en nuestro horario de atención.',
  timezone text not null default 'America/Lima',
  delivery_fee numeric not null default 0,
  min_order_delivery numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.store_settings
  alter column is_open set default true,
  alter column is_open set not null,
  alter column closed_message set default 'Estamos cerrados. Vuelve en nuestro horario de atención.',
  alter column closed_message set not null,
  alter column timezone set default 'America/Lima',
  alter column timezone set not null,
  alter column delivery_fee set default 0,
  alter column delivery_fee set not null,
  alter column min_order_delivery set default 0,
  alter column min_order_delivery set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'store_settings_delivery_fee_check'
      and conrelid = 'public.store_settings'::regclass
  ) then
    alter table public.store_settings
      add constraint store_settings_delivery_fee_check
      check (delivery_fee >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_settings_min_order_delivery_check'
      and conrelid = 'public.store_settings'::regclass
  ) then
    alter table public.store_settings
      add constraint store_settings_min_order_delivery_check
      check (min_order_delivery >= 0);
  end if;
end $$;

create or replace function public.set_updated_at_store_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_store_settings on public.store_settings;
create trigger trg_set_updated_at_store_settings
before update on public.store_settings
for each row
execute function public.set_updated_at_store_settings();

-- Asegura una única fila de configuración inicial
insert into public.store_settings (is_open, timezone, delivery_fee, min_order_delivery)
select true, 'America/Lima', 0, 0
where not exists (select 1 from public.store_settings);

alter table public.store_settings enable row level security;

drop policy if exists "Public can read store_settings" on public.store_settings;
create policy "Public can read store_settings"
on public.store_settings
for select
to anon, authenticated
using (true);

drop policy if exists "Admin can update store_settings" on public.store_settings;
create policy "Admin can update store_settings"
on public.store_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);
