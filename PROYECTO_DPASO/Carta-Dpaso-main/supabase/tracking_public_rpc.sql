-- Tracking público de pedidos (sin login)

alter table if exists public.orders
  add column if not exists short_code text;

create unique index if not exists orders_short_code_uidx on public.orders(short_code);

drop function if exists public.get_order_status(text);

create or replace function public.get_order_status(short_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_code text;
begin
  v_code := pg_catalog.upper(pg_catalog.btrim(coalesce(short_code, '')));

  if v_code = '' or pg_catalog.length(v_code) < 4 then
    raise exception 'INVALID_CODE';
  end if;

  select
    orders.short_code as code,
    orders.estado as status,
    orders.modalidad,
    orders.total,
    orders.created_at,
    orders.updated_at
  into o
  from public.orders orders
  where orders.short_code = v_code
  limit 1;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  return pg_catalog.jsonb_build_object(
    'short_code', o.code,
    'status', o.status,
    'modalidad', o.modalidad,
    'total', o.total,
    'created_at', o.created_at,
    'updated_at', o.updated_at
  );
end;
$$;

revoke execute on function public.get_order_status(text) from public;
grant execute on function public.get_order_status(text) to anon;
grant execute on function public.get_order_status(text) to authenticated;
