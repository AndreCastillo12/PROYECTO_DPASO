-- Sprint 45: listado de usuarios Auth + confirmación de correo para flujo interno

create or replace function public.rpc_admin_list_auth_users()
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
    u.id,
    u.email,
    u.created_at,
    u.last_sign_in_at,
    coalesce(u.banned_until > now(), false) as is_disabled,
    coalesce(u.email_confirmed_at is not null, false) as email_confirmed,
    p.nombre,
    p.apellidos,
    r.role
  from auth.users u
  left join public.admin_panel_user_roles r on r.user_id = u.id
  left join public.profiles p on p.id = u.id
  order by u.created_at desc;
end;
$$;

revoke all on function public.rpc_admin_list_auth_users() from public;
grant execute on function public.rpc_admin_list_auth_users() to authenticated;

create or replace function public.rpc_admin_confirm_user_email(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_target uuid;
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

  update auth.users
  set
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    confirmed_at = coalesce(confirmed_at, now()),
    updated_at = now()
  where lower(coalesce(email, '')) = v_email
  returning id into v_target;

  if v_target is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  return v_target;
end;
$$;

revoke all on function public.rpc_admin_confirm_user_email(text) from public;
grant execute on function public.rpc_admin_confirm_user_email(text) to authenticated;
