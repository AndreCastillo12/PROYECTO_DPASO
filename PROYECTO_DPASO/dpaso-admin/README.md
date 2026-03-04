# dpaso-admin

## Requisito para crear y gestionar usuarios internos

La pantalla **Usuarios internos** usa Edge Functions y RPCs.
No alcanza con ejecutar solo SQL: además debes desplegar funciones y tener variables de entorno correctas.

### 1) Ejecutar migraciones SQL
Aplica migraciones:

- `PROYECTO_DPASO/Carta-Dpaso-main/supabase/sprint41_security_roles_hotfix.sql`
- `PROYECTO_DPASO/Carta-Dpaso-main/supabase/sprint42_internal_users_management_and_kitchen_sync.sql`
- `PROYECTO_DPASO/Carta-Dpaso-main/supabase/sprint43_internal_user_actions_and_kitchen_compat_fix.sql`
- `PROYECTO_DPASO/Carta-Dpaso-main/supabase/sprint44_roles_bootstrap_and_ui_cleanup.sql`
- `PROYECTO_DPASO/Carta-Dpaso-main/supabase/sprint45_admin_auth_users_listing_and_email_confirm.sql`
- `PROYECTO_DPASO/Carta-Dpaso-main/supabase/sprint46_admin_recovery_if_no_admin_role.sql`
- `PROYECTO_DPASO/Carta-Dpaso-main/supabase/sprint47_seed_internal_roles_catalog.sql`
- `PROYECTO_DPASO/Carta-Dpaso-main/supabase/sprint48_worker_accounts_boundary.sql`

Esto crea/actualiza:
- funciones de rol seguras (`get_admin_panel_role`, `is_admin_user`, `is_role_*`)
- RPCs de usuarios internos (`rpc_admin_list_users`, `rpc_admin_set_user_role`, `rpc_admin_bootstrap_first_admin`)
- hardening RLS
- sync robusto de pedidos web hacia cocina

### 2) Desplegar Edge Functions de administración
Desde `Carta-Dpaso-main`:

```bash
supabase functions deploy create_internal_user
supabase functions deploy create_worker_base_user
supabase functions deploy manage_internal_user
```

Opcional legacy:

```bash
supabase functions deploy admin-users-create
```

### 3) Verificar variables de entorno en Supabase (Edge Functions > Secrets)
Configura en el proyecto:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Si falta deploy o hay variables mal configuradas, en UI verás errores de conexión a Edge Function.

### 4) Cliente admin (frontend)
Asegúrate de tener en `.env` del panel admin:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Sin eso, el panel no podrá invocar RPCs/functions.

### 5) Nota sobre `email rate limit exceeded`
Si ves `email rate limit exceeded`, Supabase está limitando altas consecutivas del mismo origen.

Qué hacer:
- esperar unos minutos y reintentar,
- probar con otro correo,
- en producción usar `create_internal_user` / `manage_internal_user` desplegadas (requiere tener deploy de functions de administración).


## Si falla reset/eliminación de usuario
Esas acciones necesitan la Edge Function `manage_internal_user` desplegada y con secrets correctos.
Si no está desplegada, verás error de conexión a Edge Function.

## Modo degradado sin Edge Functions de admin
Si `create_internal_user`/`manage_internal_user` no están desplegadas:
- Crear usuario interno: el panel intentará asignar rol solo a un usuario que **ya exista** en Auth (por email).
- Eliminar cuenta completa: si falla Edge Function, no se podrá borrar Auth automáticamente.
- Restablecer contraseña: debes hacerlo desde Supabase Dashboard > Auth > Users.


## Gestión en panel Usuarios (admin)
- El admin no se muestra a sí mismo en la lista de gestión.
- Acciones disponibles para otros usuarios internos: cambiar rol, restablecer contraseña, deshabilitar/habilitar y eliminar cuenta completa.
- Estas acciones requieren `manage_internal_user` desplegada (excepto cambios por RPC ya existentes como rol).

