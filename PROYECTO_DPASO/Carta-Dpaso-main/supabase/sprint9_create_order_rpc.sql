-- Sprint 9: RPC transaccional para crear pedidos
-- Objetivo: insertar orders + order_items de forma atómica (una sola llamada RPC)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Compatibilidad de columnas para totals y zona (idempotente)
-- ---------------------------------------------------------------------------
alter table if exists public.orders
  add column if not exists subtotal numeric(10,2) not null default 0,
  add column if not exists delivery_fee numeric(10,2) not null default 0,
  add column if not exists provincia text,
  add column if not exists distrito text;

alter table if exists public.orders
  alter column estado set default 'pending';

alter table if exists public.orders
  add column if not exists short_code text;

create unique index if not exists orders_short_code_uidx on public.orders(short_code);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  normalized_phone text,
  total_orders integer not null default 0,
  total_spent numeric(12,2) not null default 0,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop index if exists public.customers_phone_uidx;
create unique index if not exists customers_guest_phone_uidx on public.customers(phone) where auth_user_id is null;

alter table if exists public.orders
  add column if not exists customer_id uuid references public.customers(id),
  add column if not exists auth_user_id uuid references auth.users(id);

create index if not exists orders_customer_id_idx on public.orders(customer_id);
create index if not exists orders_auth_user_id_idx on public.orders(auth_user_id);

alter table if exists public.customers
  add column if not exists auth_user_id uuid references auth.users(id),
  add column if not exists email text,
  add column if not exists dni text,
  add column if not exists account_type text not null default 'guest';

