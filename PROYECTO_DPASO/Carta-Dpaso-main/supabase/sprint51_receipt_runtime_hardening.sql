-- Sprint 51: hardening para send-receipt en producción

create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists email text,
  add column if not exists receipt_email text,
  add column if not exists receipt_token text,
  add column if not exists receipt_send_status text not null default 'pending',
  add column if not exists receipt_send_error text,
  add column if not exists receipt_send_status_customer text not null default 'skipped',
  add column if not exists receipt_send_status_internal text not null default 'failed',
  add column if not exists receipt_send_error_customer text,
  add column if not exists receipt_send_error_internal text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_receipt_send_status_check'
  ) then
    alter table public.orders
      add constraint orders_receipt_send_status_check
      check (receipt_send_status in ('pending', 'sent', 'failed'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_receipt_send_status_customer_check'
  ) then
    alter table public.orders
      add constraint orders_receipt_send_status_customer_check
      check (receipt_send_status_customer in ('sent', 'failed', 'skipped'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_receipt_send_status_internal_check'
  ) then
    alter table public.orders
      add constraint orders_receipt_send_status_internal_check
      check (receipt_send_status_internal in ('sent', 'failed'));
  end if;
end
$$;

alter table public.orders
  alter column receipt_token set default gen_random_uuid()::text;

update public.orders
set receipt_token = gen_random_uuid()::text
where coalesce(btrim(receipt_token), '') = '';

-- Permitir set de token incluso cuando no hay email (para seguridad de invocación por token)
drop function if exists public.set_order_receipt_data(uuid, text, text);
create or replace function public.set_order_receipt_data(
  p_order_id uuid,
  p_email text,
  p_token text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_token text := btrim(coalesce(p_token, ''));
begin
  if p_order_id is null then
    raise exception 'ORDER_ID_REQUIRED';
  end if;

  if v_email is not null and v_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  if v_token = '' then
    raise exception 'INVALID_TOKEN';
  end if;

  update public.orders o
  set receipt_email = v_email,
      receipt_token = v_token,
      receipt_send_status = case when o.receipt_send_status = 'sent' then 'sent' else 'pending' end,
      receipt_send_error = null,
      receipt_last_attempt_at = null
  where o.id = p_order_id
  returning * into v_order;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  return v_order;
end;
$$;

revoke all on function public.set_order_receipt_data(uuid, text, text) from public;
grant execute on function public.set_order_receipt_data(uuid, text, text) to anon;
grant execute on function public.set_order_receipt_data(uuid, text, text) to authenticated;
