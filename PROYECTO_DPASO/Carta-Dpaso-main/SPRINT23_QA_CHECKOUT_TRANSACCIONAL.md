# Sprint 23 – QA de checkout transaccional

## Objetivo
Validar en frontend y flujo transaccional que:
- multi-click/doble submit no genera doble pedido,
- ante red lenta/falla el checkout se recupera sin perder carrito,
- el usuario recibe mensajes claros para reintento seguro.

## Alcance técnico
- Guard clause anti doble envío en `submitOrder` (`orderSubmitBusy` + `window.__dpasoSubmitting`).
- Contador interno `appRuntime.checkoutDuplicateSubmitBlocked` para evidenciar bloqueos de doble submit.
- Mensaje de recuperación de red/servidor indicando que el carrito se mantiene.

## Casos de prueba (manual)
### C1. Multi-click rápido en confirmar pedido
1. Agregar productos al carrito.
2. Ir a checkout y presionar `Confirmar pedido` repetidamente (10+ clicks en <2s).
3. Esperado:
   - Solo 1 intento real de envío.
   - Botón queda deshabilitado durante procesamiento.
   - En consola aparecen logs `Checkout duplicate submit bloqueado`.

### C2. Doble submit (click + Enter)
1. En checkout, con formulario válido, presionar Enter y click casi simultáneo.
2. Esperado:
   - Se bloquea el segundo intento por guard clause.
   - No se duplica pedido.

### C3. Red lenta (throttling)
1. Simular red lenta en navegador (Slow 3G).
2. Enviar pedido.
3. Esperado:
   - UI pasa a `Procesando...` y bloquea botón.
   - Al terminar, éxito normal o error controlado.

### C4. Falla de red/servidor
1. Simular offline o fallo de endpoint.
2. Enviar pedido.
3. Esperado:
   - Mensaje: `No se pudo crear el pedido por red/servidor...`.
   - Carrito permanece intacto para reintentar.
   - Botón vuelve a habilitarse.

### C5. Recuperación post-falla
1. Restaurar red.
2. Reintentar envío sin modificar carrito.
3. Esperado:
   - Pedido se crea una sola vez.

## Evidencia recomendada
- Captura consola con logs de bloqueos.
- Captura modal checkout en estado `Procesando...`.
- Captura mensaje de error de red/servidor y reintento exitoso.

## SQL
- Este sprint de QA **no requiere cambios SQL**.
