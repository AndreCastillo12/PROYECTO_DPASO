# Nota técnica — Caja PRO

## Reglas de cálculo (fuente de verdad)
- `efectivo_esperado = apertura + ventas_cash_pagadas + ingresos_manuales_cash - egresos_manuales_cash`.
- `ventas_no_efectivo` se reportan para analítica, **no** se suman al efectivo esperado.
- El resumen operativo usa `rpc_cash_summary(session_id)` como fuente única para evitar doble conteo.

## Decisión UX de pagos (checkbox vs botón)
- El checkbox “Pedido pagado” en detalle de pedido queda solo como indicador visual (read-only).
- El botón **Guardar pago** es el único punto de persistencia.
- Esto evita inconsistencias por doble persistencia desde UI.

## Idempotencia
- Reintentar `Guardar pago` sobre un pedido ya pagado retorna estado actual (respuesta idempotente) sin crear nuevos eventos.
- Se agrega índice único `order_payment_events(order_id)` para reforzar un solo evento de pago por pedido.
- Para ventas cash, el movimiento de caja automático de pedido se mantiene con unicidad por sesión/pedido.

## Cierre de caja
- Para cerrar se exige monto contado válido.
- Si hay pagos cash sin movimiento de caja, el cierre se bloquea hasta reconciliar.
- La reconciliación crea faltantes de forma idempotente.
