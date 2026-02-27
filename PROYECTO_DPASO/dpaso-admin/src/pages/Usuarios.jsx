import { useEffect, useMemo, useState } from "react";
import { FunctionsHttpError, createClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import useAdminRole from "../hooks/useAdminRole";

const ROLES = ["admin", "cajero", "mozo", "cocina"];

function errMsg(error, fallback) {
  const msg = String(error?.message || "").trim();
  return msg ? `${fallback}: ${msg}` : fallback;
}

async function getInvokeError(error, fallback) {
  if (!error) return fallback;

  const rawMessage = String(error?.message || "").toLowerCase();
  if (rawMessage.includes("failed to send a request to the edge function")) {
    return `${fallback}: no se pudo conectar con Edge Function.`;
  }
  if (rawMessage.includes("email rate limit exceeded")) {
    return `${fallback}: email rate limit exceeded.`;
  }

  if (error instanceof FunctionsHttpError) {
    const response = error.context;
    const status = response?.status || "unknown";
    let body = "";
    try {
      body = JSON.stringify(await response.json());
    } catch {
      body = await response.text();
    }
    return `${fallback} (status ${status})${body ? `: ${body}` : ""}`;
  }

  return errMsg(error, fallback);
}

function buildFunctionsOfflineMessage(baseError) {
  const normalized = String(baseError || "").toLowerCase();
  const shouldAttachDetail = baseError && !normalized.includes("no se pudo conectar con edge function");
  const extra = shouldAttachDetail ? ` Detalle: ${baseError}` : "";
  return `No se pudo crear usuario interno: no se pudo conectar con la Edge Function. Verifica deploy y secrets del proyecto. Si el usuario ya existe en Auth, usa su email para asignarle rol; si no existe, crea primero en Supabase Auth > Users.${extra}`;
}

function createSignupClient() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export default function Usuarios() {
  const { canAccess, role: currentRole } = useAdminRole();
  const { toast, showToast } = useToast(4200);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState([]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState("cocina");

  const [functionsAvailable, setFunctionsAvailable] = useState(true);

  const loadUsers = async () => {
    setLoading(true);

    const allUsers = await supabase.rpc("rpc_admin_list_auth_users");
    if (!allUsers.error) {
      setUsers(allUsers.data || []);
      setLoading(false);
      return;
    }

    const rolesOnly = await supabase.rpc("rpc_admin_list_users");
    if (rolesOnly.error) {
      showToast(errMsg(rolesOnly.error, "No se pudo cargar usuarios"), "error");
      setUsers([]);
      setLoading(false);
      return;
    }

    setUsers((rolesOnly.data || []).map((row) => ({ ...row, is_disabled: false, email_confirmed: true })));
    setLoading(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers();
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  const managedUsers = useMemo(() => users, [users]);

  const createBaseUser = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      showToast("Completa email", "warning");
      return;
    }
    if (!password || password.length < 6) {
      showToast("La contraseña debe tener al menos 6 caracteres", "warning");
      return;
    }

    setBusy(true);
    const signupClient = createSignupClient();
    const { error } = await signupClient.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          source: "admin_panel",
          internal_role: "none",
        },
      },
    });

    if (error) {
      showToast(errMsg(error, "No se pudo crear usuario base en Auth"), "error");
      setBusy(false);
      return;
    }

    await supabase.rpc("rpc_admin_confirm_user_email", { p_email: normalizedEmail });

    setEmail("");
    setPassword("");
    setFunctionsAvailable(false);
    await loadUsers();
    showToast("Usuario base creado en Auth con email verificado. Ahora puedes asignarle rol.", "success");
    setBusy(false);
  };

  const assignRoleByEmail = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      showToast("Completa email para asignar rol", "warning");
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc("rpc_admin_set_user_role_by_email", {
      p_email: normalizedEmail,
      p_role: newRole,
    });

    if (error) {
      setFunctionsAvailable(false);
      showToast(errMsg(error, "No se pudo asignar rol interno por email"), "error");
      setBusy(false);
      return;
    }

    setEmail("");
    setNewRole("cocina");
    await loadUsers();
    setFunctionsAvailable(false);
    showToast("Rol asignado correctamente", "success");
    setBusy(false);
  };

  const createInternalUserWithFunctions = async () => {
    const payload = { email: email.trim(), password: password.trim(), role: newRole };
    if (!payload.email || !payload.password) {
      showToast("Completa email y contraseña para creación completa", "warning");
      return;
    }

    setBusy(true);

    const primary = await supabase.functions.invoke("create_internal_user", { body: payload });
    if (!primary.error && primary.data?.ok === true) {
      setFunctionsAvailable(true);
      setEmail("");
      setPassword("");
      setNewRole("cocina");
      await loadUsers();
      setBusy(false);
      showToast("Usuario interno creado", "success");
      return;
    }

    const legacy = await supabase.functions.invoke("admin-users-create", { body: payload });
    if (!legacy.error && legacy.data?.ok === true) {
      setFunctionsAvailable(true);
      setEmail("");
      setPassword("");
      setNewRole("cocina");
      await loadUsers();
      setBusy(false);
      showToast("Usuario interno creado (legacy)", "success");
      return;
    }

    const invokeError = await getInvokeError(primary.error || legacy.error, "No se pudo crear usuario interno");
    setFunctionsAvailable(false);
    showToast(buildFunctionsOfflineMessage(invokeError), "error");
    setBusy(false);
  };

  const changeRole = async (userId, current, userEmail) => {
    if (currentRole !== "admin") return;
    const next = window.prompt(`Nuevo rol para ${userEmail} (admin/cajero/mozo/cocina):`, current || "cocina");
    if (!next) return;
    const normalized = String(next).trim().toLowerCase();
    if (!ROLES.includes(normalized)) {
      showToast("Rol inválido", "warning");
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc("rpc_admin_set_user_role", {
      p_user_id: userId,
      p_role: normalized,
    });

    if (error) {
      showToast(errMsg(error, `No se pudo actualizar rol de ${userEmail}`), "error");
      setBusy(false);
      return;
    }

    await loadUsers();
    setBusy(false);
    showToast("Rol actualizado", "success");
  };

  const resetPassword = async (userId, userEmail) => {
    if (currentRole !== "admin") return;
    const nextPassword = window.prompt(`Nueva contraseña para ${userEmail} (mín 6):`, "");
    if (!nextPassword || nextPassword.length < 6) return;

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("manage_internal_user", {
      body: { action: "reset_password", user_id: userId, new_password: nextPassword },
    });

    if (error || data?.ok !== true) {
      setFunctionsAvailable(false);
      const message = await getInvokeError(error, "No se pudo restablecer contraseña");
      showToast(`${message} Alternativa: Supabase Auth > Users > Reset password.`, "error");
      setBusy(false);
      return;
    }

    setFunctionsAvailable(true);
    setBusy(false);
    showToast("Contraseña actualizada", "success");
  };

  const setUserEnabled = async (userId, userEmail, enabled) => {
    if (currentRole !== "admin") return;
    if (!window.confirm(`${enabled ? "Habilitar" : "Deshabilitar"} ${userEmail}?`)) return;

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("manage_internal_user", {
      body: { action: enabled ? "enable_user" : "disable_user", user_id: userId },
    });

    if (error || data?.ok !== true) {
      setFunctionsAvailable(false);
      const message = await getInvokeError(error, enabled ? "No se pudo habilitar" : "No se pudo deshabilitar");
      showToast(message, "error");
      setBusy(false);
      return;
    }

    setFunctionsAvailable(true);
    setBusy(false);
    showToast(enabled ? "Usuario habilitado" : "Usuario deshabilitado", "success");
  };

  const deleteUser = async (userId, userEmail) => {
    if (currentRole !== "admin") return;
    if (!window.confirm(`Eliminar cuenta completa ${userEmail}?`)) return;

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("manage_internal_user", {
      body: { action: "delete_user", user_id: userId },
    });

    if (error || data?.ok !== true) {
      setFunctionsAvailable(false);
      const message = await getInvokeError(error, "No se pudo eliminar cuenta completa");
      showToast(message, "error");
      setBusy(false);
      return;
    }

    setFunctionsAvailable(true);
    await loadUsers();
    setBusy(false);
    showToast("Cuenta eliminada", "success");
  };

  if (!canAccess("usuarios")) return <p>No tienes permisos para Roles y usuario.</p>;
  if (loading) return <p>Cargando lista de usuarios...</p>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Roles y usuario</h2>

      {!functionsAvailable ? (
        <p style={{ margin: 0, padding: 10, borderRadius: 8, background: "#fff7ed", color: "#9a3412" }}>
          Edge Functions de admin no disponibles. Flujo recomendado: 1) crea usuario base en Auth con email+clave, 2) asigna rol por email aquí.
        </p>
      ) : null}

      <section style={card}>
        <h3 style={{ margin: 0 }}>Roles y usuario (CRUD)</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo trabajador" />
          <input style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña para crear usuario base" type="password" />
          <select style={{ ...inputStyle, minWidth: 140 }} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button type="button" style={btnPrimary} disabled={busy || currentRole !== "admin"} onClick={createBaseUser}>Crear usuario base</button>
          <button type="button" style={btnGhost} disabled={busy || currentRole !== "admin"} onClick={assignRoleByEmail}>Asignar rol por email</button>
          <button type="button" style={btnGhost} disabled={busy || currentRole !== "admin"} onClick={createInternalUserWithFunctions}>Crear completo (Edge)</button>
        </div>

        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {managedUsers.length === 0 ? <p style={{ color: "#6b7280" }}>No hay usuarios creados.</p> : managedUsers.map((u) => (
            <div key={u.user_id} style={rowStyle}>
              <div>
                <strong>{u.nombre ? `${u.nombre} ${u.apellidos || ""}`.trim() : u.email}</strong>
                <small style={{ display: "block", color: "#6b7280" }}>{u.email} · rol: {u.role || "sin rol"} · {u.email_confirmed ? "email verificado" : "sin verificar"} · {u.is_disabled ? "deshabilitado" : "habilitado"}</small>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={btnGhost} disabled={busy || currentRole !== "admin"} onClick={() => changeRole(u.user_id, u.role, u.email)}>{u.role ? "Editar rol" : "Asignar rol"}</button>
                <button type="button" style={btnGhost} disabled={busy || currentRole !== "admin"} onClick={() => setUserEnabled(u.user_id, u.email, false)}>Desactivar</button>
                <button type="button" style={btnGhost} disabled={busy || currentRole !== "admin"} onClick={() => setUserEnabled(u.user_id, u.email, true)}>Activar</button>
                <button type="button" style={btnGhost} disabled={busy || currentRole !== "admin"} onClick={() => resetPassword(u.user_id, u.email)}>Clave</button>
                <button type="button" style={btnDangerGhost} disabled={busy || currentRole !== "admin"} onClick={() => deleteUser(u.user_id, u.email)}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const card = { background: "#fff", borderRadius: 12, padding: 12 };
const rowStyle = { display: "flex", justifyContent: "space-between", gap: 8, border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", alignItems: "center" };
const inputStyle = { border: "1px solid #dce7e2", borderRadius: 8, padding: "9px 10px", fontSize: 14 };
const btnPrimary = { background: "#2fa67f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 12px", cursor: "pointer" };
const btnGhost = { background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 8px", cursor: "pointer" };
const btnDangerGhost = { background: "#fff", color: "#b3261e", border: "1px solid #f1b7b3", borderRadius: 8, padding: "6px 8px", cursor: "pointer" };
