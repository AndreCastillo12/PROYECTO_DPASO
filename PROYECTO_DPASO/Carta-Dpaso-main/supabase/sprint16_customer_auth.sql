-- Sprint 16: autenticación cliente + historial

alter table if exists public.customers
  add column if not exists user_id uuid references auth.users(id);

create unique index if not exists customers_user_id_uidx
  on public.customers(user_id)
  where user_id is not null;

alter table if exists public.orders
  add column if not exists user_id uuid references auth.users(id);

create index if not exists orders_user_id_idx on public.orders(user_id);

-- Historial de pedidos del cliente autenticado
-- Usa SECURITY DEFINER para evitar exponer la tabla completa.
drop function if exists public.get_my_orders();
create or replace function public.get_my_orders()
returns table (
  id uuid,
  created_at timestamptz,
  total numeric,
  estado text,
  short_code text,
  modalidad text
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
    o.id,
    o.created_at,
    o.total,
    o.estado,
    o.short_code,
    o.modalidad
  from public.orders o
  where o.user_id = v_uid
  order by o.created_at desc
  limit 50;
end;
$$;

revoke all on function public.get_my_orders() from public;
grant execute on function public.get_my_orders() to authenticated;
