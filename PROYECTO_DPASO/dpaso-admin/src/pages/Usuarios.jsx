import { useEffect, useState } from "react";
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

async function createInternalBySignupFallback({ email, password, role }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  const assignExisting = await supabase.rpc("rpc_admin_set_user_role_by_email", {
    p_email: normalizedEmail,
    p_role: role,
  });
  if (!assignExisting.error) {
    return { ok: true, created: false };
  }

  const existingError = String(assignExisting.error?.message || "").toUpperCase();
  if (!existingError.includes("USER_NOT_FOUND")) {
    return { ok: false, error: assignExisting.error?.message || "ROLE_ASSIGN_FAILED" };
  }

  const url = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { ok: false, error: "MISSING_FRONTEND_ENV" };
  }

  const isolatedClient = createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { error: signUpError } = await isolatedClient.auth.signUp({ email: normalizedEmail, password });
  if (signUpError) {
    const lower = String(signUpError.message || "").toLowerCase();
    if (lower.includes("email rate limit exceeded")) {
      return { ok: false, error: "EMAIL_RATE_LIMIT_EXCEEDED" };
    }
    return { ok: false, error: signUpError.message || "SIGNUP_FAILED" };
  }

  const assignAfterSignup = await supabase.rpc("rpc_admin_set_user_role_by_email", {
    p_email: normalizedEmail,
    p_role: role,
  });
  if (assignAfterSignup.error) {
    return { ok: false, error: assignAfterSignup.error.message || "ROLE_ASSIGN_FAILED" };
  }

  return { ok: true, created: true };
}

export default function Usuarios() {
  const { canAccess, role: currentRole } = useAdminRole();
  const { toast, showToast } = useToast(4800);
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

  const removeInternalAccess = async (userId, userEmail) => {
    if (currentRole !== "admin") return;
    if (!window.confirm(`Quitar acceso interno a ${userEmail}?`)) return;

    setBusy(true);
    const { error } = await supabase.rpc("rpc_admin_remove_internal_user", {
      p_user_id: userId,
    });

    if (error) {
      showToast(errMsg(error, "No se pudo quitar acceso interno"), "error");
      setBusy(false);
      return;
    }

    await loadUsers();
    setBusy(false);
    showToast("Acceso interno removido", "success");
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
      const message = await getInvokeError(error, "No se pudo resetear contraseña");
      showToast(data?.error ? `${message}: ${data.error}` : message, "error");
      setBusy(false);
      return;
    }

    setBusy(false);
    showToast("Contraseña actualizada", "success");
  };

  const deleteInternalUser = async (userId, userEmail) => {
    if (currentRole !== "admin") return;
    if (!window.confirm(`Eliminar usuario ${userEmail} de Auth y panel interno?`)) return;

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("manage_internal_user", {
      body: { action: "delete_user", user_id: userId },
    });

    if (error || data?.ok !== true) {
      const message = await getInvokeError(error, "No se pudo eliminar usuario completo");
      showToast(data?.error ? `${message}: ${data.error}` : message, "error");
      setBusy(false);
      return;
    }

    await loadUsers();
    setBusy(false);
    showToast("Usuario eliminado", "success");
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

    const stillConnectionError = String(error?.message || "").toLowerCase().includes("failed to send a request to the edge function");

    if (stillConnectionError) {
      const fallback = await createInternalBySignupFallback(payload);
      if (fallback.ok) {
        setEmail("");
        setPassword("");
        setNewRole("cocina");
        await loadUsers();
        setBusy(false);
        showToast(
          fallback.created
            ? "Usuario interno creado (fallback sin Edge Function)"
            : "Usuario ya existía en Auth; se asignó rol interno",
          "success",
        );
        return;
      }

      const rateLimit = String(fallback.error || "").toUpperCase().includes("EMAIL_RATE_LIMIT_EXCEEDED");
      showToast(
        rateLimit
          ? "No se pudo crear usuario interno: email rate limit exceeded. Espera unos minutos y vuelve a intentar."
          : `No se pudo crear usuario interno: ${fallback.error}`,
        "error",
      );
      setBusy(false);
      return;
    }

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
    if (!primaryConnectionError) {
      showToast("Usuario interno creado", "success");
    }
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
        <button type="button" style={btnPrimary} disabled={busy || currentRole !== "admin"} onClick={createInternalUser}>Crear usuario</button>
      </section>

      <section style={{ background: "#fff", borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Gestionar usuarios internos</h3>
        <div style={{ display: "grid", gap: 8 }}>
          {users.map((u) => (
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
                <button type="button" style={btnDangerGhost} disabled={busy || currentRole !== "admin"} onClick={() => removeInternalAccess(u.user_id, u.email)}>Quitar interno</button>
                <button type="button" style={btnDanger} disabled={busy || currentRole !== "admin"} onClick={() => deleteInternalUser(u.user_id, u.email)}>Eliminar usuario</button>
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
const btnDangerGhost = { background: "#fff", color: "#b3261e", border: "1px solid #f1b7b3", borderRadius: 8, padding: "10px 12px", cursor: "pointer" };
