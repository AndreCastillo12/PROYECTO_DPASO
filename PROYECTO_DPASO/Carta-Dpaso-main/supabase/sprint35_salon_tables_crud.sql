-- Sprint 35: Salón robusto (modalidad + mesas administrables)

-- 1) Permitir modalidad salón en orders (sin romper Delivery/Recojo)
do $$
declare
  v_constraint text;
begin
  select con.conname
  into v_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'orders'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%modalidad%'
  limit 1;

  if v_constraint is not null then
    execute format('alter table public.orders drop constraint %I', v_constraint);
  end if;

  alter table public.orders
    add constraint orders_modalidad_check
    check (lower(coalesce(modalidad, '')) in ('delivery', 'recojo', 'salon', 'salón'));
exception
  when duplicate_object then
    null;
end $$;

-- 2) Mesas administrables por admin
create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create unique index if not exists restaurant_tables_name_uidx
  on public.restaurant_tables(lower(table_name));

alter table if exists public.restaurant_tables enable row level security;

drop policy if exists restaurant_tables_admin_select on public.restaurant_tables;
create policy restaurant_tables_admin_select
on public.restaurant_tables
for select
to authenticated
using (public.is_admin_user(auth.uid()));

drop policy if exists restaurant_tables_admin_insert on public.restaurant_tables;
create policy restaurant_tables_admin_insert
on public.restaurant_tables
for insert
to authenticated
with check (public.is_admin_user(auth.uid()));

drop policy if exists restaurant_tables_admin_update on public.restaurant_tables;
create policy restaurant_tables_admin_update
on public.restaurant_tables
for update
to authenticated
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

drop policy if exists restaurant_tables_admin_delete on public.restaurant_tables;
create policy restaurant_tables_admin_delete
on public.restaurant_tables
for delete
to authenticated
using (public.is_admin_user(auth.uid()));

create or replace function public.set_updated_at_restaurant_tables()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_restaurant_tables_updated_at on public.restaurant_tables;
create trigger trg_restaurant_tables_updated_at
before update on public.restaurant_tables
for each row
execute function public.set_updated_at_restaurant_tables();

insert into public.restaurant_tables(table_name, active, created_by)
select format('Mesa %s', gs::text), true, auth.uid()
from generate_series(1, 8) gs
where not exists (select 1 from public.restaurant_tables rt);
