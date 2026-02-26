-- Sprint 31: fix sync clientes por índice único legacy en invitados

-- Algunos entornos quedaron con un índice único no deseado para invitados,
-- provocando: duplicate key value violates unique constraint "customers_guest_phone_uidx".
-- Lo retiramos para permitir backfill sin colisiones por teléfono en invitados.
drop index if exists public.customers_guest_phone_uidx;
drop index if exists customers_guest_phone_uidx;

-- Mantener unicidad solo para cuentas registradas.
drop index if exists public.customers_registered_phone_uidx;
create unique index if not exists customers_registered_phone_uidx
  on public.customers(normalized_phone)
  where normalized_phone is not null
    and (user_id is not null or auth_user_id is not null);

-- Reafirma backfill sin ON CONFLICT(phone), separación registrados/invitados.
drop function if exists public.rpc_backfill_customers_from_orders();
create or replace function public.rpc_backfill_customers_from_orders()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  rec record;
  v_customer_id uuid;
  v_processed integer := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if not public.is_admin_user(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  for rec in
    select
      o.id as order_id,
      o.user_id,
      nullif(btrim(coalesce(o.nombre_cliente, '')), '') as name,
      nullif(btrim(coalesce(o.telefono, '')), '') as phone,
      nullif(regexp_replace(coalesce(o.telefono, ''), '[^0-9]+', '', 'g'), '') as normalized_phone
    from public.orders o
    where o.customer_id is null
    order by o.created_at asc
  loop
    v_customer_id := null;

    if rec.user_id is not null then
      select c.id
      into v_customer_id
      from public.customers c
      where c.user_id = rec.user_id
         or c.auth_user_id = rec.user_id
      order by c.updated_at desc nulls last, c.created_at desc
      limit 1;

      if v_customer_id is null then
        insert into public.customers(
          name,
          phone,
          normalized_phone,
          user_id,
          auth_user_id,
          created_at,
          updated_at
        )
        values (
          coalesce(rec.name, 'Cliente'),
          rec.phone,
          rec.normalized_phone,
          rec.user_id,
          rec.user_id,
          now(),
          now()
        )
        returning id into v_customer_id;
      else
        update public.customers c
        set
          name = coalesce(rec.name, c.name),
          phone = coalesce(rec.phone, c.phone),
          normalized_phone = coalesce(rec.normalized_phone, c.normalized_phone),
          updated_at = now()
        where c.id = v_customer_id;
      end if;
    else
      -- Invitado: registro independiente sin merge automático por teléfono.
      insert into public.customers(
        name,
        phone,
        normalized_phone,
        user_id,
        auth_user_id,
        created_at,
        updated_at
      )
      values (
        coalesce(rec.name, 'Cliente invitado'),
        rec.phone,
        rec.normalized_phone,
        null,
        null,
        now(),
        now()
      )
      returning id into v_customer_id;
    end if;

    update public.orders o
    set customer_id = v_customer_id
    where o.id = rec.order_id;

    v_processed := v_processed + 1;
  end loop;

  update public.customers c
  set
    total_orders = coalesce(s.total_orders, 0),
    total_spent = coalesce(s.total_spent, 0),
    last_order_at = s.last_order_at,
    updated_at = now()
  from (
    select
      o.customer_id,
      count(*)::int as total_orders,
      coalesce(sum(o.total), 0)::numeric(12,2) as total_spent,
      max(o.created_at) as last_order_at
    from public.orders o
    where o.customer_id is not null
    group by o.customer_id
  ) s
  where c.id = s.customer_id;

  return jsonb_build_object('processed_orders', v_processed);
end;
$$;

revoke all on function public.rpc_backfill_customers_from_orders() from public;
grant execute on function public.rpc_backfill_customers_from_orders() to authenticated;
