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
- `DPASO_SERVICE_ROLE_KEY`

Si falta deploy o hay variables mal configuradas, en UI verás errores de conexión a Edge Function.

### 4) Cliente admin (frontend)
Asegúrate de tener en `.env` del panel admin:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Sin eso, el panel no podrá invocar RPCs/functions.


### 4.1) Reiniciar dev server al cambiar `.env`
Si cambias `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY`, debes reiniciar `npm run dev`.
Vite no siempre recarga variables ya inyectadas en caliente para llamadas a Edge Functions.

### 4.2) Prueba rápida Edge Functions (local y producción)
1. Inicia sesión en el panel admin con una cuenta `admin/superadmin`.
2. Abre DevTools -> Network y ejecuta una acción en **Usuarios internos** (crear/reset/disable/delete).
3. Verifica que el request `POST /functions/v1/<function_name>` salga con headers:
   - `Authorization: Bearer <access_token>`
   - `apikey: <VITE_SUPABASE_ANON_KEY>`
   - `Content-Type: application/json`
4. Verifica `OPTIONS` = 200 y luego `POST` sin 401.

Entornos esperados:
- Local: `http://localhost:5173`
- Producción: `https://admin.dpasococinalibre.com`

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
