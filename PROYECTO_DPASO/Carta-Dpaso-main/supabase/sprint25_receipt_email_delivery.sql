-- Sprint 25: backend real para envío de comprobante por correo

alter table if exists public.orders
  add column if not exists receipt_email text,
  add column if not exists receipt_token text,
  add column if not exists receipt_send_status text not null default 'pending',
  add column if not exists receipt_sent_at timestamptz,
  add column if not exists receipt_last_attempt_at timestamptz,
  add column if not exists receipt_send_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_receipt_send_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_receipt_send_status_check
      check (receipt_send_status in ('pending', 'sent', 'failed'));
  end if;
end $$;

create index if not exists orders_receipt_token_idx on public.orders(receipt_token);

comment on column public.orders.receipt_email is 'Correo al que se intenta enviar el comprobante';
comment on column public.orders.receipt_token is 'Token anti-abuso para permitir envío de comprobante';
comment on column public.orders.receipt_send_status is 'Estado del último intento de envío de comprobante';
comment on column public.orders.receipt_sent_at is 'Fecha/hora del envío exitoso de comprobante';
comment on column public.orders.receipt_last_attempt_at is 'Fecha/hora del último intento de envío de comprobante';
comment on column public.orders.receipt_send_error is 'Detalle de error del último intento fallido';

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

  if v_email is null or v_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
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
