-- Sprint 22: calidad de datos cliente + historial de contraseña (últimas 3)

create extension if not exists pgcrypto;

alter table if exists public.customers
  add column if not exists normalized_email text,
  add column if not exists normalized_dni text;

update public.customers
set
  normalized_email = nullif(lower(btrim(coalesce(email, ''))), ''),
  normalized_dni = nullif(regexp_replace(coalesce(dni, ''), '[^0-9]+', '', 'g'), '')
where true;

create index if not exists customers_normalized_email_idx on public.customers(normalized_email);
create index if not exists customers_normalized_phone_idx on public.customers(normalized_phone);
create index if not exists customers_normalized_dni_idx on public.customers(normalized_dni);

create table if not exists public.customer_password_history (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists customer_password_history_user_created_idx
  on public.customer_password_history(user_id, created_at desc);

alter table public.customer_password_history enable row level security;

drop policy if exists customer_password_history_self_select on public.customer_password_history;
create policy customer_password_history_self_select
on public.customer_password_history
for select
to authenticated
using (user_id = auth.uid());

drop function if exists public.is_password_reused_last_three(text);
create or replace function public.is_password_reused_last_three(p_password text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_password text := nullif(btrim(coalesce(p_password, '')), '');
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if v_password is null then
    return false;
  end if;

  return exists (
    select 1
    from (
      select h.password_hash
      from public.customer_password_history h
      where h.user_id = v_uid
      order by h.created_at desc
      limit 3
    ) recent
    where pg_catalog.crypt(v_password, recent.password_hash) = recent.password_hash
  );
end;
$$;

revoke all on function public.is_password_reused_last_three(text) from public;
grant execute on function public.is_password_reused_last_three(text) to authenticated;

drop function if exists public.remember_password_history(text);
create or replace function public.remember_password_history(p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_password text := nullif(btrim(coalesce(p_password, '')), '');
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if v_password is null then
    raise exception 'PASSWORD_REQUIRED';
  end if;

  insert into public.customer_password_history(user_id, password_hash)
  values (v_uid, pg_catalog.crypt(v_password, gen_salt('bf')));

  delete from public.customer_password_history h
  where h.user_id = v_uid
    and h.id not in (
      select id
      from public.customer_password_history h2
      where h2.user_id = v_uid
      order by h2.created_at desc
      limit 10
    );
end;
$$;

revoke all on function public.remember_password_history(text) from public;
grant execute on function public.remember_password_history(text) to authenticated;

-- Duplicados cross-tabla: endurece upsert autoservicio con validaciones de phone/dni/email.
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
  v_row public.customers%rowtype;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_dni text := nullif(btrim(coalesce(p_dni, '')), '');
  v_norm_phone text := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]+', '', 'g'), '');
  v_norm_dni text := nullif(regexp_replace(coalesce(v_dni, ''), '[^0-9]+', '', 'g'), '');
  v_avatar text := nullif(btrim(coalesce(p_avatar_path, '')), '');
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select c.*
  into v_row
  from public.customers c
  where c.user_id = v_uid
     or c.auth_user_id = v_uid
  order by c.updated_at desc nulls last, c.created_at desc
  limit 1;

  if v_norm_phone is not null and exists (
    select 1 from public.customers c
    where c.normalized_phone = v_norm_phone
      and (v_row.id is null or c.id <> v_row.id)
  ) then
    raise exception 'PHONE_ALREADY_USED';
  end if;

  if v_norm_dni is not null and exists (
    select 1 from public.customers c
    where c.normalized_dni = v_norm_dni
      and (v_row.id is null or c.id <> v_row.id)
  ) then
    raise exception 'DNI_ALREADY_USED';
  end if;

  if v_email is not null and exists (
    select 1 from public.customers c
    where c.normalized_email = v_email
      and (v_row.id is null or c.id <> v_row.id)
  ) then
    raise exception 'EMAIL_ALREADY_USED';
  end if;

  if v_row.id is not null then
    update public.customers c
    set
      name = coalesce(v_name, c.name),
      phone = coalesce(v_phone, c.phone),
      normalized_phone = coalesce(v_norm_phone, c.normalized_phone),
      dni = coalesce(v_dni, c.dni),
      normalized_dni = coalesce(v_norm_dni, c.normalized_dni),
      email = coalesce(v_email, c.email),
      normalized_email = coalesce(v_email, c.normalized_email),
      avatar_path = coalesce(v_avatar, c.avatar_path),
      user_id = coalesce(c.user_id, v_uid),
      auth_user_id = coalesce(c.auth_user_id, v_uid),
      updated_at = now()
    where c.id = v_row.id
    returning * into v_row;

    return v_row;
  end if;

  if v_name is null then v_name := 'Cliente'; end if;
  if v_phone is null then raise exception 'PHONE_REQUIRED'; end if;

  insert into public.customers (
    name,
    phone,
    normalized_phone,
    dni,
    normalized_dni,
    email,
    normalized_email,
    avatar_path,
    user_id,
    auth_user_id,
    created_at,
    updated_at
  ) values (
    v_name,
    v_phone,
    v_norm_phone,
    v_dni,
    v_norm_dni,
    v_email,
    v_email,
    v_avatar,
    v_uid,
    v_uid,
    now(),
    now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_my_customer_profile(text, text, text, text, text) from public;
grant execute on function public.upsert_my_customer_profile(text, text, text, text, text) to authenticated;
