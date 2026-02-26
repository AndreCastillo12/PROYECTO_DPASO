# Checklist QA - Salón Tickets (Sprint 36)

## Preparación
- [ ] Migración `sprint36_salon_tickets.sql` aplicada.
- [ ] Existen mesas activas en `restaurant_tables`.

## Caso 1: CRUD mesas
- [ ] Crear mesa nueva desde UI Salón.
- [ ] Activar/Desactivar mesa.
- [ ] Eliminar mesa sin ticket abierto.
- [ ] Intentar eliminar mesa ocupada -> bloqueado con mensaje.

## Caso 2: Apertura ticket
- [ ] Seleccionar mesa activa.
- [ ] Abrir ticket -> se crea `table_tickets` con `status=open`.
- [ ] No permitir segundo ticket abierto para la misma mesa.

## Caso 3: Tomar pedido por mesa
- [ ] Cargar carta compacta sin imágenes.
- [ ] Agregar ítems al ticket (`table_ticket_items`).
- [ ] Subir/bajar cantidad.
- [ ] Quitar ítem.
- [ ] Total recalcula correctamente usando `price_snapshot * qty`.

## Caso 4: Cierre ticket / generar pedido
- [ ] Cerrar ticket genera `orders` modalidad `salon` (no se edita ticket como order directo).
- [ ] `orders.ticket_id` y `orders.table_id` guardados.
- [ ] Se copian `order_items` desde `table_ticket_items` (snapshot).
- [ ] Ticket cambia a `status=closed` y guarda `generated_order_id`.

## Caso 5: Pago flujo normal
- [ ] Pedido generado aparece en lista de pedidos.
- [ ] Registrar pago desde flujo normal de pedidos/caja.
- [ ] Si pago cash sin caja abierta -> bloqueado por regla existente.
