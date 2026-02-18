# Sprint 16 - Checklist corto de regresión

## Precondiciones
- Migraciones SQL aplicadas (`sprint15_clientes.sql`, `sprint16_customer_auth.sql`, `sprint9_create_order_rpc.sql`).
- Usuario de prueba disponible para login cliente.
- Al menos 1 plato disponible y zonas delivery activas.

## Flujo invitado
1. Abrir carta pública sin sesión.
2. Crear 10 pedidos seguidos (mezclar Recojo y Delivery).
3. Validar que cada click en **Confirmar pedido** crea 1 pedido (sin congelamiento).

## Flujo autenticado
1. Iniciar sesión cliente.
2. Crear 10 pedidos seguidos.
3. Abrir **Mis pedidos** y verificar que aparecen pedidos del usuario.
4. Probar **Rastrear pedido** con último código y validar respuesta.

## Idle / sesión
1. Con sesión abierta, dejar la página inactiva 10 minutos.
2. Crear 1 pedido nuevo y validar que funciona sin refresh.
3. Cerrar sesión y verificar cambio inmediato de botón a **Iniciar sesión**.
4. Iniciar sesión nuevamente y repetir 1 pedido.

## Criterio de aceptación Sprint 16
- Sin freeze en checkout.
- Login/logout funcionando sin recargar página.
- Historial visible por usuario autenticado.
- Tracking operativo.
- Sin errores bloqueantes en consola.
