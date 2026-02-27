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

function createEphemeralClient() {
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
  const [currentUserId, setCurrentUserId] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleDraftByUser, setRoleDraftByUser] = useState({});

  const loadUsers = async () => {
    setLoading(true);

    const { data: currentAuth } = await supabase.auth.getUser();
    const myUserId = currentAuth?.user?.id || null;
    setCurrentUserId(myUserId);

    const workers = await supabase.rpc("rpc_admin_list_workers");
    if (workers.error) {
      showToast(errMsg(workers.error, "No se pudo cargar usuarios trabajadores (corrige sprint48/rpc_admin_list_workers)"), "error");
      setUsers([]);
      setLoading(false);
      return;
    }

    setUsers(workers.data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const managedUsers = useMemo(() => users.filter((u) => u.user_id !== currentUserId), [users, currentUserId]);

  const confirmOperatorPassword = async (actionLabel) => {
    const entered = window.prompt(`Para ${actionLabel}, ingresa tu contraseña de administrador:`, "");
    if (!entered) return false;

    const { data: authData } = await supabase.auth.getUser();
    const currentEmail = authData?.user?.email;
    if (!currentEmail) {
      showToast("Sesión inválida. Vuelve a iniciar sesión.", "error");
      return false;
    }

    const verifier = createEphemeralClient();
    const { error } = await verifier.auth.signInWithPassword({ email: currentEmail, password: entered });
    if (error) {
      showToast("Contraseña incorrecta. Acción cancelada.", "error");
      return false;
    }

    await verifier.auth.signOut();
    return true;
  };

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

    if (!(await confirmOperatorPassword("crear usuario"))) return;

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create_worker_base_user", {
      body: { email: normalizedEmail, password },
    });

    if (error || data?.ok !== true) {
      const message = await getInvokeError(error, "No se pudo crear usuario trabajador");
      showToast(`${message} Verifica deploy de Edge Function create_worker_base_user.`, "error");
      setBusy(false);
      return;
    }

    setEmail("");
    setPassword("");
    await loadUsers();
    showToast("Usuario creado", "success");
    setBusy(false);
  };

  const saveRole = async (user) => {
    const nextRole = String(roleDraftByUser[user.user_id] || user.role || "cocina").trim().toLowerCase();
    if (!ROLES.includes(nextRole)) {
      showToast("Selecciona un rol válido", "warning");
      return;
    }

    if (!(await confirmOperatorPassword("editar rol"))) return;

    setBusy(true);
    await supabase.rpc("rpc_admin_register_worker_by_email", { p_email: user.email });
    const { error } = await supabase.rpc("rpc_admin_set_user_role", {
      p_user_id: user.user_id,
      p_role: nextRole,
    });

    if (error) {
      showToast(errMsg(error, `No se pudo guardar rol de ${user.email}`), "error");
      setBusy(false);
      return;
    }

    await loadUsers();
    showToast("Rol guardado", "success");
    setBusy(false);
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
      const message = await getInvokeError(error, "No se pudo restablecer contraseña");
      showToast(`${message} Alternativa: Supabase Auth > Users > Reset password.`, "error");
      setBusy(false);
      return;
    }

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
      const message = await getInvokeError(error, enabled ? "No se pudo habilitar" : "No se pudo deshabilitar");
      showToast(message, "error");
      setBusy(false);
      return;
    }

    await loadUsers();
    setBusy(false);
    showToast(enabled ? "Usuario habilitado" : "Usuario deshabilitado", "success");
  };

  const deleteUser = async (userId, userEmail) => {
    if (currentRole !== "admin") return;
    if (!(await confirmOperatorPassword("eliminar usuario"))) return;
    if (!window.confirm(`Eliminar cuenta completa ${userEmail}?`)) return;

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("manage_internal_user", {
      body: { action: "delete_user", user_id: userId },
    });

    if (error || data?.ok !== true) {
      const message = await getInvokeError(error, "No se pudo eliminar cuenta completa");
      showToast(message, "error");
      setBusy(false);
      return;
    }

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

      <section style={card}>
        <h3 style={{ margin: 0 }}>Roles y usuario (CRUD)</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo trabajador" />
          <input style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" type="password" />
          <button type="button" style={btnPrimary} disabled={busy || currentRole !== "admin"} onClick={createBaseUser}>Crear usuario</button>
        </div>

        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {managedUsers.length === 0 ? <p style={{ color: "#6b7280" }}>No hay usuarios trabajadores registrados.</p> : managedUsers.map((u) => (
            <div key={u.user_id} style={rowStyle}>
              <div>
                <strong>{u.nombre ? `${u.nombre} ${u.apellidos || ""}`.trim() : u.email}</strong>
                <small style={{ display: "block", color: "#6b7280" }}>{u.email} · rol: {u.role || "sin rol"} · {u.email_confirmed ? "email verificado" : "sin verificar"} · {u.is_disabled ? "deshabilitado" : "habilitado"}</small>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  style={{ ...inputStyle, minWidth: 120, padding: "6px 8px" }}
                  value={roleDraftByUser[u.user_id] || u.role || "cocina"}
                  onChange={(e) => setRoleDraftByUser((prev) => ({ ...prev, [u.user_id]: e.target.value }))}
                  disabled={busy || currentRole !== "admin"}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button type="button" style={btnGhost} disabled={busy || currentRole !== "admin"} onClick={() => saveRole(u)}>Guardar rol</button>
                {u.is_disabled ? (
                  <button type="button" style={btnGhost} disabled={busy || currentRole !== "admin"} onClick={() => setUserEnabled(u.user_id, u.email, true)}>Activar</button>
                ) : (
                  <button type="button" style={btnGhost} disabled={busy || currentRole !== "admin"} onClick={() => setUserEnabled(u.user_id, u.email, false)}>Desactivar</button>
                )}
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
