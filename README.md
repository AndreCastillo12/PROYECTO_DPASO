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

### Troubleshooting rápido (Auth)
- Error `Unsupported provider: provider is not enabled`: Google no está habilitado en Supabase.
- Si el link de confirmación/recuperación te envía al root del proyecto, revisa que el redirect permitido coincida con la ruta exacta de la carta (`.../index.html`).
- Si intentas crear cuenta con un correo ya registrado, usa **Iniciar sesión** o **Recuperar contraseña**.

## Roadmap propuesto — próximos sprints

### Sprint 17 — Estado operativo (Semáforo)
- Implementar una vista de estado general por módulo: **Carta**, **Admin**, **Base de datos**, **Deploy**.
- Mostrar indicadores visuales tipo semáforo:
  - 🟢 Listo
  - 🟡 En progreso
  - 🔴 Falta
- Definir checklist mínimo por módulo (criterios para cambiar de color).
- Publicar resumen semanal para facilitar seguimiento del avance.

### Sprint 18 — Observabilidad y calidad
- Integrar logging estructurado para errores críticos (checkout, pedidos, auth, caja).
- Crear tablero de métricas operativas: conversión, pedidos caídos, tiempo de respuesta RPC.
- Añadir pruebas automáticas base para rutas críticas del admin y de la carta.

### Sprint 19 — UX de operación diaria
- Mejorar tiempos de carga percibidos en Pedidos/Clientes/Reportes.
- Unificar mensajes de error y éxito para todo el flujo operativo.
- Mejorar filtros guardando preferencias del usuario admin (estado, fechas, orden).

### Sprint 20 — Automatización comercial
- Plantillas de WhatsApp para postventa (confirmación, seguimiento, reactivación).
- Segmentación simple de clientes (frecuentes, inactivos, ticket alto).
- Recordatorios automáticos para clientes sin recompra en ventana definida.

### Sprint 21 — Cierre de ciclo y despliegue
- Auditoría final de RLS/policies para tablas sensibles.
- Hardening de auth (review de redirects, expiración de sesión, recuperación).
- Checklist de release y rollback para deploy seguro.
- Documentación final de operación para el equipo (runbook + troubleshooting).
