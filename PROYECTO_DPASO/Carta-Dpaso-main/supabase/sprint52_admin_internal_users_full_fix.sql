-- Sprint 52: fix completo Usuarios internos + Roles (admin panel)

create table if not exists public.admin_panel_roles_catalog (
  role text primary key,
  label text not null,
  created_at timestamptz not null default now()
);

insert into public.admin_panel_roles_catalog(role, label)
values
  ('superadmin', 'Super administrador'),
  ('admin', 'Administrador'),
  ('cajero', 'Cajero'),
  ('mozo', 'Mozo'),
  ('cocina', 'Cocina')
on conflict (role) do update set label = excluded.label;

alter table if exists public.admin_panel_roles_catalog enable row level security;

drop policy if exists admin_panel_roles_catalog_read on public.admin_panel_roles_catalog;
create policy admin_panel_roles_catalog_read
on public.admin_panel_roles_catalog
for select
to authenticated
using (public.is_admin_user(auth.uid()));

alter table if exists public.admin_panel_user_roles
  drop constraint if exists admin_panel_user_roles_role_check;

alter table if exists public.admin_panel_user_roles
  add constraint admin_panel_user_roles_role_check
  check (role = lower(trim(role)) and length(trim(role)) > 0);

create or replace function public.get_admin_panel_role(uid uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when exists (
          select 1
          from public.admin_panel_roles_catalog c
          where c.role = lower(coalesce(r.role, ''))
        ) then lower(r.role)
        else null
      end
      from public.admin_panel_user_roles r
      where r.user_id = uid
      limit 1
    ),
    'none'
  );
$$;

create or replace function public.is_superadmin_user(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.get_admin_panel_role(uid) = 'superadmin';
$$;

create or replace function public.is_admin_user(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.get_admin_panel_role(uid) in ('superadmin', 'admin');
$$;

revoke all on function public.is_superadmin_user(uuid) from public;
grant execute on function public.is_superadmin_user(uuid) to authenticated;

create or replace function public.rpc_admin_set_user_role(p_user_id uuid, p_role text)
returns public.admin_panel_user_roles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_role text := public.get_admin_panel_role(v_uid);
  v_target_current_role text;
  v_role text := lower(trim(coalesce(p_role, '')));
  v_row public.admin_panel_user_roles%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if v_caller_role not in ('superadmin', 'admin') then
    raise exception 'FORBIDDEN';
  end if;

  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  if p_user_id = v_uid then
    raise exception 'CANNOT_MANAGE_SELF';
  end if;

  if not exists (select 1 from public.admin_panel_roles_catalog c where c.role = v_role) then
    raise exception 'INVALID_ROLE';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;

  select lower(coalesce(r.role, ''))
  into v_target_current_role
  from public.admin_panel_user_roles r
  where r.user_id = p_user_id;

  if v_target_current_role = 'superadmin' and v_caller_role <> 'superadmin' then
    raise exception 'FORBIDDEN_SUPERADMIN_TARGET';
  end if;

  if v_role = 'superadmin' and v_caller_role <> 'superadmin' then
    raise exception 'FORBIDDEN_ASSIGN_SUPERADMIN';
  end if;

  insert into public.admin_panel_user_roles(user_id, role)
  values (p_user_id, v_role)
  on conflict (user_id) do update
    set role = excluded.role,
        updated_at = now()
  returning * into v_row;

  update public.profiles
    set role = v_role
  where id = p_user_id
    and exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'profiles'
        and c.column_name = 'role'
    );

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
  v_email text := lower(trim(coalesce(p_email, '')));
  v_target_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if v_email = '' then
    raise exception 'EMAIL_REQUIRED';
  end if;

  select u.id
  into v_target_user_id
  from auth.users u
  where lower(coalesce(u.email, '')) = v_email
  order by u.created_at desc
  limit 1;

  if v_target_user_id is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  return public.rpc_admin_set_user_role(v_target_user_id, p_role);
end;
$$;

revoke all on function public.rpc_admin_set_user_role_by_email(text, text) from public;
grant execute on function public.rpc_admin_set_user_role_by_email(text, text) to authenticated;

create or replace function public.rpc_admin_list_internal_users()
returns table(
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  is_disabled boolean,
  email_confirmed boolean,
  nombre text,
  apellidos text,
  role text,
  is_worker boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    u.id::uuid as user_id,
    u.email::text,
    u.created_at::timestamptz,
    u.last_sign_in_at::timestamptz,
    coalesce((u.banned_until > now()), false)::boolean as is_disabled,
    coalesce((u.email_confirmed_at is not null), false)::boolean as email_confirmed,
    p.nombre::text,
    p.apellidos::text,
    r.role::text,
    (w.user_id is not null)::boolean as is_worker
  from auth.users u
  left join public.admin_panel_user_roles r on r.user_id = u.id
  left join public.internal_worker_accounts w on w.user_id = u.id
  left join public.profiles p on p.id = u.id
  where r.user_id is not null or w.user_id is not null
  order by u.created_at desc;
end;
$$;

revoke all on function public.rpc_admin_list_internal_users() from public;
grant execute on function public.rpc_admin_list_internal_users() to authenticated;

create or replace function public.rpc_admin_list_workers()
returns table(
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  is_disabled boolean,
  email_confirmed boolean,
  nombre text,
  apellidos text,
  role text
)
language sql
security definer
set search_path = ''
as $$
  select
    i.user_id,
    i.email,
    i.created_at,
    i.last_sign_in_at,
    i.is_disabled,
    i.email_confirmed,
    i.nombre,
    i.apellidos,
    i.role
  from public.rpc_admin_list_internal_users() i
  where i.is_worker = true
  order by i.created_at desc;
$$;

revoke all on function public.rpc_admin_list_workers() from public;
grant execute on function public.rpc_admin_list_workers() to authenticated;
