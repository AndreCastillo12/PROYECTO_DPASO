# PROYECTO_DPASO

## Sprint 15 — Gestión de Clientes (CRM básico)

Se agregó una entidad `customers` para normalizar clientes por teléfono y vincularlos con `orders`.

### Flujo al crear pedido (RPC `create_order`)
- Busca/crea cliente por teléfono (`upsert` en `customers`).
- Vincula el pedido con `orders.customer_id`.
- Recalcula métricas del cliente en la misma transacción:
  - `total_orders`
  - `total_spent`
  - `last_order_at`

### Admin
- Nueva sección **Clientes** (`/clientes`) con:
  - búsqueda por nombre/teléfono
  - orden por última compra o total gastado
  - detalle con historial de pedidos
  - botón WhatsApp
  - botón opcional de sincronización histórica

### Backfill opcional
- RPC: `public.rpc_backfill_customers_from_orders()`
- Reconstruye clientes desde pedidos antiguos y completa `orders.customer_id` cuando falta.

### Seguridad
- `customers` protegido con RLS para `admin` autenticado (`public.is_admin_user(auth.uid())`).
- No se abre lectura pública de clientes en la carta.


### Configuración Auth (Supabase)
- Habilitar **Email** con confirmación de correo en Authentication > Providers.
- Habilitar **Google OAuth** y configurar `Client ID` + `Client Secret`.
- En URL Configuration, incluir como redirect URL la URL pública de la carta (ej. `https://tu-dominio.com`).
- Mantener la compra como invitado: el checkout sigue funcionando sin sesión.
