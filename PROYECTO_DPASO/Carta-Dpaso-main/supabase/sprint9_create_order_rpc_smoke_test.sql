-- Smoke tests mínimos para public.create_order(jsonb)
-- Ejecutar en SQL Editor con datos reales de platos y zonas.
--
-- NOTA:
-- - Este script calcula subtotal/total dinámicamente para evitar el error
--   "subtotal no coincide con la suma de items".
-- - Si no tienes delivery_zones activas, el test de Delivery no generará filas.

-- 1) Delivery (dinámico)
with plato as (
  select id, nombre, precio::numeric as precio
  from public.platos
  where is_available is true
  order by created_at desc nulls last
  limit 1
), zona as (
  select
    dz.provincia,
    dz.distrito,
    coalesce(dz.tarifa, 0)::numeric as delivery_fee
  from public.delivery_zones dz
  where dz.activo is true
  order by dz.tarifa asc, dz.provincia asc, dz.distrito asc
  limit 1
), payload as (
  select jsonb_build_object(
    'customer', jsonb_build_object(
      'name', 'Cliente Test Delivery',
      'phone', '999888777',
      'modalidad', 'Delivery',
      'address', 'Av. Test 123',
      'referencia', 'Puerta azul',
      'provincia', zona.provincia,
      'distrito', zona.distrito
    ),
    'comment', 'Smoke test delivery',
    'items', jsonb_build_array(
      jsonb_build_object(
        'plato_id', plato.id,
        'nombre', plato.nombre,
        'precio', plato.precio,
        'qty', 1
      )
    ),
    'totals', jsonb_build_object(
      'subtotal', round(plato.precio, 2),
      'delivery_fee', round(zona.delivery_fee, 2),
      'total', round(plato.precio + zona.delivery_fee, 2)
    )
  ) as payload
  from plato
  cross join zona
)
select public.create_order(payload.payload)
from payload;

-- 2) Recojo (dinámico)
with plato as (
  select id, nombre, precio::numeric as precio
  from public.platos
  where is_available is true
  order by created_at desc nulls last
  limit 1
), payload as (
  select jsonb_build_object(
    'customer', jsonb_build_object(
      'name', 'Cliente Test Recojo',
      'phone', '999888776',
      'modalidad', 'Recojo',
      'address', null,
      'referencia', null,
      'provincia', null,
      'distrito', null
    ),
    'comment', 'Smoke test recojo',
    'items', jsonb_build_array(
      jsonb_build_object(
        'plato_id', plato.id,
        'nombre', plato.nombre,
        'precio', plato.precio,
        'qty', 1
      )
    ),
    'totals', jsonb_build_object(
      'subtotal', round(plato.precio, 2),
      'delivery_fee', 0,
      'total', round(plato.precio, 2)
    )
  ) as payload
  from plato
)
select public.create_order(payload.payload)
from payload;
