-- Sprint 27: endurecimiento de visibilidad de pedidos cliente (auth vs invitado)

alter table if exists public.orders enable row level security;

-- Cliente autenticado: solo ve sus pedidos.
drop policy if exists orders_customer_select_own on public.orders;
create policy orders_customer_select_own
on public.orders
for select
to authenticated
using (
  user_id = auth.uid()
);

-- Admin: puede ver/actualizar todos los pedidos.
drop policy if exists orders_admin_select_all on public.orders;
create policy orders_admin_select_all
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists orders_admin_update_all on public.orders;
create policy orders_admin_update_all
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

-- Detalle de estado privado para cliente autenticado (sin exponer pedidos de terceros)
drop function if exists public.get_my_order_status(text);
create or replace function public.get_my_order_status(p_short_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_short_code, '')));
  v_row record;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if v_code = '' or length(v_code) < 4 then
    raise exception 'INVALID_CODE';
  end if;

  select
    o.short_code,
    o.estado,
    o.modalidad,
    o.total,
    o.created_at,
    o.updated_at
  into v_row
  from public.orders o
  where o.short_code = v_code
    and o.user_id = v_uid
  limit 1;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'short_code', v_row.short_code,
    'status', v_row.estado,
    'modalidad', v_row.modalidad,
    'total', v_row.total,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_my_order_status(text) from public;
grant execute on function public.get_my_order_status(text) to authenticated;
