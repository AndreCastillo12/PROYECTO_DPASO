# dpaso-admin

## Requisito para crear usuarios internos

La pantalla **Usuarios internos > Crear usuario interno** usa la Edge Function `create_internal_user`.
No alcanza con ejecutar solo SQL: además debes desplegar la función y tener variables de entorno correctas.

### 1) Ejecutar migración SQL
Aplica la migración:

- `PROYECTO_DPASO/Carta-Dpaso-main/supabase/sprint41_security_roles_hotfix.sql`

Esto crea/actualiza:
- funciones de rol seguras (`get_admin_panel_role`, `is_admin_user`, `is_role_*`)
- RPCs de usuarios internos (`rpc_admin_list_users`, `rpc_admin_set_user_role`)
- hardening RLS

### 2) Desplegar Edge Function
Desde `Carta-Dpaso-main`:

```bash
supabase functions deploy create_internal_user
```

### 3) Verificar variables de entorno en Supabase (Edge Functions)
Configura en el proyecto:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Si falta deploy o hay variables mal configuradas, en UI verás un error como:
`Failed to send a request to the Edge Function`.

### 4) Cliente admin (frontend)
Asegúrate de tener en `.env` del panel admin:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Sin eso, el panel no podrá invocar RPCs/functions.
