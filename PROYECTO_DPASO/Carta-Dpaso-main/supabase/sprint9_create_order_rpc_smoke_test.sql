-- Smoke tests mínimos para public.create_order(jsonb)
-- Ejecutar en SQL Editor con datos reales de platos y zonas.

-- 1) Delivery
select public.create_order(
  jsonb_build_object(
    'customer', jsonb_build_object(
      'name', 'Cliente Test Delivery',
      'phone', '999888777',
      'modalidad', 'Delivery',
      'address', 'Av. Test 123',
      'referencia', 'Puerta azul',
      'provincia', 'Lima',
      'distrito', 'Ate'
    ),
    'comment', 'Smoke test delivery',
    'items', (
      select jsonb_agg(
        jsonb_build_object(
          'plato_id', p.id,
          'nombre', p.nombre,
          'precio', p.precio,
          'qty', 1
        )
      )
      from (
        select id, nombre, precio
        from public.platos
        where is_available is true
        order by created_at desc nulls last
        limit 1
      ) p
    ),
    'totals', jsonb_build_object(
      'subtotal', 10,
      'delivery_fee', 0,
      'total', 10
    )
  )
);

-- 2) Recojo
select public.create_order(
  jsonb_build_object(
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
    'items', (
      select jsonb_agg(
        jsonb_build_object(
          'plato_id', p.id,
          'nombre', p.nombre,
          'precio', p.precio,
          'qty', 1
        )
      )
      from (
        select id, nombre, precio
        from public.platos
        where is_available is true
        order by created_at desc nulls last
        limit 1
      ) p
    ),
    'totals', jsonb_build_object(
      'subtotal', 10,
      'delivery_fee', 0,
      'total', 10
    )
  )
);
