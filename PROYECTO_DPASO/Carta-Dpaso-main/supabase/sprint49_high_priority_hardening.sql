-- Sprint 49: hardening de alta prioridad (RLS, bootstrap y observabilidad)

-- 1) Evitar bypass de create_order por inserción directa pública.
revoke insert on table public.orders from anon, authenticated;
revoke insert on table public.order_items from anon, authenticated;

drop policy if exists "Public can insert orders" on public.orders;
drop policy if exists "Public can insert order_items" on public.order_items;

-- 2) Evitar inserción directa a logs; forzar uso de RPC controlada.
revoke insert on table public.app_event_logs from anon, authenticated;

drop policy if exists app_event_logs_insert_public on public.app_event_logs;

-- 3) Endurecer logging RPC con validaciones de tamaño y campos.
drop function if exists public.log_app_event(text, text, text, text, jsonb);
create or replace function public.log_app_event(
  p_event_name text,
  p_level text default 'error',
  p_context text default null,
  p_source text default 'unknown',
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level text := lower(coalesce(nullif(trim(p_level), ''), 'error'));
  v_event_name text := left(coalesce(nullif(trim(p_event_name), ''), 'unknown_event'), 100);
  v_context text := left(nullif(trim(coalesce(p_context, '')), ''), 120);
  v_source text := left(coalesce(nullif(trim(p_source), ''), 'unknown'), 80);
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_payload_size integer;
begin
  if v_level not in ('debug', 'info', 'warning', 'error', 'critical') then
    v_level := 'error';
  end if;

  if jsonb_typeof(v_payload) is distinct from 'object' then
    v_payload := jsonb_build_object('invalid_payload_type', jsonb_typeof(v_payload));
  end if;

  v_payload_size := pg_column_size(v_payload);
  if v_payload_size > 8192 then
    v_payload := jsonb_build_object(
      'truncated', true,
      'reason', 'payload_too_large',
      'original_size_bytes', v_payload_size
    );
  end if;

  insert into public.app_event_logs(level, event_name, context, source, user_id, payload)
  values (
    v_level,
    v_event_name,
    v_context,
    v_source,
    auth.uid(),
    v_payload
  );
end;
$$;

revoke all on function public.log_app_event(text, text, text, text, jsonb) from public;
grant execute on function public.log_app_event(text, text, text, text, jsonb) to anon, authenticated;

-- 4) Endurecer bootstrap admin: sin comodín de dominio.
drop function if exists public.rpc_admin_bootstrap_first_admin();
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

  -- Recuperación permitida solo para cuenta de emergencia conocida o perfil admin previo.
  if not (v_profile_role = 'admin' or v_email = 'admin@dpaso.com') then
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
