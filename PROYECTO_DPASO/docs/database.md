# Supabase Data Dictionary (DPASO)

> Estado: documento operativo para producción.  
> Fuente: definiciones SQL versionadas en `Carta-Dpaso-main/supabase/*.sql` + script reproducible de introspección en `supabase/tools/introspect_db.sql`.

## 1) Tablas `public` (snapshot de repo)

Tablas detectadas:
- `admin_panel_roles_catalog`
- `admin_panel_user_roles`
- `app_event_logs`
- `cash_movements`
- `cash_sessions`
- `customer_password_history`
- `customers`
- `delivery_zones`
- `internal_worker_accounts`
- `kitchen_command_items`
- `kitchen_commands`
- `order_items`
- `order_payment_events`
- `orders`
- `restaurant_tables`
- `store_settings`
- `table_ticket_items`
- `table_tickets`

### Tablas clave de pedidos/reportes

#### `public.orders`
- PK: `id uuid`
- Núcleo: `nombre_cliente`, `telefono`, `modalidad`, `direccion`, `referencia`, `comentario`, `total`, `estado`, `created_at`, `updated_at`.
- Email/receipt (según migraciones): `email`, `receipt_email`, `receipt_token`, `receipt_send_status`, `receipt_send_error`, `receipt_send_status_customer`, `receipt_send_status_internal`, `receipt_send_error_customer`, `receipt_send_error_internal`.
- Índices esperados: `idx_orders_created_at`, `orders_receipt_token_idx`.

#### `public.order_items`
- PK: `id uuid`
- FK: `order_id -> orders.id`
- Campos: `plato_id`, `nombre_snapshot`, `precio_snapshot`, `cantidad`, `subtotal`, `created_at`.
- Índice esperado: `idx_order_items_order_id`.

#### `public.customers`
- PK: `id uuid`
- Calidad de datos: `phone`, `normalized_phone`, `email`, `normalized_email` (según sprints), y métricas de recurrencia.

#### `public.delivery_zones`
- PK: `id uuid`
- Campos: `provincia`, `distrito`, `tarifa`, `minimo`, `activo`, timestamps.

#### `public.store_settings`
- PK: `id uuid`
- Campos operativos de tienda: apertura/cierre, timezone, delivery_fee, mínimo.

## 2) PK/FK/Índices

Para obtener lista exacta actual (entorno productivo):
1. Ejecutar `supabase/tools/introspect_db.sql`.
2. Revisar bloques:
   - **3)** Primary keys
   - **4)** Foreign keys
   - **5)** Índices

> Nota: la definición SQL en repo puede variar respecto al estado vivo de producción si faltó ejecutar una migración.

## 3) Triggers y funciones relevantes

Funciones críticas para pedidos/reportes:
- `public.create_order(payload jsonb)`
- `public.set_order_receipt_data(p_order_id uuid, p_email text, p_token text)`
- `public.get_order_status(short_code text)`
- `public.rpc_operational_metrics(date_from timestamptz, date_to timestamptz)`
- `public.rpc_sales_channel_summary(date_from timestamptz, date_to timestamptz)`
- `public.rpc_sync_web_orders_to_kitchen()`
- `public.rpc_register_order_payment(...)`
- `public.rpc_salon_send_to_kitchen(...)`

Triggers relevantes:
- `trg_set_updated_at_orders` sobre `orders`.
- Triggers de caja/sesión según sprints de caja (`cash_*`, `order_payment_events`).

Consulta exacta y completa:
- Bloque **6)** triggers.
- Bloque **7)** funciones.

## 4) Views

Actualmente no se detectan `VIEW` persistentes en los SQL versionados del repo.  
Verificar estado real con bloque **8)** del script de introspección.

## 5) RLS y policies

RLS habilitado (detectado en repo) en al menos:
- `orders`, `order_items`, `customers`, `delivery_zones`, `store_settings`, `cash_sessions`, `cash_movements`, `app_event_logs`, `customer_password_history`, `admin_panel_roles_catalog`, `internal_worker_accounts`.

Policies relevantes (ejemplos):
- Inserción pública de `orders` / `order_items` para checkout web.
- Lectura/gestión administrativa para tablas de panel interno.
- Policies de auto-servicio para perfil cliente (`customers_self_*`).

Para inventario exacto por tabla/condición:
- Bloque **9)** estado RLS por tabla.
- Bloque **10)** detalle de `pg_policies` (`cmd`, `qual`, `with_check`).

## 6) Edge Functions (repo)

Funciones presentes en `supabase/functions`:
- `send-receipt`
- `manage_internal_user`
- `create_internal_user`
- `create_worker_base_user`
- `admin-users-create`

### `send-receipt` (producción)
Secrets requeridos:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (recomendado: `DPASO <no-reply@dpasococinalibre.com>`)
- `ORDERS_NOTIFY_EMAIL`
- `INTERNAL_WEBHOOK_SECRET` (si se usa webhook interno)

## 7) Reproducibilidad

Archivo SQL para regenerar diccionario desde producción:
- `Carta-Dpaso-main/supabase/tools/introspect_db.sql`

Recomendación operativa:
- Ejecutar ese script tras cada migración en prod y actualizar este documento con salida real (especialmente columnas nuevas en `orders` y policies RLS).