## Producción (Vercel + Auth)

### Evitar 404 al refrescar rutas (`/login`, `/reset-password`, etc.)
Este panel usa `react-router` con `createBrowserRouter`, por lo que en Vercel se requiere rewrite global a `index.html`.

Ya se incluye `vercel.json` con:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Sin ese rewrite, al hacer F5 en rutas internas Vercel responde `404: NOT_FOUND`.

### Reset password en dominio admin
Configura en el frontend:

- `VITE_AUTH_RESET_REDIRECT_URL=https://admin.dpasococinalibre.com/reset-password`

Y en Supabase Auth -> URL Configuration agrega esa URL a **Redirect URLs** permitidas.

### Correo de recuperación con branding propio (no "powered by Supabase")
Si llega correo genérico de Supabase, hay que configurarlo en Supabase Dashboard:

1. **Auth -> Templates**: personalizar asunto/cuerpo para recovery/confirmación.
2. **Auth -> SMTP Settings**: configurar proveedor SMTP propio + remitente de tu dominio.

Esto no se controla desde el frontend.

## Checklist de configuración Auth (Supabase + Vercel)

### 1) URLs de Auth en Supabase (obligatorio)
En **Supabase Dashboard -> Authentication -> URL Configuration**:

- **Site URL**
  - `https://admin.dpasococinalibre.com`
- **Redirect URLs**
  - `https://admin.dpasococinalibre.com`
  - `https://admin.dpasococinalibre.com/reset-password`
  - `https://dpasococinalibre.com/reset-password`

> Si falta alguna URL, el flujo de recovery puede abrir pantalla pero fallar al actualizar contraseña por sesión inválida o intercambio incompleto.

### 2) Variables del frontend admin
En Vercel (proyecto admin) define:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_AUTH_RESET_REDIRECT_URL=https://admin.dpasococinalibre.com/reset-password`

### 3) Recovery flow correcto
El frontend de reset debe aceptar cualquiera de estos formatos del enlace de Supabase:

- `?code=...` -> usar `exchangeCodeForSession(code)`.
- `?token_hash=...&type=recovery` -> usar `verifyOtp(...)`.
- `#access_token=...&refresh_token=...` (legacy) -> usar `setSession(...)`.

Luego validar `getSession()` antes de `updateUser({ password })`.

### 4) Vercel SPA rewrite (admin)
Mantener `dpaso-admin/vercel.json` con rewrite global a `index.html` para evitar 404 al refrescar:

- `/login`
- `/reset-password`
- rutas internas del panel

### 5) Plantillas premium de Auth (Supabase)
Archivos listos para copiar/pegar en Supabase:

- Confirm signup: `dpaso-admin/docs/auth-email-templates/confirm-signup.html`
- Reset password: `dpaso-admin/docs/auth-email-templates/reset-password.html`

En **Authentication -> Templates** pega cada HTML en su template correspondiente.

### 6) SMTP branding propio
En **Authentication -> SMTP Settings** ya debes mantener:

- Remitente: `DPASO <no-reply@dpasococinalibre.com>`
- Proveedor SMTP propio (Resend)

Así dejas de enviar correos con branding genérico de Supabase.

## MVP Emisión SIMULADA de Comprobantes (Boleta/Factura) desde Panel Admin

### 1) SQL a ejecutar (orden exacto)

En **Supabase Dashboard -> SQL Editor** ejecuta:

1. `PROYECTO_DPASO/Carta-Dpaso-main/supabase/sprint_caja_reportes.sql` (si aún no existe `is_admin_user`).
2. `PROYECTO_DPASO/Carta-Dpaso-main/supabase/sprint52_sunat_einvoice_foundation.sql`.

> Si tu proyecto ya tiene `is_admin_user`, puedes ejecutar directamente `sprint52`.

### 2) Deploy de Edge Function `issue-invoice`

Desde `PROYECTO_DPASO/Carta-Dpaso-main`:

```bash
supabase functions deploy issue-invoice
```

