# Checklist QA - Salón POS + Precuenta (Sprint 37)

1. [ ] Crear mesa nueva en CRUD de Mesas.
2. [ ] Editar nombre de mesa y validar cambio visual.
3. [ ] Desactivar mesa y confirmar que no aparece en mesas operativas.
4. [ ] Activar nuevamente mesa y confirmar que vuelve a operativas.
5. [ ] Abrir ticket en mesa libre y confirmar que la mesa pasa a **Ocupada**.
6. [ ] Intentar abrir otro ticket en la misma mesa y verificar bloqueo (1 ticket abierto por mesa).
7. [ ] En ticket: agregar platos, subir/bajar cantidades y quitar item; validar total en tiempo real.
8. [ ] Generar **Precuenta** e imprimir (`window.print`) con mesa, fecha/hora, items y total.
9. [ ] Cobrar ticket en método no-efectivo con caja cerrada (permitido con aviso), cerrar ticket y verificar creación de `orders` modalidad `salon` + `order_items`.
10. [ ] Cobrar ticket en efectivo sin caja abierta (bloqueado) y luego con caja abierta (éxito); validar que aparece en Pedidos y pago registrado por flujo normal/Caja.
