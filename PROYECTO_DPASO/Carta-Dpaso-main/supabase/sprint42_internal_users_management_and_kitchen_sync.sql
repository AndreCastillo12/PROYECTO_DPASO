-- Sprint 42: gestión interna de usuarios + sync cocina robusto por estados web

-- Quitar usuario interno del whitelist (sin borrar auth user por SQL)
create or replace function public.rpc_admin_remove_internal_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  if p_user_id = v_uid then
    raise exception 'CANNOT_REMOVE_SELF';
  end if;

  delete from public.admin_panel_user_roles r
  where r.user_id = p_user_id;

  update public.profiles p
  set role = null, updated_at = now()
  where p.id = p_user_id;

  return found;
end;
$$;

revoke all on function public.rpc_admin_remove_internal_user(uuid) from public;
grant execute on function public.rpc_admin_remove_internal_user(uuid) to authenticated;

-- Sync web orders -> kitchen con estados inglés/español (incluye late-sync)
create or replace function public.rpc_sync_web_orders_to_kitchen()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inserted integer := 0;
  rec record;
  v_command_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not (public.is_admin_user(v_uid) or public.is_role_cocina(v_uid) or public.is_role_mozo(v_uid)) then
    raise exception 'FORBIDDEN';
  end if;

  for rec in
    select o.id as order_id
    from public.orders o
    where lower(coalesce(o.modalidad, '')) in ('delivery', 'recojo', 'pickup', 'local')
      and lower(coalesce(o.estado, '')) in (
        'pending', 'accepted', 'preparing', 'ready', 'dispatched',
        'pendiente', 'aceptado', 'en_preparacion', 'en preparación', 'listo', 'en_reparto', 'en reparto'
      )
      and not exists (
        select 1
        from public.kitchen_commands kc
        where kc.order_id = o.id
          and kc.source_type = 'web'
          and kc.status in ('pending', 'preparing', 'ready')
      )
    order by o.created_at asc
  loop
    insert into public.kitchen_commands(
      ticket_id,
      table_id,
      status,
      note,
      table_name_snapshot,
      ticket_code_snapshot,
      source_type,
      order_id,
      created_by
    )
    values (
      null,
      null,
      'pending',
      'Pedido web',
      'WEB',
      upper(left(replace(rec.order_id::text, '-', ''), 8)),
      'web',
      rec.order_id,
      v_uid
    )
    on conflict (order_id)
    where source_type = 'web' and order_id is not null
    do update set
      note = excluded.note,
      updated_at = now()
    returning id into v_command_id;

    delete from public.kitchen_command_items where command_id = v_command_id;

    insert into public.kitchen_command_items(command_id, ticket_item_id, plato_id, qty, name_snapshot)
    select
      v_command_id,
      null,
      oi.plato_id,
      greatest(1, coalesce(oi.cantidad, 1)),
      coalesce(oi.nombre_producto, 'Producto')
    from public.order_items oi
    where oi.order_id = rec.order_id;

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.rpc_sync_web_orders_to_kitchen() from public;
grant execute on function public.rpc_sync_web_orders_to_kitchen() to authenticated;
