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
