import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { EdgeFunctionError, invokeEdge } from "../lib/edgeFunctions";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import useAdminRole from "../hooks/useAdminRole";

const DEFAULT_ROLES = ["superadmin", "admin", "cajero", "mozo", "cocina"];

function errMsg(error, fallback) {
  const msg = String(error?.message || "").trim();
  return msg ? `${fallback}: ${msg}` : fallback;
}

function explainHttpError(status, payloadError) {
  if (status === 401) return "Tu sesión expiró. Inicia sesión nuevamente.";
  if (status === 403) return "No tienes permisos de admin/superadmin para esta acción.";
  if (payloadError === "FORBIDDEN_SUPERADMIN_TARGET") return "Solo un superadmin puede gestionar otro superadmin.";
  return "";
}

export default function Usuarios() {
  const { canAccess, role: currentRole } = useAdminRole();
  const { toast, showToast } = useToast(4200);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState([]);
  const [rolesCatalog, setRolesCatalog] = useState(DEFAULT_ROLES);
  const [currentUserId, setCurrentUserId] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState("cocina");
  const [roleDraftByUser, setRoleDraftByUser] = useState({});

  const loadRolesCatalog = useCallback(async () => {
    const { data, error } = await supabase.from("admin_panel_roles_catalog").select("role").order("role", { ascending: true });
    if (error) {
      showToast(errMsg(error, "No se pudo cargar catálogo de roles"), "warning");
      setRolesCatalog(DEFAULT_ROLES);
      return;
    }

    const roles = (data || []).map((r) => String(r.role || "").trim().toLowerCase()).filter(Boolean);
    setRolesCatalog(roles.length > 0 ? roles : DEFAULT_ROLES);
  }, [showToast]);

  const loadUsers = useCallback(async () => {
    setLoading(true);

    const { data: currentAuth } = await supabase.auth.getUser();
    const myUserId = currentAuth?.user?.id || null;
    setCurrentUserId(myUserId);

    const usersRes = await supabase.rpc("rpc_admin_list_internal_users");
    if (usersRes.error) {
      showToast(errMsg(usersRes.error, "No se pudo cargar usuarios internos"), "error");
      setUsers([]);
      setLoading(false);
      return;
    }

    setUsers(usersRes.data || []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRolesCatalog();
      void loadUsers();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadRolesCatalog, loadUsers]);

  const managedUsers = useMemo(() => users.filter((u) => u.user_id !== currentUserId), [users, currentUserId]);

  const createInternalUser = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return showToast("Completa email", "warning");
    if (!password || password.length < 6) return showToast("La contraseña debe tener al menos 6 caracteres", "warning");

    setBusy(true);
    try {
      await invokeEdge("create_internal_user", {
      email: normalizedEmail,
      password,
      role: newRole,
    });

    } catch (error) {
      const edgeError = error instanceof EdgeFunctionError ? error : null;
      const reason = explainHttpError(edgeError?.status, edgeError?.code);
      showToast(reason || `No se pudo crear usuario: ${edgeError?.code || error?.message || "ERROR"}`, "error");
      setBusy(false);
      return;
    }

    setEmail("");
    setPassword("");
    setNewRole("cocina");
    await loadUsers();
    showToast("Usuario interno creado correctamente", "success");
    setBusy(false);
  };

  const saveRole = async (user) => {
    const nextRole = String(roleDraftByUser[user.user_id] || user.role || "cocina").trim().toLowerCase();
    if (!rolesCatalog.includes(nextRole)) {
      showToast("Selecciona un rol válido del catálogo", "warning");
      return;
    }
    if (user.user_id === currentUserId) {
      showToast("No puedes modificar tu propio rol desde este panel", "warning");
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc("rpc_admin_set_user_role", { p_user_id: user.user_id, p_role: nextRole });
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
    const nextPassword = window.prompt(`Nueva contraseña para ${userEmail} (mín 6):`, "");
    if (!nextPassword || nextPassword.length < 6) return;

    setBusy(true);
    try {
      await invokeEdge("manage_internal_user", {
      action: "reset_password",
      user_id: userId,
      new_password: nextPassword,
    });

    } catch (error) {
      const edgeError = error instanceof EdgeFunctionError ? error : null;
      showToast(explainHttpError(edgeError?.status, edgeError?.code) || `No se pudo restablecer contraseña: ${edgeError?.code || error?.message || "ERROR"}`, "error");
      setBusy(false);
      return;
    }

    setBusy(false);
    showToast("Contraseña actualizada", "success");
  };

  const setUserEnabled = async (userId, userEmail, enabled) => {
    if (!window.confirm(`${enabled ? "Habilitar" : "Deshabilitar"} ${userEmail}?`)) return;

    setBusy(true);
    try {
      await invokeEdge("manage_internal_user", {
      action: enabled ? "enable_user" : "disable_user",
      user_id: userId,
    });

    } catch (error) {
      const edgeError = error instanceof EdgeFunctionError ? error : null;
      showToast(explainHttpError(edgeError?.status, edgeError?.code) || `No se pudo actualizar estado: ${edgeError?.code || error?.message || "ERROR"}`, "error");
      setBusy(false);
      return;
    }

    await loadUsers();
    setBusy(false);
    showToast(enabled ? "Usuario habilitado" : "Usuario deshabilitado", "success");
  };

  const deleteUser = async (userId, userEmail) => {
    if (userId === currentUserId) {
      showToast("No puedes eliminar tu propia cuenta", "warning");
      return;
    }
    if (!window.confirm(`Eliminar cuenta completa ${userEmail}? Esta acción no se puede deshacer.`)) return;

    setBusy(true);
    try {
      await invokeEdge("manage_internal_user", {
      action: "delete_user",
      user_id: userId,
    });

    } catch (error) {
      const edgeError = error instanceof EdgeFunctionError ? error : null;
      const reason = explainHttpError(edgeError?.status, edgeError?.code) || `No se pudo eliminar cuenta: ${edgeError?.code || error?.message || "ERROR"}`;
      showToast(reason, "error");
      setBusy(false);
      return;
    }

    await loadUsers();
    setBusy(false);
    showToast("Cuenta eliminada", "success");
  };

  if (!canAccess("usuarios")) return <p>No tienes permisos para Usuarios internos + Roles.</p>;
  if (loading) return <p>Cargando lista de usuarios...</p>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Usuarios internos + Roles</h2>

      <section style={card}>
        <h3 style={{ margin: 0 }}>Crear usuario interno</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo interno" />
          <input style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" type="password" />
          <select style={{ ...inputStyle, minWidth: 130, padding: "9px 10px" }} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            {rolesCatalog.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <button type="button" style={btnPrimary} disabled={busy || !["admin", "superadmin"].includes(currentRole)} onClick={createInternalUser}>Crear usuario</button>
        </div>
      </section>

      <section style={card}>
        <h3 style={{ margin: 0 }}>Gestión de usuarios</h3>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {managedUsers.length === 0 ? <p style={{ color: "#6b7280" }}>No hay usuarios internos registrados.</p> : managedUsers.map((u) => (
            <div key={u.user_id} style={rowStyle}>
              <div>
                <strong>{u.nombre ? `${u.nombre} ${u.apellidos || ""}`.trim() : u.email}</strong>
                <small style={{ display: "block", color: "#6b7280" }}>
                  {u.email} · rol: {u.role || "sin rol"} · {u.email_confirmed ? "email verificado" : "sin verificar"} · {u.is_disabled ? "deshabilitado" : "habilitado"}
                </small>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  style={{ ...inputStyle, minWidth: 120, padding: "6px 8px" }}
                  value={roleDraftByUser[u.user_id] || u.role || "cocina"}
                  onChange={(e) => setRoleDraftByUser((prev) => ({ ...prev, [u.user_id]: e.target.value }))}
                  disabled={busy || !["admin", "superadmin"].includes(currentRole)}
                >
                  {rolesCatalog.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button type="button" style={btnGhost} disabled={busy || !["admin", "superadmin"].includes(currentRole)} onClick={() => saveRole(u)}>Guardar rol</button>
                {u.is_disabled ? (
                  <button type="button" style={btnGhost} disabled={busy || !["admin", "superadmin"].includes(currentRole)} onClick={() => setUserEnabled(u.user_id, u.email, true)}>Activar</button>
                ) : (
                  <button type="button" style={btnGhost} disabled={busy || !["admin", "superadmin"].includes(currentRole)} onClick={() => setUserEnabled(u.user_id, u.email, false)}>Desactivar</button>
                )}
                <button type="button" style={btnGhost} disabled={busy || !["admin", "superadmin"].includes(currentRole)} onClick={() => resetPassword(u.user_id, u.email)}>Clave</button>
                <button type="button" style={btnDangerGhost} disabled={busy || !["admin", "superadmin"].includes(currentRole)} onClick={() => deleteUser(u.user_id, u.email)}>Eliminar</button>
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
