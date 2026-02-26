-- Sprint 34: Reportes (cantidad por unidades) + soporte Salón/Mesas

alter table if exists public.orders
  add column if not exists table_number text,
  add column if not exists table_ticket_open boolean not null default false;

create index if not exists orders_modalidad_estado_idx
  on public.orders(modalidad, estado, created_at desc);

create index if not exists orders_table_open_idx
  on public.orders(table_number, table_ticket_open)
  where table_number is not null;

-- Reporte ventas: cantidad = suma unidades de order_items (COALESCE 0)
drop function if exists public.rpc_sales_report(timestamptz, timestamptz, text);
create or replace function public.rpc_sales_report(date_from timestamptz, date_to timestamptz, group_by text)
returns table (
  label text,
  total_sales numeric,
  orders_count bigint,
  total_qty bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_from timestamptz := coalesce(date_from, now() - interval '7 days');
  v_to timestamptz := coalesce(date_to, now());
  v_group text := lower(coalesce(group_by, 'day'));
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  if v_group = 'day' then
    return query
    with order_qty as (
      select oi.order_id, coalesce(sum(oi.cantidad), 0)::bigint as qty
      from public.order_items oi
      group by oi.order_id
    )
    select
      to_char(date_trunc('day', o.created_at), 'YYYY-MM-DD') as label,
      coalesce(sum(o.total), 0)::numeric as total_sales,
      count(*)::bigint as orders_count,
      coalesce(sum(coalesce(oq.qty, 0)), 0)::bigint as total_qty
    from public.orders o
    left join order_qty oq on oq.order_id = o.id
    where o.created_at between v_from and v_to
      and lower(coalesce(o.estado, '')) <> 'cancelled'
      and coalesce(o.paid, false) = true
    group by date_trunc('day', o.created_at)
    order by date_trunc('day', o.created_at);

  elseif v_group = 'status' then
    return query
    with order_qty as (
      select oi.order_id, coalesce(sum(oi.cantidad), 0)::bigint as qty
      from public.order_items oi
      group by oi.order_id
    )
    select
      coalesce(o.estado, 'unknown') as label,
      coalesce(sum(o.total), 0)::numeric,
      count(*)::bigint,
      coalesce(sum(coalesce(oq.qty, 0)), 0)::bigint
    from public.orders o
    left join order_qty oq on oq.order_id = o.id
    where o.created_at between v_from and v_to
    group by coalesce(o.estado, 'unknown')
    order by 2 desc;

  elseif v_group = 'payment_method' then
    return query
    with order_qty as (
      select oi.order_id, coalesce(sum(oi.cantidad), 0)::bigint as qty
      from public.order_items oi
      group by oi.order_id
    )
    select
      coalesce(nullif(lower(o.payment_method), ''), 'unknown') as label,
      coalesce(sum(o.total), 0)::numeric,
      count(*)::bigint,
      coalesce(sum(coalesce(oq.qty, 0)), 0)::bigint
    from public.orders o
    left join order_qty oq on oq.order_id = o.id
    where o.created_at between v_from and v_to
      and lower(coalesce(o.estado, '')) <> 'cancelled'
      and coalesce(o.paid, false) = true
    group by coalesce(nullif(lower(o.payment_method), ''), 'unknown')
    order by 2 desc;

  elseif v_group = 'modalidad' then
    return query
    with order_qty as (
      select oi.order_id, coalesce(sum(oi.cantidad), 0)::bigint as qty
      from public.order_items oi
      group by oi.order_id
    )
    select
      coalesce(o.modalidad, 'unknown') as label,
      coalesce(sum(o.total), 0)::numeric,
      count(*)::bigint,
      coalesce(sum(coalesce(oq.qty, 0)), 0)::bigint
    from public.orders o
    left join order_qty oq on oq.order_id = o.id
    where o.created_at between v_from and v_to
      and lower(coalesce(o.estado, '')) <> 'cancelled'
      and coalesce(o.paid, false) = true
    group by coalesce(o.modalidad, 'unknown')
    order by 2 desc;

  elseif v_group = 'zone' then
    return query
    with order_qty as (
      select oi.order_id, coalesce(sum(oi.cantidad), 0)::bigint as qty
      from public.order_items oi
      group by oi.order_id
    )
    select
      coalesce(nullif(trim(concat_ws(' - ', o.provincia, o.distrito)), ''), 'Sin zona') as label,
      coalesce(sum(o.total), 0)::numeric,
      count(*)::bigint,
      coalesce(sum(coalesce(oq.qty, 0)), 0)::bigint
    from public.orders o
    left join order_qty oq on oq.order_id = o.id
    where o.created_at between v_from and v_to
      and lower(coalesce(o.estado, '')) <> 'cancelled'
      and coalesce(o.paid, false) = true
    group by coalesce(nullif(trim(concat_ws(' - ', o.provincia, o.distrito)), ''), 'Sin zona')
    order by 2 desc;

  elseif v_group = 'top_products' then
    return query
    select
      coalesce(oi.nombre_snapshot, 'Sin nombre') as label,
      coalesce(sum(oi.subtotal), 0)::numeric,
      count(distinct oi.order_id)::bigint,
      coalesce(sum(oi.cantidad), 0)::bigint
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.created_at between v_from and v_to
      and lower(coalesce(o.estado, '')) <> 'cancelled'
      and coalesce(o.paid, false) = true
    group by coalesce(oi.nombre_snapshot, 'Sin nombre')
    order by 4 desc, 2 desc;

  else
    raise exception 'INVALID_GROUP_BY';
  end if;
end;
$$;

revoke all on function public.rpc_sales_report(timestamptz, timestamptz, text) from public;
grant execute on function public.rpc_sales_report(timestamptz, timestamptz, text) to authenticated;