create unique index if not exists customers_auth_user_uidx on public.customers(auth_user_id) where auth_user_id is not null;
create unique index if not exists customers_dni_uidx on public.customers(dni) where dni is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_subtotal_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_subtotal_check
      check (subtotal >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_delivery_fee_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_delivery_fee_check
      check (delivery_fee >= 0);
  end if;
end $$;

comment on column public.orders.subtotal is 'Subtotal de items al momento de crear el pedido';
comment on column public.orders.delivery_fee is 'Costo de delivery al momento de crear el pedido';
comment on column public.orders.provincia is 'Provincia de entrega para modalidad Delivery';
comment on column public.orders.distrito is 'Distrito de entrega para modalidad Delivery';

-- ---------------------------------------------------------------------------
-- RPC transaccional
-- ---------------------------------------------------------------------------
drop function if exists public.create_order(jsonb);

create or replace function public.create_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer jsonb;
  v_items jsonb;
  v_totals jsonb;

  v_name text;
  v_phone text;
  v_modalidad text;
  v_address text;
  v_referencia text;
  v_provincia text;
  v_distrito text;

  v_subtotal numeric;
  v_delivery_fee numeric;
  v_total numeric;

  v_order_id uuid;
  v_customer_id uuid;
  v_auth_uid uuid;
  v_customer_email text;
  v_short_id text;
  v_created_at timestamptz;

  v_item jsonb;
  v_plato_id uuid;
  v_item_name text;
  v_item_price numeric;
  v_item_qty integer;
  v_item_subtotal numeric;
  v_items_subtotal_calc numeric := 0;
  v_has_zone boolean := false;

  v_plato_nombre_actual text;
  v_plato_available boolean;
  v_plato_track_stock boolean;
  v_plato_stock integer;
  v_plato_ref text;
begin
  if payload is null or pg_catalog.jsonb_typeof(payload) <> 'object' then
    raise exception 'Payload inválido';
  end if;

  v_auth_uid := auth.uid();

  v_customer := payload -> 'customer';
  v_items := payload -> 'items';
  v_totals := payload -> 'totals';

  if pg_catalog.jsonb_typeof(v_customer) <> 'object' then
    raise exception 'customer es obligatorio y debe ser objeto';
  end if;
  if pg_catalog.jsonb_typeof(v_items) <> 'array' then
    raise exception 'items es obligatorio y debe ser array';
  end if;
  if pg_catalog.jsonb_typeof(v_totals) <> 'object' then
    raise exception 'totals es obligatorio y debe ser objeto';
  end if;
  if pg_catalog.jsonb_array_length(v_items) = 0 then
    raise exception 'El pedido debe incluir al menos un item';
  end if;

  v_name := pg_catalog.btrim(coalesce(v_customer ->> 'name', ''));
  v_phone := pg_catalog.btrim(coalesce(v_customer ->> 'phone', ''));
  v_modalidad := pg_catalog.btrim(coalesce(v_customer ->> 'modalidad', ''));
  v_address := nullif(pg_catalog.btrim(coalesce(v_customer ->> 'address', '')), '');
  v_referencia := nullif(pg_catalog.btrim(coalesce(v_customer ->> 'referencia', '')), '');
  v_customer_email := nullif(pg_catalog.btrim(pg_catalog.lower(coalesce(v_customer ->> 'email', ''))), '');
  v_provincia := nullif(pg_catalog.btrim(coalesce(v_customer ->> 'provincia', '')), '');
  v_distrito := nullif(pg_catalog.btrim(coalesce(v_customer ->> 'distrito', '')), '');

  if v_name = '' then
    raise exception 'customer.name es obligatorio';
  end if;
  if v_phone = '' then
    raise exception 'customer.phone es obligatorio';
  end if;
  if v_modalidad not in ('Delivery', 'Recojo') then
    raise exception 'customer.modalidad inválida';
  end if;

  begin
    v_subtotal := (v_totals ->> 'subtotal')::numeric;
    v_delivery_fee := (v_totals ->> 'delivery_fee')::numeric;
    v_total := (v_totals ->> 'total')::numeric;
  exception when others then
    raise exception 'totals inválido: subtotal, delivery_fee y total deben ser numéricos';
  end;

  if v_subtotal < 0 then
    raise exception 'subtotal no puede ser negativo';
  end if;
  if v_delivery_fee < 0 then
    raise exception 'delivery_fee no puede ser negativo';
  end if;
  if v_total < 0 then
    raise exception 'total no puede ser negativo';
  end if;

  if pg_catalog.abs(v_total - (v_subtotal + v_delivery_fee)) > 0.01 then
    raise exception 'total no coincide con subtotal + delivery_fee';
  end if;

  if v_modalidad = 'Delivery' then
    if v_address is null then
      raise exception 'Para Delivery, customer.address es obligatorio';
    end if;
    if v_provincia is null or v_distrito is null then
      raise exception 'Para Delivery, customer.provincia y customer.distrito son obligatorios';
    end if;

    select exists (
      select 1
      from public.delivery_zones dz
      where dz.provincia = v_provincia
        and dz.distrito = v_distrito
        and dz.activo is true
    )
    into v_has_zone;

    if not v_has_zone then
      raise exception 'No hay cobertura activa para la zona seleccionada';
    end if;
  else
    v_address := null;
    v_provincia := null;
    v_distrito := null;
    v_delivery_fee := 0;

    if pg_catalog.abs(v_total - v_subtotal) > 0.01 then
      raise exception 'Para Recojo, total debe ser igual a subtotal';
    end if;
  end if;

  if v_auth_uid is not null then
    insert into public.customers(name, phone, normalized_phone, auth_user_id, email, account_type)
    values (
      v_name,
      v_phone,
      nullif(pg_catalog.regexp_replace(v_phone, '[^0-9]+', '', 'g'), ''),
      v_auth_uid,
      v_customer_email,
      'registered'
    )
    on conflict (auth_user_id) do update
      set name = excluded.name,
          phone = excluded.phone,
          normalized_phone = excluded.normalized_phone,
          email = coalesce(excluded.email, public.customers.email),
          account_type = 'registered',
          updated_at = now()
    returning id into v_customer_id;
  else
    select c.id
    into v_customer_id
    from public.customers c
    where c.phone = v_phone
      and c.auth_user_id is null
    for update;

    if v_customer_id is null then
      insert into public.customers(name, phone, normalized_phone, account_type)
      values (
        v_name,
        v_phone,
        nullif(pg_catalog.regexp_replace(v_phone, '[^0-9]+', '', 'g'), ''),
        'guest'
      )
      returning id into v_customer_id;
    else
      update public.customers
      set
        name = v_name,
        normalized_phone = nullif(pg_catalog.regexp_replace(v_phone, '[^0-9]+', '', 'g'), ''),
        updated_at = now()
      where id = v_customer_id;
    end if;
  end if;

  insert into public.orders (
    nombre_cliente,
    telefono,
    modalidad,
    direccion,
    referencia,
    comentario,
    subtotal,
    delivery_fee,
    total,
    provincia,
    distrito,
    customer_id,
    auth_user_id,
    short_code
  ) values (
    v_name,
    v_phone,
    v_modalidad,
    v_address,
    v_referencia,
    nullif(pg_catalog.btrim(coalesce(payload ->> 'comment', '')), ''),
    pg_catalog.round(v_subtotal, 2),
    pg_catalog.round(v_delivery_fee, 2),
    pg_catalog.round(v_total, 2),
    v_provincia,
    v_distrito,
    v_customer_id,
    v_auth_uid,
    v_short_id
  )
  returning id, created_at into v_order_id, v_created_at;

  for v_item in select value from pg_catalog.jsonb_array_elements(v_items)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      raise exception 'Cada item debe ser objeto';
    end if;

    begin
      v_plato_id := nullif(v_item ->> 'plato_id', '')::uuid;
    exception when others then
      raise exception 'item.plato_id inválido';
    end;

    v_item_name := pg_catalog.btrim(coalesce(v_item ->> 'nombre', ''));
    if v_item_name = '' then
      raise exception 'item.nombre es obligatorio';
    end if;

    begin
      v_item_price := (v_item ->> 'precio')::numeric;
      v_item_qty := (v_item ->> 'qty')::integer;
    exception when others then
      raise exception 'item.precio y item.qty deben ser numéricos';
    end;

    if v_item_price < 0 then
      raise exception 'item.precio no puede ser negativo';
    end if;
    if v_item_qty <= 0 then
      raise exception 'item.qty debe ser mayor a 0';
    end if;

    select
      p.nombre,
      p.is_available,
      p.track_stock,
      p.stock
    into
      v_plato_nombre_actual,
      v_plato_available,
      v_plato_track_stock,
      v_plato_stock
    from public.platos p
    where p.id = v_plato_id
    for update;

    if not found then
      raise exception 'NOT_FOUND: %', v_plato_id;
    end if;

    v_plato_ref := lower(regexp_replace(coalesce(v_plato_nombre_actual, v_plato_id::text), '[^a-zA-Z0-9]+', '_', 'g'));

    if v_plato_available is not true then
      raise exception 'NOT_AVAILABLE: %', v_plato_ref;
    end if;

    if v_plato_track_stock is true and coalesce(v_plato_stock, 0) < v_item_qty then
      raise exception 'OUT_OF_STOCK: %', v_plato_ref;
    end if;

    v_item_subtotal := pg_catalog.round((v_item_price * v_item_qty)::numeric, 2);
    v_items_subtotal_calc := v_items_subtotal_calc + v_item_subtotal;

    if v_plato_track_stock is true then
      update public.platos
      set stock = coalesce(stock, 0) - v_item_qty
      where id = v_plato_id
        and coalesce(stock, 0) >= v_item_qty;

      if not found then
        raise exception 'OUT_OF_STOCK: %', v_plato_ref;
      end if;
    end if;

    insert into public.order_items (
      order_id,
      plato_id,
      nombre_snapshot,
      precio_snapshot,
      cantidad,
      subtotal
    ) values (
      v_order_id,
      v_plato_id,
      v_item_name,
      pg_catalog.round(v_item_price, 2),
      v_item_qty,
      v_item_subtotal
    );
  end loop;

  if pg_catalog.abs(v_items_subtotal_calc - v_subtotal) > 0.01 then
    raise exception 'subtotal no coincide con la suma de items';
  end if;

  v_short_id := pg_catalog.upper(pg_catalog.substring(pg_catalog.replace(v_order_id::text, '-', ''), 1, 8));

  update public.orders
  set short_code = v_short_id
  where id = v_order_id;

  update public.customers c
  set
    name = coalesce(
      (
        select nullif(pg_catalog.btrim(coalesce(o2.nombre_cliente, '')), '')
        from public.orders o2
        where o2.customer_id = v_customer_id
          and nullif(pg_catalog.btrim(coalesce(o2.nombre_cliente, '')), '') is not null
        order by o2.created_at desc
        limit 1
      ),
      c.name
    ),
    email = coalesce(v_customer_email, c.email),
    account_type = case when c.auth_user_id is null then 'guest' else 'registered' end,
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
    where o.customer_id = v_customer_id
    group by o.customer_id
  ) s
  where c.id = s.customer_id;

  return pg_catalog.jsonb_build_object(
    'order_id', v_order_id,
    'short_id', v_short_id,
    'short_code', v_short_id,
    'created_at', v_created_at
  );
end;
$$;

comment on function public.create_order(jsonb) is
'RPC atómica para crear un pedido e items en una sola transacción. Si falla, hace rollback completo.';

-- Seguridad de ejecución: solo roles explícitos
revoke all on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to anon;
grant execute on function public.create_order(jsonb) to authenticated;
