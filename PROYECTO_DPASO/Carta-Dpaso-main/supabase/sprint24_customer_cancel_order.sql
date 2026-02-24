-- Sprint 24: cancelación de pedido por cliente autenticado

-- Permite al cliente cancelar sus propios pedidos mientras estén en etapa operativa temprana.

drop function if exists public.cancel_my_order(text);
create or replace function public.cancel_my_order(p_short_code text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_short_code, '')));
  v_row public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if v_code = '' then
    raise exception 'INVALID_CODE';
  end if;

  select o.*
  into v_row
  from public.orders o
  where o.short_code = v_code
    and o.user_id = v_uid
  limit 1;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if coalesce(v_row.estado, '') not in ('pending', 'accepted', 'preparing', 'ready') then
    raise exception 'ORDER_CANNOT_BE_CANCELLED';
  end if;

  update public.orders o
  set estado = 'cancelled',
      updated_at = now()
  where o.id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.cancel_my_order(text) from public;
grant execute on function public.cancel_my_order(text) to authenticated;
