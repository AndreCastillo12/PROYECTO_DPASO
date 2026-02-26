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

export default function Usuarios() {
  const { canAccess } = useAdminRole();
  const { toast, showToast } = useToast(3400);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState([]);

  const [existingEmail, setExistingEmail] = useState("");
  const [existingRole, setExistingRole] = useState("cocina");

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

    return () => clearTimeout(timer);
  }, []);

  const saveRole = async (userId, role) => {
    setBusy(true);
    const { error } = await supabase.rpc("rpc_admin_set_user_role", {
      p_user_id: userId,
      p_role: role,
    });
    if (error) {
      showToast(errMsg(error, "No se pudo guardar rol"), "error");
      setBusy(false);
      return;
    }
    await loadUsers();
    setBusy(false);
    showToast("Rol actualizado", "success");
  };

  const setRoleByEmail = async () => {
    if (!existingEmail.trim()) {
      showToast("Ingresa un email", "warning");
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc("rpc_admin_set_user_role_by_email", {
      p_email: existingEmail.trim().toLowerCase(),
      p_role: existingRole,
    });

    if (error) {
      showToast(errMsg(error, "No se pudo asignar rol por email"), "error");
      setBusy(false);
      return;
    }

    setExistingEmail("");
    await loadUsers();
    setBusy(false);
    showToast("Rol asignado al usuario existente", "success");
  };

  const createInternalUser = async () => {
    if (!email.trim() || !password.trim()) {
      showToast("Completa email y contraseña", "warning");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create_internal_user", {
      body: { email: email.trim(), password: password.trim(), role: newRole },
    });

    if (error || data?.ok !== true) {
      const message = await getInvokeError(error, "No se pudo crear usuario interno");
      showToast(data?.error ? `${message}: ${data.error}` : message, "error");
      setBusy(false);
      return;
    }

    setEmail("");
    setPassword("");
    setNewRole("cocina");
    await loadUsers();
    setBusy(false);
    showToast("Usuario interno creado", "success");
  };

  if (!canAccess("usuarios")) return <p>No tienes permisos para Usuarios.</p>;
  if (loading) return <p>Cargando usuarios...</p>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Usuarios internos</h2>

      <section style={{ background: "#fff", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Asignar rol a usuario existente</h3>
        <input value={existingEmail} onChange={(e) => setExistingEmail(e.target.value)} placeholder="email existente en auth.users" style={inputStyle} />
        <select value={existingRole} onChange={(e) => setExistingRole(e.target.value)} style={inputStyle}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" style={btnPrimary} disabled={busy} onClick={setRoleByEmail}>Asignar rol por email</button>
      </section>

      <section style={{ background: "#fff", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Crear usuario interno</h3>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo interno (ej. cocina@local)" style={inputStyle} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="contraseña" type="password" style={inputStyle} />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={inputStyle}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" style={btnPrimary} disabled={busy} onClick={createInternalUser}>Crear usuario</button>
      </section>

      <section style={{ background: "#fff", borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Roles actuales</h3>
        <div style={{ display: "grid", gap: 8 }}>
          {users.map((u) => (
            <div key={u.user_id} style={rowStyle}>
              <div>
                <strong>{u.nombre ? `${u.nombre} ${u.apellidos || ""}`.trim() : u.email}</strong>
                <small style={{ display: "block", color: "#6b7280" }}>{u.email}</small>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={u.role || "admin"} onChange={(e) => saveRole(u.user_id, e.target.value)} disabled={busy} style={inputStyle}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
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
