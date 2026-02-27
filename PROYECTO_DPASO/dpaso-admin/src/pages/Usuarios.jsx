import { useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
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

  const rawMessage = String(error?.message || "");
  if (rawMessage.toLowerCase().includes("email rate limit exceeded")) {
    return `${fallback}: email rate limit exceeded. Espera unos minutos o usa otro correo temporal.`;
  }

  if (rawMessage.toLowerCase().includes("failed to send a request to the edge function")) {
    return `${fallback}: no se pudo conectar con la Edge Function. Verifica deploy y secrets del proyecto.`;
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


async function assignRoleToExistingAuthUser(p_email, p_role) {
  const { data, error } = await supabase.rpc("rpc_admin_set_user_role_by_email", {
    p_email,
    p_role,
  });
  return { data, error };
}

export default function Usuarios() {
  const { canAccess, role: currentRole } = useAdminRole();
  const { toast, showToast } = useToast(4800);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState("cocina");

  const loadUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("rpc_admin_list_users");
    if (error) {
      showToast(errMsg(error, "No se pudo cargar usuarios internos"), "error");
      setUsers([]);
      setLoading(false);
      return;
    }
    setUsers(data || []);
    setLoading(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers();
    }, 0);

    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data?.user?.id || null);
    });

    return () => clearTimeout(timer);
  }, []);

  const saveRole = async (userId, userEmail, nextRole) => {
    if (currentRole !== "admin") return;
    setBusy(true);
    const { error } = await supabase.rpc("rpc_admin_set_user_role", {
      p_user_id: userId,
      p_role: nextRole,
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

    const nextPassword = window.prompt(`Nueva contraseña para ${userEmail} (mín 6 caracteres):`, "");
    if (!nextPassword) return;
    if (nextPassword.length < 6) {
      showToast("La contraseña debe tener mínimo 6 caracteres", "warning");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("manage_internal_user", {
      body: { action: "reset_password", user_id: userId, new_password: nextPassword },
    });

    if (error || data?.ok !== true) {
      const isConn = String(error?.message || "").toLowerCase().includes("failed to send a request to the edge function");
      const message = await getInvokeError(error, "No se pudo restablecer contraseña");
      showToast(
        isConn
          ? `${message}. Alternativa: cambia contraseña desde Supabase Auth > Users.`
          : (data?.error ? `${message}: ${data.error}` : message),
        "error",
      );
      setBusy(false);
      return;
    }

    setBusy(false);
    showToast("Contraseña actualizada", "success");
  };

  const deleteInternalUser = async (userId, userEmail) => {
    if (currentRole !== "admin") return;
    if (!window.confirm(`Eliminar cuenta completa ${userEmail}? (borra Auth + panel interno)`)) return;

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("manage_internal_user", {
      body: { action: "delete_user", user_id: userId },
    });

    if (error || data?.ok !== true) {
      const isConn = String(error?.message || "").toLowerCase().includes("failed to send a request to the edge function");
      if (isConn) {
        const fallback = await supabase.rpc("rpc_admin_remove_internal_user", { p_user_id: userId });
        if (!fallback.error) {
          await loadUsers();
          setBusy(false);
          showToast("No se pudo borrar Auth (Edge Function no disponible), pero se quitó acceso interno al panel.", "warning");
          return;
        }
      }

      const message = await getInvokeError(error, "No se pudo eliminar cuenta completa");
      showToast(data?.error ? `${message}: ${data.error}` : message, "error");
      setBusy(false);
      return;
    }

    await loadUsers();
    setBusy(false);
    showToast("Usuario eliminado", "success");
  };


  const setUserEnabled = async (userId, userEmail, enabled) => {
    if (currentRole !== "admin") return;
    const action = enabled ? "enable_user" : "disable_user";
    const confirmText = enabled
      ? `Habilitar acceso de ${userEmail}?`
      : `Deshabilitar acceso de ${userEmail}?`;
    if (!window.confirm(confirmText)) return;

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("manage_internal_user", {
      body: { action, user_id: userId },
    });

    if (error || data?.ok !== true) {
      const message = await getInvokeError(error, enabled ? "No se pudo habilitar usuario" : "No se pudo deshabilitar usuario");
      showToast(data?.error ? `${message}: ${data.error}` : message, "error");
      setBusy(false);
      return;
    }

    setBusy(false);
    showToast(enabled ? "Usuario habilitado" : "Usuario deshabilitado", "success");
  };
  const createInternalUser = async () => {
    if (!email.trim() || !password.trim()) {
      showToast("Completa email y contraseña", "warning");
      return;
    }

    const payload = { email: email.trim(), password: password.trim(), role: newRole };

    setBusy(true);

    const primary = await supabase.functions.invoke("create_internal_user", { body: payload });

    let data = primary.data;
    let error = primary.error;

    const primaryConnectionError = String(error?.message || "").toLowerCase().includes("failed to send a request to the edge function");

    if (primaryConnectionError) {
      const legacy = await supabase.functions.invoke("admin-users-create", { body: payload });
      if (!legacy.error && legacy.data?.ok === true) {
        data = legacy.data;
        error = null;
        showToast("Usuario interno creado (fallback admin-users-create)", "success");
      } else if (legacy.error) {
        error = legacy.error;
      }
    }

    if (error || data?.ok !== true) {
      const isConn = String(error?.message || "").toLowerCase().includes("failed to send a request to the edge function");
      if (isConn) {
        const assign = await assignRoleToExistingAuthUser(payload.email.toLowerCase(), payload.role);
        if (!assign.error) {
          setEmail("");
          setPassword("");
          setNewRole("cocina");
          await loadUsers();
          setBusy(false);
          showToast("No hubo conexión a Edge Function, pero se asignó rol interno a usuario Auth existente.", "success");
          return;
        }
      }

      const message = await getInvokeError(error, "No se pudo crear usuario interno");
      showToast(
        isConn
          ? `${message}. Si el usuario ya existe en Auth, usa su email para asignarle rol; si no existe, crea primero en Supabase Auth > Users.`
          : (data?.error ? `${message}: ${data.error}` : message),
        "error",
      );
      setBusy(false);
      return;
    }

    setEmail("");
    setPassword("");
    setNewRole("cocina");
    await loadUsers();
    setBusy(false);
    if (!primaryConnectionError) {
      showToast("Usuario interno creado", "success");
    }
  };

  const managedUsers = users.filter((u) => u.user_id !== currentUserId);

  if (!canAccess("usuarios")) return <p>No tienes permisos para Usuarios.</p>;
  if (loading) return <p>Cargando usuarios...</p>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Usuarios internos</h2>

      <section style={{ background: "#fff", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Crear usuario interno</h3>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo interno (ej. cocina@local)" style={inputStyle} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="contraseña" type="password" style={inputStyle} />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={inputStyle}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" style={btnPrimary} disabled={busy || currentRole !== "admin"} onClick={createInternalUser}>Crear usuario</button>
      </section>

      <section style={{ background: "#fff", borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Gestionar usuarios internos</h3>
        <p style={{ margin: "4px 0 8px", color: "#6b7280" }}>
          Gestiona usuarios internos: cambia rol, restablece contraseña, habilita/deshabilita y elimina cuenta completa.
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {managedUsers.length === 0 ? <p style={{ color: "#6b7280" }}>No hay otros usuarios internos para gestionar.</p> : managedUsers.map((u) => (
            <div key={u.user_id} style={rowStyle}>
              <div>
                <strong>{u.nombre ? `${u.nombre} ${u.apellidos || ""}`.trim() : u.email}</strong>
                <small style={{ display: "block", color: "#6b7280" }}>{u.email}</small>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <select value={u.role || "admin"} onChange={(e) => saveRole(u.user_id, u.email, e.target.value)} disabled={busy || currentRole !== "admin"} style={inputStyle}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button type="button" style={btnGhost} disabled={busy || currentRole !== "admin"} onClick={() => resetPassword(u.user_id, u.email)}>Restablecer contraseña</button>
                <button type="button" style={btnGhost} disabled={busy || currentRole !== "admin"} onClick={() => setUserEnabled(u.user_id, u.email, false)}>Deshabilitar</button>
                <button type="button" style={btnGhost} disabled={busy || currentRole !== "admin"} onClick={() => setUserEnabled(u.user_id, u.email, true)}>Habilitar</button>
                <button type="button" style={btnDanger} disabled={busy || currentRole !== "admin"} onClick={() => deleteInternalUser(u.user_id, u.email)}>Eliminar cuenta completa</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const rowStyle = { display: "flex", justifyContent: "space-between", gap: 8, border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", alignItems: "center" };
const inputStyle = { border: "1px solid #dce7e2", borderRadius: 8, padding: "9px 10px", fontSize: 14 };
const btnPrimary = { background: "#2fa67f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 12px", cursor: "pointer" };
const btnGhost = { background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8, padding: "10px 12px", cursor: "pointer" };
const btnDanger = { background: "#b3261e", color: "#fff", border: "none", borderRadius: 8, padding: "10px 12px", cursor: "pointer" };
