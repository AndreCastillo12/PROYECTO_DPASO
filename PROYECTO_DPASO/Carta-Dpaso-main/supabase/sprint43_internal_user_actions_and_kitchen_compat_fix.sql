-- Sprint 43: fixes operativos usuarios internos y compatibilidad cocina

-- 1) Quitar interno sin asumir columnas opcionales de profiles
create or replace function public.rpc_admin_remove_internal_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted integer := 0;
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

  get diagnostics v_deleted = row_count;

  -- Opcional: limpiar role de profile solo si existe esa columna
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'profiles'
      and c.column_name = 'role'
  ) then
    execute 'update public.profiles set role = null where id = $1' using p_user_id;
  end if;

  return v_deleted > 0;
end;
$$;

revoke all on function public.rpc_admin_remove_internal_user(uuid) from public;
grant execute on function public.rpc_admin_remove_internal_user(uuid) to authenticated;

-- 2) Sync cocina compatible con variantes de columnas en order_items
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
      coalesce(
        nullif(trim(coalesce(to_jsonb(oi)->>'nombre_producto', '')), ''),
        nullif(trim(coalesce(to_jsonb(oi)->>'nombre', '')), ''),
        nullif(trim(coalesce(to_jsonb(oi)->>'name_snapshot', '')), ''),
        nullif(trim(coalesce(to_jsonb(oi)->>'product_name', '')), ''),
        p.nombre,
        'Producto'
      )
    from public.order_items oi
    left join public.platos p on p.id = oi.plato_id
    where oi.order_id = rec.order_id;

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.rpc_sync_web_orders_to_kitchen() from public;
grant execute on function public.rpc_sync_web_orders_to_kitchen() to authenticated;
