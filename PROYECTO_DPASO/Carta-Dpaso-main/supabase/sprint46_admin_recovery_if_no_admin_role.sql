-- Sprint 46: recuperación de admin cuando no queda ningún rol admin activo

create or replace function public.rpc_admin_bootstrap_first_admin()
returns public.admin_panel_user_roles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_profile_role text;
  v_row public.admin_panel_user_roles%rowtype;
  v_admin_count integer := 0;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select count(*) into v_admin_count
  from public.admin_panel_user_roles r
  where lower(coalesce(r.role, '')) = 'admin';

  if coalesce(v_admin_count, 0) > 0 then
    raise exception 'BOOTSTRAP_ALREADY_DONE';
  end if;

  select lower(coalesce(u.email, '')) into v_email
  from auth.users u
  where u.id = v_uid;

  select lower(coalesce(p.role, '')) into v_profile_role
  from public.profiles p
  where p.id = v_uid;

  if v_email = '' then
    raise exception 'EMAIL_REQUIRED';
  end if;

  -- Recuperación permitida solo para cuenta administradora conocida o perfil admin previo.
  if not (v_profile_role = 'admin' or v_email = 'admin@dpaso.com' or v_email like '%@dpaso.com') then
    raise exception 'FORBIDDEN';
  end if;

  insert into public.admin_panel_user_roles(user_id, role)
  values (v_uid, 'admin')
  on conflict (user_id) do update set role = 'admin', updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rpc_admin_bootstrap_first_admin() from public;
grant execute on function public.rpc_admin_bootstrap_first_admin() to authenticated;
