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
- Habilitar **Email** con confirmación de correo en `Authentication > Providers > Email`.
- Habilitar **Google OAuth** en `Authentication > Providers > Google` con `Client ID` + `Client Secret`.
- En `Authentication > URL Configuration` registrar explícitamente la URL donde vive la carta:
  - Producción: `https://tu-dominio.com/index.html` (o la ruta exacta de la carta)
  - Local: `http://127.0.0.1:5500/index.html` (o el puerto/ruta exactos que uses)
- Si no se agrega esa ruta exacta, Supabase puede redirigir al root del proyecto y no a la carta.
- Mantener la compra como invitado: el checkout sigue funcionando sin sesión.