Si no has linkeado el proyecto:

```bash
supabase link --project-ref <TU_PROJECT_REF>
supabase functions deploy issue-invoice
```

### 3) Secrets en Supabase (nombres exactos)

Ir a **Supabase Dashboard -> Edge Functions -> Secrets** y crear:

Obligatorios:
- `SUPABASE_URL` -> lo obtienes en **Project Settings -> API -> Project URL**.
- `SUPABASE_ANON_KEY` -> **Project Settings -> API -> anon public key**.
- `SUPABASE_SERVICE_ROLE_KEY` -> **Project Settings -> API -> service_role key**.
- `INTERNAL_WEBHOOK_SECRET` -> valor aleatorio fuerte (ej. generado con `openssl rand -hex 32`).

Provider simulado (defaults recomendados):
- `INVOICE_PROVIDER_NAME=stub`
- `INVOICE_PROVIDER_MODE=sandbox`
- `INVOICE_PROVIDER_API_URL=` (vacío para modo stub)
- `INVOICE_PROVIDER_TOKEN=` (vacío para modo stub)

> En MVP simulado, `stub + sandbox` genera serie/correlativo/hash/qr/ticket sin SUNAT real.
>
> Checklist mínimo de secrets (stub/sandbox):
> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_WEBHOOK_SECRET`, `INVOICE_PROVIDER_NAME=stub`, `INVOICE_PROVIDER_MODE=sandbox`.

### 4) Variables frontend admin

En Vercel (proyecto admin):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### 5) Prueba manual en PANEL ADMIN (Order Detail)

> Para emitir desde local debes estar logueado con usuario **admin** del panel.
> El módulo usa `supabase.functions.invoke("issue-invoice")` (no fetch manual) para enviar Authorization + apikey automáticamente.

1. Abrir detalle de pedido.
2. Completar módulo **Comprobante**:
   - Tipo documento (`boleta` / `factura`)
   - Tipo doc cliente
   - Número doc
   - Nombre
3. Click **Encolar** (opcional).
4. Click **Emitir**.
5. Validar campos resultado:
   - `sunat_status`
   - `series`
   - `correlativo`
   - `full_number`
   - `hash`
   - `qr_text`
6. Probar **Ver ticket** (modal HTML) y **Descargar PDF**.
7. Si falla, usar **Reintentar** (envía `force_retry=true`).

Troubleshooting 401:
- Cierra sesión y vuelve a iniciar sesión en el panel admin.
- Verifica que `VITE_SUPABASE_URL` del frontend apunta al **mismo proyecto Supabase** donde desplegaste `issue-invoice`.
- El flujo usa `supabase.functions.invoke("issue-invoice")` con `Authorization` + `apikey` explícitos.

### 6) Prueba con curl (admin JWT)

Primero obtén `access_token` de un usuario admin autenticado en el panel.

```bash
curl -i -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/issue-invoice" \
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "<ORDER_UUID>",
    "document_type": "boleta",
    "customer_doc_type": "DNI",
    "customer_doc_number": "12345678",
    "customer_name": "CLIENTE PRUEBA",
    "idempotency_key": "manual-test-001",
    "force_retry": false
  }'
```

### 7) Prueba con curl (sistema interno)

```bash
curl -i -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/issue-invoice" \
  -H "x-internal-secret: <INTERNAL_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "<ORDER_UUID>",
    "document_type": "factura",
    "customer_doc_type": "RUC",
    "customer_doc_number": "20100070970",
    "customer_name": "EMPRESA DEMO SAC",
    "idempotency_key": "system-test-001",
    "force_retry": true
  }'
```

### 8) Errores esperados (MVP)

- `401 UNAUTHORIZED`: token vencido/no enviado.
- `403 FORBIDDEN`: usuario no admin.
- `400 FACTURA_REQUIRES_VALID_RUC`: para factura sin RUC válido.
- `500 CORRELATIVE_ASSIGN_FAILED`: series no configuradas en `sunat_document_series`.
