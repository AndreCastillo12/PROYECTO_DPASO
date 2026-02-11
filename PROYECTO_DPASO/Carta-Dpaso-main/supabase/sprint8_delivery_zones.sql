-- Sprint 8 corrección: delivery por zonas
-- Script idempotente

create extension if not exists pgcrypto;

-- Compatibilidad: mantener timezone en store_settings pero no es editable en UI
create table if not exists public.store_settings (
  id uuid primary key default gen_random_uuid(),
  is_open boolean not null default true,
  open_time time null,
  close_time time null,
  closed_message text not null default 'Estamos cerrados. Vuelve en nuestro horario de atención.',
  timezone text not null default 'America/Lima',
  updated_at timestamptz not null default now()
);

alter table public.store_settings
  alter column is_open set default true,
  alter column is_open set not null,
  alter column closed_message set default 'Estamos cerrados. Vuelve en nuestro horario de atención.',
  alter column closed_message set not null,
  alter column timezone set default 'America/Lima',
  alter column timezone set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

-- Tabla de zonas de delivery
create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  provincia text not null,
  distrito text not null,
  tarifa numeric not null default 0,
  minimo numeric not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.delivery_zones
  alter column provincia set not null,
  alter column distrito set not null,
  alter column tarifa set default 0,
  alter column tarifa set not null,
  alter column minimo set default 0,
  alter column minimo set not null,
  alter column activo set default true,
  alter column activo set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'delivery_zones_tarifa_check'
      and conrelid = 'public.delivery_zones'::regclass
  ) then
    alter table public.delivery_zones
      add constraint delivery_zones_tarifa_check
      check (tarifa >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'delivery_zones_minimo_check'
      and conrelid = 'public.delivery_zones'::regclass
  ) then
    alter table public.delivery_zones
      add constraint delivery_zones_minimo_check
      check (minimo >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'delivery_zones_provincia_distrito_key'
      and conrelid = 'public.delivery_zones'::regclass
  ) then
    alter table public.delivery_zones
      add constraint delivery_zones_provincia_distrito_key
      unique (provincia, distrito);
  end if;
end $$;

create or replace function public.set_updated_at_delivery_zones()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_delivery_zones on public.delivery_zones;
create trigger trg_set_updated_at_delivery_zones
before update on public.delivery_zones
for each row
execute function public.set_updated_at_delivery_zones();

alter table public.delivery_zones enable row level security;

drop policy if exists "Public can read delivery_zones" on public.delivery_zones;
create policy "Public can read delivery_zones"
on public.delivery_zones
for select
to anon, authenticated
using (true);

drop policy if exists "Admin can insert delivery_zones" on public.delivery_zones;
create policy "Admin can insert delivery_zones"
on public.delivery_zones
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Admin can update delivery_zones" on public.delivery_zones;
create policy "Admin can update delivery_zones"
on public.delivery_zones
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

drop policy if exists "Admin can delete delivery_zones" on public.delivery_zones;
create policy "Admin can delete delivery_zones"
on public.delivery_zones
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);
