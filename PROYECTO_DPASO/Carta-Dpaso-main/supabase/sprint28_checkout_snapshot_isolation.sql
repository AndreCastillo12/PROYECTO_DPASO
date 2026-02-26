-- Sprint 28: checkout como snapshot aislado (sin mutar customers/perfil por defecto)

alter table if exists public.orders
  add column if not exists delivery_name text,
  add column if not exists delivery_phone text,
  add column if not exists delivery_address text,
  add column if not exists delivery_reference text,
  add column if not exists delivery_comment text,
  add column if not exists delivery_provincia text,
  add column if not exists delivery_distrito text;

update public.orders
set
  delivery_name = coalesce(nullif(delivery_name, ''), nombre_cliente),
  delivery_phone = coalesce(nullif(delivery_phone, ''), telefono),
  delivery_address = coalesce(nullif(delivery_address, ''), direccion),
  delivery_reference = coalesce(nullif(delivery_reference, ''), referencia),
  delivery_comment = coalesce(nullif(delivery_comment, ''), comentario),
  delivery_provincia = coalesce(nullif(delivery_provincia, ''), provincia),
  delivery_distrito = coalesce(nullif(delivery_distrito, ''), distrito)
where delivery_name is null
   or delivery_phone is null
   or delivery_address is null
   or delivery_reference is null
   or delivery_comment is null
   or delivery_provincia is null
   or delivery_distrito is null;

comment on column public.orders.delivery_name is 'Snapshot de nombre de entrega al momento del checkout';
comment on column public.orders.delivery_phone is 'Snapshot de teléfono de entrega al momento del checkout';
comment on column public.orders.delivery_address is 'Snapshot de dirección de entrega al momento del checkout';
comment on column public.orders.delivery_reference is 'Snapshot de referencia de entrega al momento del checkout';
comment on column public.orders.delivery_comment is 'Snapshot de comentario al momento del checkout';
comment on column public.orders.delivery_provincia is 'Snapshot de provincia al momento del checkout';
comment on column public.orders.delivery_distrito is 'Snapshot de distrito al momento del checkout';

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
  v_uid uuid;
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

  v_uid := auth.uid();

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
    user_id,
    short_code,
    delivery_name,
    delivery_phone,
    delivery_address,
    delivery_reference,
    delivery_comment,
    delivery_provincia,
    delivery_distrito
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
    null,
    v_uid,
    null,
    v_name,
    v_phone,
    v_address,
    v_referencia,
    nullif(pg_catalog.btrim(coalesce(payload ->> 'comment', '')), ''),
    v_provincia,
    v_distrito
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

  return pg_catalog.jsonb_build_object(
    'order_id', v_order_id,
    'short_id', v_short_id,
    'short_code', v_short_id,
    'created_at', v_created_at
  );
end;
$$;

comment on function public.create_order(jsonb) is
'RPC atómica para crear un pedido e items en una sola transacción. Guarda snapshot de entrega y no modifica customers por defecto.';

revoke all on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to anon;
grant execute on function public.create_order(jsonb) to authenticated;
