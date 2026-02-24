-- Sprint 18: perfil cliente autoservicio + sync robusto customers/auth

alter table if exists public.customers
  add column if not exists auth_user_id uuid,
  add column if not exists email text,
  add column if not exists dni text,
  add column if not exists avatar_path text;

create unique index if not exists customers_auth_user_id_uidx
  on public.customers(auth_user_id)
  where auth_user_id is not null;

create index if not exists customers_email_idx on public.customers(email);

-- Sincroniza columnas user_id/auth_user_id para filas históricas
update public.customers c
set auth_user_id = coalesce(c.auth_user_id, c.user_id)
where c.auth_user_id is null
  and c.user_id is not null;

update public.customers c
set user_id = coalesce(c.user_id, c.auth_user_id)
where c.user_id is null
  and c.auth_user_id is not null;

alter table public.customers enable row level security;

-- Políticas de autoservicio para cliente autenticado
-- (mantiene políticas admin existentes)
drop policy if exists customers_self_select on public.customers;
create policy customers_self_select
on public.customers for select
to authenticated
using (
  user_id = auth.uid()
  or auth_user_id = auth.uid()
);

drop policy if exists customers_self_update on public.customers;
create policy customers_self_update
on public.customers for update
to authenticated
using (
  user_id = auth.uid()
  or auth_user_id = auth.uid()
)
with check (
  user_id = auth.uid()
  or auth_user_id = auth.uid()
);

-- Lee perfil del customer logueado (si existe)
drop function if exists public.get_my_customer_profile();
create or replace function public.get_my_customer_profile()
returns table (
  id uuid,
  name text,
  phone text,
  dni text,
  email text,
  avatar_path text,
  user_id uuid,
  auth_user_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  return query
  select
    c.id,
    c.name,
    c.phone,
    c.dni,
    c.email,
    c.avatar_path,
    c.user_id,
    c.auth_user_id,
    c.created_at,
    c.updated_at
  from public.customers c
  where c.user_id = v_uid
     or c.auth_user_id = v_uid
  order by c.updated_at desc nulls last
  limit 1;
end;
$$;

revoke all on function public.get_my_customer_profile() from public;
grant execute on function public.get_my_customer_profile() to authenticated;

-- Upsert autoservicio para mantener customers sincronizado con perfil auth
-- p_phone/p_name son obligatorios para insert; para update se mantienen valores previos.
drop function if exists public.upsert_my_customer_profile(text, text, text, text, text);
create or replace function public.upsert_my_customer_profile(
  p_name text,
  p_phone text,
  p_dni text,
  p_email text,
  p_avatar_path text
)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_now timestamptz := now();
  v_row public.customers%rowtype;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_dni text := nullif(btrim(coalesce(p_dni, '')), '');
  v_avatar text := nullif(btrim(coalesce(p_avatar_path, '')), '');
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_row
  from public.customers c
  where c.user_id = v_uid
     or c.auth_user_id = v_uid
  order by c.updated_at desc nulls last
  limit 1
  for update;

  if found then
    update public.customers c
    set
      name = coalesce(v_name, c.name),
      phone = coalesce(v_phone, c.phone),
      normalized_phone = coalesce(nullif(regexp_replace(coalesce(v_phone, c.phone, ''), '[^0-9]+', '', 'g'), ''), c.normalized_phone),
      dni = coalesce(v_dni, c.dni),
      email = coalesce(v_email, c.email),
      avatar_path = coalesce(v_avatar, c.avatar_path),
      user_id = coalesce(c.user_id, v_uid),
      auth_user_id = coalesce(c.auth_user_id, v_uid),
      updated_at = v_now
    where c.id = v_row.id
    returning * into v_row;

    return v_row;
  end if;

  if v_name is null then
    raise exception 'NAME_REQUIRED';
  end if;
  if v_phone is null then
    raise exception 'PHONE_REQUIRED';
  end if;

  insert into public.customers (
    name,
    phone,
    normalized_phone,
    dni,
    email,
    avatar_path,
    user_id,
    auth_user_id,
    created_at,
    updated_at
  ) values (
    v_name,
    v_phone,
    nullif(regexp_replace(v_phone, '[^0-9]+', '', 'g'), ''),
    v_dni,
    v_email,
    v_avatar,
    v_uid,
    v_uid,
    v_now,
    v_now
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_my_customer_profile(text, text, text, text, text) from public;
grant execute on function public.upsert_my_customer_profile(text, text, text, text, text) to authenticated;
