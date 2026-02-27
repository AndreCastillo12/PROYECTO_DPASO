-- Sprint 47: catálogo explícito de roles internos planeados

create table if not exists public.admin_panel_roles_catalog (
  role text primary key,
  label text not null,
  created_at timestamptz not null default now()
);

insert into public.admin_panel_roles_catalog(role, label)
values
  ('admin', 'Administrador'),
  ('cajero', 'Cajero'),
  ('mozo', 'Mozo'),
  ('cocina', 'Cocina')
on conflict (role) do update set label = excluded.label;

alter table public.admin_panel_roles_catalog enable row level security;

drop policy if exists admin_panel_roles_catalog_read on public.admin_panel_roles_catalog;
create policy admin_panel_roles_catalog_read on public.admin_panel_roles_catalog
for select
using (public.is_admin_user(auth.uid()));
