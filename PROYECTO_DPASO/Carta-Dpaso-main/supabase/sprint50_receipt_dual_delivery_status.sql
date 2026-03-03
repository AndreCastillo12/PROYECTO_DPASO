alter table public.orders
  add column if not exists receipt_send_status_customer text not null default 'skipped',
  add column if not exists receipt_send_status_internal text not null default 'failed',
  add column if not exists receipt_send_error_customer text,
  add column if not exists receipt_send_error_internal text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_receipt_send_status_customer_check'
  ) then
    alter table public.orders
      add constraint orders_receipt_send_status_customer_check
      check (receipt_send_status_customer in ('sent', 'failed', 'skipped'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_receipt_send_status_internal_check'
  ) then
    alter table public.orders
      add constraint orders_receipt_send_status_internal_check
      check (receipt_send_status_internal in ('sent', 'failed'));
  end if;
end
$$;

comment on column public.orders.receipt_send_status_customer is 'Estado del último intento de envío del comprobante al cliente';
comment on column public.orders.receipt_send_status_internal is 'Estado del último intento de envío de notificación interna';
comment on column public.orders.receipt_send_error_customer is 'Detalle del error del envío al cliente';
comment on column public.orders.receipt_send_error_internal is 'Detalle del error del envío interno';
