import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import useAdminRole from "../hooks/useAdminRole";

const ROLES = ["admin", "cajero", "mozo", "cocina"];

function errMsg(error, fallback) {
  const msg = String(error?.message || "").trim();
  return msg ? `${fallback}: ${msg}` : fallback;
}

export default function Usuarios() {
  const { canAccess } = useAdminRole();
  const { toast, showToast } = useToast(2800);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState("cocina");

  const loadUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("rpc_admin_list_users");
    if (error) {
      showToast(errMsg(error, "No se pudo cargar usuarios"), "error");
      setUsers([]);
      setLoading(false);
      return;
    }
    setUsers(data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadUsers();
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

  const createInternalUser = async () => {
    if (!email.trim() || !password.trim()) {
      showToast("Completa email y contraseña", "warning");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-users-create", {
      body: { email: email.trim(), password: password.trim(), role: newRole },
    });

    if (error || data?.ok !== true) {
      showToast(errMsg(error || new Error(data?.error || "Error"), "No se pudo crear usuario interno"), "error");
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
                <select defaultValue={u.role || "admin"} onChange={(e) => saveRole(u.user_id, e.target.value)} disabled={busy} style={inputStyle}>
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
