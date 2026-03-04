-- Sprint 52: foundation para emisión electrónica SUNAT (Boleta/Factura) + ticket 80mm

create extension if not exists pgcrypto;

-- Catálogo de series por tipo de documento.
create table if not exists public.sunat_document_series (
  document_type text primary key,
  series text not null,
  last_correlative integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sunat_document_series_type_check check (document_type in ('boleta', 'factura')),
  constraint sunat_document_series_series_check check (series ~ '^[A-Z0-9]{4}$')
);

insert into public.sunat_document_series(document_type, series, last_correlative)
values
  ('boleta', 'B001', 0),
  ('factura', 'F001', 0)
on conflict (document_type) do nothing;

-- Estructura principal en orders (idempotente).
alter table public.orders
  add column if not exists document_type text,
  add column if not exists series text,
  add column if not exists correlativo integer,
  add column if not exists sunat_status text not null default 'not_requested',
  add column if not exists sunat_error text,
  add column if not exists sunat_provider text,
  add column if not exists xml_url text,
  add column if not exists xml_base64 text,
  add column if not exists cdr_url text,
  add column if not exists cdr_base64 text,
  add column if not exists hash text,
  add column if not exists qr_text text,
  add column if not exists qr_url text,
  add column if not exists customer_doc_type text,
  add column if not exists customer_doc_number text,
  add column if not exists customer_name text,
  add column if not exists taxable_amount numeric(12,2),
  add column if not exists igv_amount numeric(12,2),
  add column if not exists total_amount numeric(12,2),
  add column if not exists currency text not null default 'PEN',
  add column if not exists issue_datetime timestamptz,
  add column if not exists payment_method text,
  add column if not exists invoice_idempotency_key text,
  add column if not exists invoice_last_attempt_at timestamptz,
  add column if not exists invoice_retry_count integer not null default 0,
  add column if not exists invoice_payload jsonb,
  add column if not exists invoice_response jsonb,
  add column if not exists ticket_html text,
  add column if not exists ticket_pdf_base64 text,
  add column if not exists invoice_issued_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_document_type_check') then
    alter table public.orders
      add constraint orders_document_type_check check (
        document_type is null or document_type in ('boleta', 'factura')
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_sunat_status_check') then
    alter table public.orders
      add constraint orders_sunat_status_check check (
        sunat_status in ('not_requested', 'queued', 'processing', 'issued', 'accepted', 'rejected', 'error')
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_customer_doc_type_check') then
    alter table public.orders
      add constraint orders_customer_doc_type_check check (
        customer_doc_type is null or customer_doc_type in ('DNI', 'RUC', 'CE', 'PASSPORT')
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_currency_check') then
    alter table public.orders
      add constraint orders_currency_check check (currency in ('PEN', 'USD'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_factura_requires_ruc_check') then
    alter table public.orders
      add constraint orders_factura_requires_ruc_check check (
        document_type <> 'factura'
        or (customer_doc_type = 'RUC' and char_length(coalesce(customer_doc_number, '')) = 11)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_correlativo_positive_check') then
    alter table public.orders
      add constraint orders_correlativo_positive_check check (correlativo is null or correlativo > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_invoice_retry_count_non_negative') then
    alter table public.orders
      add constraint orders_invoice_retry_count_non_negative check (invoice_retry_count >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_total_amount_non_negative_check') then
    alter table public.orders
      add constraint orders_total_amount_non_negative_check check (total_amount is null or total_amount >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_taxable_amount_non_negative_check') then
    alter table public.orders
      add constraint orders_taxable_amount_non_negative_check check (taxable_amount is null or taxable_amount >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_igv_amount_non_negative_check') then
    alter table public.orders
      add constraint orders_igv_amount_non_negative_check check (igv_amount is null or igv_amount >= 0);
  end if;
end
$$;

create unique index if not exists orders_invoice_idempotency_key_uidx
  on public.orders (invoice_idempotency_key)
  where invoice_idempotency_key is not null;

create index if not exists orders_sunat_status_idx on public.orders (sunat_status, updated_at desc);
create index if not exists orders_issue_datetime_idx on public.orders (issue_datetime desc);

-- Bitácora de intentos para reintento/observabilidad.
create table if not exists public.invoice_issue_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  attempt_number integer not null,
  status text not null,
  caller_type text not null,
  caller_id uuid,
  request_payload jsonb,
  provider_response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  constraint invoice_issue_attempts_status_check check (status in ('processing', 'issued', 'accepted', 'rejected', 'error')),
  constraint invoice_issue_attempts_caller_type_check check (caller_type in ('system', 'admin'))
);

create index if not exists invoice_issue_attempts_order_id_idx on public.invoice_issue_attempts(order_id, created_at desc);

-- Trigger updated_at para catálogo de series.
create or replace function public.set_updated_at_sunat_document_series()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_sunat_document_series on public.sunat_document_series;
create trigger trg_set_updated_at_sunat_document_series
before update on public.sunat_document_series
for each row
execute function public.set_updated_at_sunat_document_series();

-- Asigna correlativo de manera atómica por tipo de documento.
drop function if exists public.rpc_next_sunat_correlative(text);
create or replace function public.rpc_next_sunat_correlative(p_document_type text)
returns table(series text, correlativo integer, full_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := lower(coalesce(p_document_type, ''));
  v_series text;
  v_corr integer;
begin
  if v_type not in ('boleta', 'factura') then
    raise exception 'INVALID_DOCUMENT_TYPE';
  end if;

  perform pg_advisory_xact_lock(hashtext('sunat-correlative-' || v_type));

  update public.sunat_document_series s
  set last_correlative = s.last_correlative + 1
  where s.document_type = v_type
    and s.active = true
  returning s.series, s.last_correlative
  into v_series, v_corr;

  if not found then
    raise exception 'SERIE_NOT_CONFIGURED';
  end if;

  return query
  select v_series, v_corr, v_series || '-' || lpad(v_corr::text, 8, '0');
end;
$$;

revoke all on function public.rpc_next_sunat_correlative(text) from public;
grant execute on function public.rpc_next_sunat_correlative(text) to service_role;

-- helper para marcar pedido listo para emisión (cola).
drop function if exists public.rpc_queue_invoice_issue(uuid, text, text, text, text, text);
create or replace function public.rpc_queue_invoice_issue(
  p_order_id uuid,
  p_document_type text,
  p_customer_doc_type text,
  p_customer_doc_number text,
  p_customer_name text,
  p_idempotency_key text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_doc_type text := lower(coalesce(p_document_type, 'boleta'));
  v_doc_num text := nullif(btrim(coalesce(p_customer_doc_number, '')), '');
  v_customer_name text := nullif(btrim(coalesce(p_customer_name, '')), '');
  v_idempotency text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if p_order_id is null then
    raise exception 'ORDER_ID_REQUIRED';
  end if;

  if v_doc_type not in ('boleta', 'factura') then
    raise exception 'INVALID_DOCUMENT_TYPE';
  end if;

  update public.orders o
  set document_type = v_doc_type,
      customer_doc_type = upper(nullif(btrim(coalesce(p_customer_doc_type, '')), '')),
      customer_doc_number = v_doc_num,
      customer_name = coalesce(v_customer_name, o.nombre_cliente),
      sunat_status = 'queued',
      sunat_error = null,
      invoice_last_attempt_at = null,
      invoice_idempotency_key = coalesce(v_idempotency, o.invoice_idempotency_key)
  where o.id = p_order_id
  returning * into v_order;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  return v_order;
end;
$$;

revoke all on function public.rpc_queue_invoice_issue(uuid, text, text, text, text, text) from public;
grant execute on function public.rpc_queue_invoice_issue(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.rpc_queue_invoice_issue(uuid, text, text, text, text, text) to service_role;

-- RLS: no exponer bitácora a anon.
alter table public.invoice_issue_attempts enable row level security;

drop policy if exists invoice_issue_attempts_admin_read on public.invoice_issue_attempts;
create policy invoice_issue_attempts_admin_read
on public.invoice_issue_attempts
for select
to authenticated
using (public.is_admin_user(auth.uid()));

revoke all on public.invoice_issue_attempts from public;
grant select on public.invoice_issue_attempts to authenticated;
grant all on public.invoice_issue_attempts to service_role;

grant select, update(document_type, series, correlativo, sunat_status, sunat_error, sunat_provider, xml_url, xml_base64, cdr_url, cdr_base64, hash, qr_text, qr_url, taxable_amount, igv_amount, total_amount, currency, issue_datetime, invoice_idempotency_key, invoice_last_attempt_at, invoice_retry_count, invoice_payload, invoice_response, ticket_html, ticket_pdf_base64, invoice_issued_at, customer_doc_type, customer_doc_number, customer_name)
on public.orders to service_role;
