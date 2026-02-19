import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { logCriticalEvent } from "../lib/observability";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const sessionExpiresIn = 3600; // 1 hora

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  async function handleLogin(e) {
    e.preventDefault();

    if (!email || !password) {
      return showToast("Ingresa correo y contraseña", "error");
    }

    setLoading(true);
    const { error, data } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    setLoading(false);

    if (error) {
      if (error.message.includes("Invalid login")) {
        return showToast("Credenciales inválidas", "error");
      }
      await logCriticalEvent("auth_error", "admin_login", error, { email });
      return showToast(error.message, "error");
    }

    if (!data.user.email_confirmed_at) {
      return showToast("Debes confirmar tu correo", "error");
    }

    const expiresAt = Date.now() + sessionExpiresIn * 1000;
    localStorage.setItem(
      "userSession",
      JSON.stringify({ user: data.user, expiresAt })
    );

    showToast("Inicio de sesión exitoso", "success");
    setTimeout(() => navigate("/"), 1200);
  }

  async function handleForgotPassword() {
    if (!email) return showToast("Ingresa tu correo", "error");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/reset-password"
    });

    if (error) {
      await logCriticalEvent("auth_error", "admin_reset_password", error, { email });
      showToast(error.message, "error");
    }
    else showToast("Revisa tu correo para restablecer tu contraseña");
  }

  return (
    <div style={container}>
      {toast && <Toast {...toast} />}

      <form onSubmit={handleLogin} style={formStyle}>
        <h2 style={{ textAlign: "center", marginBottom: 20 }}>Iniciar Sesión</h2>

        <input
          type="email"
          placeholder="Correo"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={inputStyle}
        />

        <div style={{ position: "relative" }}>
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Contraseña"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={inputStyle}
          />
          <span
            onClick={() => setShowPassword(!showPassword)}
            style={eyeStyle}
          >
            {showPassword ? "🙈" : "👁️"}
          </span>
        </div>

        <button type="submit" disabled={loading} style={btnPrimary}>
          {loading ? "Cargando..." : "Iniciar Sesión"}
        </button>

        <button type="button" onClick={handleForgotPassword} style={btnSecondary}>
          ¿Olvidaste tu contraseña?
        </button>
      </form>
    </div>
  );
}

/* ================== COMPONENTE TOAST ================== */
function Toast({ msg, type }) {
  return (
    <div style={{
      position: "fixed",
      top: 20,
      right: 20,
      padding: "12px 18px",
      borderRadius: "8px",
      backgroundColor: type === "error" ? "#dc3545" : "#28a745",
      color: "#fff",
      boxShadow: "0 4px 10px rgba(0,0,0,.2)",
      zIndex: 999
    }}>
      {msg}
    </div>
  );
}

/* ================== STYLES ================== */
const container = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  height: "100vh",
  backgroundColor: "#1a1a2e"
};

const formStyle = {
  backgroundColor: "#162447",
  padding: "40px",
  borderRadius: "10px",
  width: "320px",
  color: "#fff",
  boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
  display: "flex",
  flexDirection: "column",
  gap: "12px"
};

const inputStyle = {
  padding: "10px",
  borderRadius: "6px",
  border: "none",
  width: "100%"
};

const btnPrimary = {
  padding: "10px",
  backgroundColor: "#fca311",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer"
};

const btnSecondary = {
  padding: "10px",
  backgroundColor: "#e5e5e5",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer"
};

const eyeStyle = {
  position: "absolute",
  right: 10,
  top: "50%",
  transform: "translateY(-50%)",
  cursor: "pointer"
};
