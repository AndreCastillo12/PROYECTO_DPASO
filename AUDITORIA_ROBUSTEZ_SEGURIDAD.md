# Auditoría integral del proyecto (robustez, limpieza y seguridad)

Fecha: 2026-02-27
Ámbito revisado:
- `PROYECTO_DPASO/Carta-Dpaso-main/supabase/*.sql`
- `PROYECTO_DPASO/Carta-Dpaso-main/supabase/functions/*`
- `PROYECTO_DPASO/dpaso-admin/src/*`

---

## 1) Inventario técnico auditado

### Tablas detectadas
- `orders`, `order_items`
- `customers`, `customer_password_history`
- `store_settings`, `delivery_zones`
- `cash_sessions`, `cash_movements`, `order_payment_events`
- `restaurant_tables`, `table_tickets`, `table_ticket_items`
- `kitchen_commands`, `kitchen_command_items`
- `admin_panel_user_roles`, `admin_panel_roles_catalog`, `internal_worker_accounts`
- `app_event_logs`

### RPC / funciones SQL relevantes
- Checkout/cliente: `create_order`, `get_order_status`, `get_my_order_status`, `get_my_orders`, `upsert_my_customer_profile`
- Caja/salón: `rpc_register_order_payment`, `rpc_salon_finalize_ticket_payment`, `rpc_cash_summary`, `rpc_sales_report`, `rpc_sales_channel_summary`
- Administración: `rpc_admin_set_user_role`, `rpc_admin_list_users`, `rpc_admin_bootstrap_first_admin`, `rpc_admin_list_workers`, `rpc_admin_register_worker_by_email`, `rpc_admin_list_auth_users`, `rpc_admin_confirm_user_email`
- Observabilidad: `log_app_event`, `rpc_operational_metrics`

### Edge Functions detectadas
- `create_internal_user`
- `admin-users-create`
- `manage_internal_user`
- `create_worker_base_user`
- `send-receipt`

---

## 2) Hallazgos por prioridad

## Alta prioridad

### A1. Inserción pública directa en `orders`/`order_items` (bypass de validaciones del RPC)
**Qué se detectó**
- Existen policies y grants que permiten `INSERT` directo para `anon` y `authenticated` con `with check (true)`.
- Esto abre un camino alternativo a `create_order` y sus validaciones de negocio (zona activa, consistencia de totales, stock, etc.).

**Riesgo**
- Datos inconsistentes (totales/ítems inválidos), spam de pedidos, potencial DoS lógico.
- Se rompe el supuesto de que toda orden entra por flujo transaccional validado.

**Propuesta**
- Eliminar política/grant de inserción pública directa en `orders` y `order_items`.
- Forzar creación vía RPC validado (`create_order`) únicamente.
- Si se requiere inserción pública en algún caso, usar policy con validaciones estrictas (no `true`).

---

### A2. `rpc_admin_bootstrap_first_admin` invocable por cualquier autenticado cuando no hay admins
**Qué se detectó**
- La función está disponible para `authenticated`.
- Si `admin_panel_user_roles` no tiene admins, permite bootstrap usando condición por email/perfil.
- El frontend intenta ejecutar esta RPC automáticamente al validar sesión cuando no detecta rol válido.

**Riesgo**
- Riesgo de carrera/abuso en escenarios de “cero admins”.
- Superficie de escalamiento de privilegios durante incidentes operativos.

**Propuesta**
- Mover bootstrap a operación de break-glass explícita (runbook/manual), no auto-invocada por frontend.
- Añadir control adicional: allowlist estricta por `auth.users.id` (UUID fijos de emergencia), no por dominio de email.
- Registrar auditoría obligatoria del evento (actor, IP/metadatos, timestamp).

---

### A3. Edge Function `admin-users-create` con fallback inseguro de rol y señales de código obsoleto
**Qué se detectó**
- Si no encuentra rol en tabla, usa fallback a metadata y finalmente a `"admin"`.
- Tiene CORS `*` y no valida método distinto a `OPTIONS`.
- No hay referencias activas en frontend a esta función; el flujo actual usa `create_worker_base_user` y `manage_internal_user`.

**Riesgo**
- Si se despliega accidentalmente y se invoca, eleva riesgo de creación de cuentas con privilegios.
- Código muerto/duplicado incrementa superficie de ataque y costo de mantenimiento.

**Propuesta**
- Retirar `admin-users-create` de despliegue (o eliminar archivo).
- Si se conserva temporalmente: quitar fallback `"admin"`, exigir rol desde tabla únicamente, validar método `POST`.

---

### A4. Política de inserción abierta de `app_event_logs` + RPC pública de logging
**Qué se detectó**
- Policy de `insert` para `anon/authenticated` con `with check (true)`.
- `log_app_event` está concedida a `anon` y `authenticated`.

**Riesgo**
- Inundación de logs, costos de almacenamiento, ruido forense.
- Posible ocultamiento de señales reales por spam de telemetría.

**Propuesta**
- Limitar inserción de `anon` (o aplicar rate-limit y validación de tamaño/formato).
- Añadir topes: payload máximo, catálogo permitido de `event_name` y `source`.
- Job de retención/TTL y particionado según volumen.

---

## Media prioridad

### M1. Operaciones no atómicas en `manage_internal_user` (delete)
**Qué se detectó**
- En `delete_user` se borran filas de `admin_panel_user_roles` y `profiles` antes de `auth.admin.deleteUser`.
- No se validan errores intermedios ni existe rollback transaccional multi-sistema.

