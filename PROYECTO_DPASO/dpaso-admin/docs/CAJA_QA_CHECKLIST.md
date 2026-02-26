# Checklist QA - Caja PRO (operación real)

## Reglas contables base
- Efectivo esperado = apertura + ventas_cash_pagadas + ingresos_manuales_cash - egresos_manuales_cash.
- Ventas no-efectivo no impactan efectivo esperado.
- Un pedido cash pagado impacta caja solo una vez (idempotencia).

## Caso 1: Caja cerrada -> pago tarjeta permitido, no afecta caja
- [ ] Con caja cerrada, registrar pago método `card/yape/plin/transfer` en pedido.
- [ ] Verificar `orders.paid=true` y `payment_method` correcto.
- [ ] Verificar que NO se crea `cash_movements` `order_sale`.

## Caso 2: Caja cerrada -> pago efectivo bloqueado
- [ ] Con caja cerrada, intentar guardar pago `cash`.
- [ ] Verificar error `CASH_SESSION_REQUIRED` (o mensaje equivalente).
- [ ] Verificar que pedido no queda pagado.

## Caso 3: Caja abierta -> pago efectivo crea movimiento automático 1 vez
- [ ] Abrir caja.
- [ ] Registrar pago efectivo en pedido.
- [ ] Verificar movimiento `order_sale` creado una vez.
- [ ] Reintentar guardar pago: no debe duplicar movimiento/pago.

## Caso 4: Movimientos manuales
- [ ] Ingreso manual suma al esperado.
- [ ] Egreso manual resta al esperado.
- [ ] Validar monto > 0, máximo permitido y motivo mínimo.

## Caso 5: Cierre con contado vacío
- [ ] No mostrar alerta roja fija.
- [ ] Mostrar mensaje neutro: “Ingresa el efectivo contado para calcular diferencia”.

## Caso 6: Cierre con contado = esperado
- [ ] Diferencia 0.00 en verde (OK).

## Caso 7: Cierre con diferencia
- [ ] Mostrar faltante/sobrante.
- [ ] Permitir cerrar guardando diferencia.

## Caso 8: Reconciliar inconsistencias
- [ ] Simular/forzar pago cash sin movimiento `order_sale`.
- [ ] Verificar bloqueo de cierre por inconsistencia.
- [ ] Ejecutar “Reconciliar”.
- [ ] Confirmar creación idempotente de movimientos faltantes.
- [ ] Cerrar caja exitosamente.

## Historial / reportes
- [ ] Historial muestra sesiones abiertas/cerradas con diferencia.
- [ ] `rpc_cash_summary` refleja cash/non-cash sin doble conteo.
- [ ] CSV de cierre descarga con valores correctos.
