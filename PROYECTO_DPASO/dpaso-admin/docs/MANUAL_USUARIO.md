# Manual de Usuario - DPASO Admin

## 1) Objetivo del sistema
DPASO Admin permite gestionar la operación interna del restaurante: pedidos, clientes, caja, cocina, productos, categorías, reportes y configuración de tienda.

---

## 2) Acceso al sistema
1. Abre la URL del panel admin.
2. Ingresa **correo** y **contraseña**.
3. Presiona **Iniciar sesión**.
4. Si olvidaste la contraseña, usa **¿Olvidaste tu contraseña?**.

### Personalizar logo del login
En la parte superior del login ahora puedes:
- **Cambiar logo**: subir imagen del local (`.png`, `.jpg`, `.webp`, `.svg`).
- **Restablecer**: volver al logo por defecto.

> Nota: el logo se guarda en el navegador actual (localStorage), por lo que si cambias de equipo/navegador deberás cargarlo de nuevo.

---

## 3) Módulos principales

## Dashboard
Resumen operativo con métricas rápidas.

## Pedidos
- Visualización de pedidos.
- Seguimiento de estado.
- Gestión de detalle por pedido.

## Cocina
- Vista operativa para preparación.
- Flujo de avance por estado.

## Caja
- Control de movimientos básicos.
- Validación de montos según operación.

## Clientes
- Búsqueda y administración de clientes.
- Soporte para contexto comercial y seguimiento.

## Platos / Categorías
- Alta, edición y baja de productos y categorías.
- Ajustes visuales y operativos del catálogo.

## Tienda / Zonas Delivery
- Configuración operativa del negocio y cobertura.

## Reportes
- Consulta de datos históricos y soporte de decisiones.

---

## 4) Gestión de usuarios y roles (estado actual)
Actualmente el sistema funciona bien en general, pero el flujo de **usuarios con roles** puede requerir validaciones adicionales en backend (Edge Functions + RPC + tabla de roles).

### Flujo esperado
1. Crear usuario base trabajador.
2. Registrar trabajador por email (si aplica a tu flujo).
3. Asignar rol (`admin`, `cajero`, `mozo`, `cocina`).
4. Probar inicio de sesión con el usuario.

### Validaciones recomendadas para incidencias
1. Confirmar que el usuario exista en `auth.users`.
2. Confirmar fila en `admin_panel_user_roles` con rol correcto.
3. Confirmar despliegue de Edge Functions usadas por admin:
   - `create_worker_base_user`
   - `manage_internal_user`
4. Confirmar variables de entorno en Functions:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Confirmar que el operador que ejecuta acciones sensibles sea rol `admin`.

### Workaround operativo temporal
Si falla la asignación/gestión desde el panel:
- Crear o ajustar el usuario desde **Supabase Auth**.
- Corregir rol en tabla `admin_panel_user_roles`.
- Reintentar acceso en el panel.

---

## 5) Buenas prácticas
- Usar correos corporativos para cuentas internas.
- No compartir contraseñas entre roles.
- Mantener sólo los usuarios activos necesarios.
- Revisar reportes y caja diariamente.

---

## 6) Soporte básico
Ante errores:
1. Capturar pantalla del mensaje.
2. Indicar módulo, hora y usuario afectado.
3. Verificar conexión a Supabase y despliegue de Functions.
4. Escalar con evidencia para revisión técnica.

---

## 7) Checklist de operación diaria
- [ ] Login correcto de responsables.
- [ ] Pedidos y cocina sincronizados.
- [ ] Caja validada.
- [ ] Catálogo actualizado (si hubo cambios).
- [ ] Reporte de cierre revisado.