**Riesgo**
- Estados parciales (usuario auth existente sin perfil/rol, o viceversa según fallos).

**Propuesta**
- Aplicar patrón saga explícito con compensaciones robustas y validación de cada paso.
- Registrar resultado por paso para trazabilidad operativa.

---

### M2. Posible inconsistencia en `create_internal_user` por escritura no verificada en `internal_worker_accounts`
**Qué se detectó**
- Se hace `upsert` a `internal_worker_accounts` sin verificar error de forma explícita.

**Riesgo**
- Usuario creado con rol/perfil pero sin frontera laboral consistente.

**Propuesta**
- Capturar y manejar `workerError` con compensación (eliminar usuario/rol si falla).

---

### M3. Duplicidad de scripts de esquema/migración (deuda técnica y riesgo operativo)
**Qué se detectó**
- Definiciones repetidas entre varios scripts (`orders`, `customers`, `store_settings`, `admin_panel_user_roles`).

**Riesgo**
- Ambigüedad sobre “fuente de verdad”, drift entre entornos y errores de despliegue.

**Propuesta**
- Consolidar baseline + migraciones incrementales estrictas.
- Marcar scripts legacy como archivados/no ejecutables en pipelines.

---

### M4. Endpoint de tracking público expone metadatos de pedido por código corto
**Qué se detectó**
- `get_order_status` es ejecutable por `anon` y devuelve estado/total/fechas con `short_code`.

**Riesgo**
- Enumeración por fuerza bruta de códigos cortos (8 chars) con fuga de información comercial.

**Propuesta**
- Aumentar entropía del token público o combinar con secreto adicional.
- Rate-limit y bloqueo por IP/origen; respuestas uniformes para no filtrar existencia.

---

### M5. Hallazgos frontend de robustez (linter)
**Qué se detectó**
- `eslint` reporta 35 problemas (21 errores, 14 warnings), incluyendo:
  - variables sin uso,
  - llamadas de estado en efectos,
  - hooks con dependencias faltantes,
  - referencias a funciones antes de declararlas.

**Riesgo**
- Bugs de sincronización de UI, renders innecesarios y comportamientos no deterministas.

**Propuesta**
- Plan de hardening de lint por módulos críticos (`Caja`, `Usuarios`, `Tienda`, `ZonasDelivery`, etc.).
- Bloquear merge si hay errores de lint en CI.

---

## Baja prioridad

### B1. CORS amplio (`*`) en Edge Functions administrativas
**Qué se detectó**
- Varias funciones usan `Access-Control-Allow-Origin: *`.

**Riesgo**
- No implica bypass auth por sí solo, pero amplía superficie de abuso desde navegadores/orígenes no esperados.

**Propuesta**
- Restringir orígenes permitidos por entorno.

---

### B2. Código legado no referenciado en frontend actual
**Qué se detectó**
- Flujos actuales invocan `create_worker_base_user` y `manage_internal_user`; no hay referencias a `create_internal_user`/`admin-users-create`.

**Riesgo**
- Mantenimiento innecesario y riesgo de despliegue accidental.

**Propuesta**
- Eliminar o aislar funciones legacy con etiqueta `deprecated` + fecha de retiro.

---

## 3) Eliminaciones seguras recomendadas

1. **Desactivar/eliminar `admin-users-create`** (si no está en uso real).
2. **Eliminar grants/policies de inserción directa pública** en `orders` y `order_items`.
3. **Archivar scripts SQL duplicados legacy** (mantener solo cadena de migraciones activa y ordenada).

---

## 4) Refactorizaciones necesarias

1. **Unificar administración de usuarios internos** en un único flujo Edge + RPC.
2. **Transaccionalidad/saga de operaciones de identidad** (crear, borrar, asignar rol, perfil, worker boundary).
3. **Reforzar bootstrap admin** para modo break-glass manual y auditado.
4. **Ajustar observabilidad** con límites de ingesta y retención.

---

## 5) Automatizaciones útiles

1. **CI de seguridad SQL**
   - regla: prohibir `with check (true)` en tablas sensibles,
   - regla: detectar grants a `anon` en funciones administrativas.
2. **CI de higiene de migraciones**
   - detectar duplicados de `create table/create function` en scripts históricos sin versionado formal.
3. **CI frontend**
   - `npm run lint` como gate de merge.
4. **Auditoría periódica de roles**
   - job que valide cuentas admin efectivas vs catálogo esperado.

---

## 6) Validaciones críticas faltantes (resumen)

- Bloqueo de inserción directa pública en entidades transaccionales (`orders`, `order_items`).
- Control de bootstrap admin no automático y con allowlist estricta.
- Verificación de errores/compensación completa en Edge de gestión de usuarios.
- Límites de ingesta y rate-limit para logging público.
- Hardening de hooks/efectos en frontend detectado por lint.

---

## 7) Conclusión ejecutiva

El proyecto muestra una base funcional sólida en validaciones de `create_order` y uso de `SECURITY DEFINER` con `search_path` controlado. Sin embargo, la robustez y seguridad operacional se ven afectadas por: (1) rutas públicas de inserción directa que eluden validaciones críticas, (2) bootstrap admin con superficie de riesgo en escenarios de recuperación, (3) funciones Edge duplicadas/legacy, y (4) deuda técnica frontend reportada por lint. La prioridad inmediata debe centrarse en cerrar rutas de bypass y reducir vectores de escalamiento de privilegios.
