# Checklist QA - Caja (operación real)

## Flujo principal de caja
- [ ] Abrir caja con monto inicial `0.00` (válido).
- [ ] Abrir caja con monto inicial positivo (válido).
- [ ] Intentar abrir caja con monto negativo (debe bloquearse).
- [ ] Intentar abrir una segunda caja con una caja ya abierta (debe bloquearse).

## Movimientos manuales
- [ ] Registrar ingreso manual (`IN`) con monto > 0 y motivo (válido).
- [ ] Registrar egreso manual (`OUT`) con monto > 0 y motivo (válido).
- [ ] Intentar registrar movimiento con monto 0 o negativo (debe bloquearse).
- [ ] Intentar registrar movimiento sin motivo (debe bloquearse).
- [ ] Verificar que se guarden usuario/timestamp del movimiento.

## Ventas automáticas desde pedidos
- [ ] Marcar pedido pagado en **efectivo** (`paid=true`, `payment_method='cash'`, no cancelado): debe reflejarse en `cash_sales` y en esperado.
- [ ] Marcar pedido pagado en **Yape/Tarjeta/otros**: debe reflejarse en ventas totales/reportes por método, pero **NO** sumar a efectivo esperado.
- [ ] Marcar pedido cancelado con paid=true: no debe contabilizarse en caja.
- [ ] Editar pedido para cambiar pago de cash a no-cash (o viceversa): validar que no se duplique el conteo en caja.

## Cierre de caja
- [ ] Cerrar caja con monto contado válido (`>= 0`).
- [ ] Verificar cálculo: `esperado = apertura + cash_sales + manual_in - manual_out`.
- [ ] Verificar `difference = contado - esperado`.
- [ ] Intentar cerrar sin caja abierta (debe bloquearse).
- [ ] Intentar cerrar con monto inválido / NaN / negativo (debe bloquearse).
- [ ] Intentar cerrar caja ya cerrada (debe bloquearse).

## Día siguiente / nueva sesión
- [ ] Cerrar caja del día.
- [ ] Abrir nueva caja al día siguiente.
- [ ] Verificar que la nueva sesión no arrastre movimientos manuales de la sesión anterior.

## Diagnóstico y errores
- [ ] En errores de RPC/DB, validar mensaje amigable en UI.
- [ ] Confirmar log técnico con `code/message/details/hint` en consola y observabilidad.

## Regresión (no romper)
- [ ] Pedidos: alta/edición de estado/pago sigue operativa.
- [ ] Reportes: `Ventas por estado`, `método de pago`, `top productos` siguen consultando sin errores.
- [ ] Dashboard admin: KPIs y tablas de pedidos cargan correctamente.
