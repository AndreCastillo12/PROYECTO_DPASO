-- Sprint 48: frontera explícita entre cuentas de trabajadores y clientes

create table if not exists public.internal_worker_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.internal_worker_accounts enable row level security;

drop policy if exists internal_worker_accounts_admin_read on public.internal_worker_accounts;
create policy internal_worker_accounts_admin_read
on public.internal_worker_accounts
for select
to authenticated
using (public.is_admin_user(auth.uid()));

drop policy if exists internal_worker_accounts_admin_insert on public.internal_worker_accounts;
create policy internal_worker_accounts_admin_insert
on public.internal_worker_accounts
for insert
to authenticated
with check (public.is_admin_user(auth.uid()));

insert into public.internal_worker_accounts(user_id, created_by)
select r.user_id, auth.uid()
from public.admin_panel_user_roles r
on conflict (user_id) do nothing;

create or replace function public.rpc_admin_register_worker_by_email(p_email text)
returns public.internal_worker_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_target_user_id uuid;
  v_row public.internal_worker_accounts%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  if v_email = '' then
    raise exception 'EMAIL_REQUIRED';
  end if;

  select u.id into v_target_user_id
  from auth.users u
  where lower(coalesce(u.email, '')) = v_email
  order by u.created_at desc
  limit 1;

  if v_target_user_id is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  insert into public.internal_worker_accounts(user_id, created_by)
  values (v_target_user_id, v_uid)
  on conflict (user_id) do update set created_by = coalesce(public.internal_worker_accounts.created_by, excluded.created_by)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rpc_admin_register_worker_by_email(text) from public;
grant execute on function public.rpc_admin_register_worker_by_email(text) to authenticated;

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
    u.id::uuid,
    u.email::text,
    u.created_at::timestamptz,
    u.last_sign_in_at::timestamptz,
    coalesce((u.banned_until > now()), false)::boolean as is_disabled,
    coalesce((u.email_confirmed_at is not null), false)::boolean as email_confirmed,
    p.nombre::text,
    p.apellidos::text,
    r.role::text
  from public.internal_worker_accounts w
  join auth.users u on u.id = w.user_id
  left join public.admin_panel_user_roles r on r.user_id = u.id
  left join public.profiles p on p.id = u.id
  order by u.created_at desc;
end;
$$;

revoke all on function public.rpc_admin_list_workers() from public;
grant execute on function public.rpc_admin_list_workers() to authenticated;
