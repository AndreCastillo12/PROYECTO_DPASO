import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { logCriticalEvent } from "../lib/observability";
import { IDLE_LOGOUT_SESSION_FLAG } from "../hooks/useIdleLogout";
import "../styles/login.css";

const LOGIN_LOGO_STORAGE_KEY = "dpaso_admin_login_logo";
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [customLogo, setCustomLogo] = useState("");

  const sessionExpiresIn = 3600;

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    const savedLogo = localStorage.getItem(LOGIN_LOGO_STORAGE_KEY) || "";
    setCustomLogo(savedLogo);

    const idleLogout = sessionStorage.getItem(IDLE_LOGOUT_SESSION_FLAG) === "1";
    if (idleLogout) {
      sessionStorage.removeItem(IDLE_LOGOUT_SESSION_FLAG);
      showToast("Sesión cerrada por inactividad", "info");
    }

    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "unauthorized") showToast("No autorizado", "error");
  }, []);

  async function handleLogin(e) {
    e.preventDefault();

    if (!email || !password) return showToast("Ingresa correo y contraseña", "error");

    setLoading(true);
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      if (error.message.includes("Invalid login")) return showToast("Credenciales inválidas", "error");
      await logCriticalEvent("auth_error", "admin_login", error, { email });
      return showToast(error.message, "error");
    }

    if (!data.user.email_confirmed_at) return showToast("Debes confirmar tu correo", "error");

    const expiresAt = Date.now() + sessionExpiresIn * 1000;
    localStorage.setItem("userSession", JSON.stringify({ user: data.user, expiresAt }));

    showToast("Inicio de sesión exitoso", "success");
    setTimeout(() => navigate("/"), 1200);
  }

  async function handleForgotPassword() {
    if (!email) return showToast("Ingresa tu correo", "error");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/reset-password",
    });

    if (error) {
      await logCriticalEvent("auth_error", "admin_reset_password", error, { email });
      showToast(error.message, "error");
    } else {
      showToast("Revisa tu correo para restablecer tu contraseña");
    }
  }

  function handleLogoFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("Selecciona una imagen válida (PNG/JPG/SVG/WEBP)", "error");
      return;
    }

    if (file.size > MAX_LOGO_SIZE_BYTES) {
      showToast("El logo supera 2MB. Usa una imagen más liviana.", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      localStorage.setItem(LOGIN_LOGO_STORAGE_KEY, dataUrl);
      setCustomLogo(dataUrl);
      showToast("Logo actualizado", "success");
    };
    reader.readAsDataURL(file);
  }

  function resetCustomLogo() {
    localStorage.removeItem(LOGIN_LOGO_STORAGE_KEY);
    setCustomLogo("");
    showToast("Logo restablecido", "info");
  }

  return (
    <main className="dp-login">
      {toast && <Toast {...toast} />}

      <section className="dp-login__card" aria-label="Login panel administrador">
        <div className="dp-login__brand">
          <div className="dp-login__logo-shell">
            {customLogo ? (
              <img src={customLogo} alt="Logo del local" className="dp-login__logo-image" />
            ) : (
              <div className="dp-login__logo">DP</div>
            )}
          </div>
          <h1>DPASO Admin</h1>
          <p>Panel de control interno</p>

          <div className="dp-login__logo-tools">
            <label className="dp-login__logo-upload" htmlFor="logo-upload-input">
              Cambiar logo
            </label>
            <input
              id="logo-upload-input"
              className="dp-login__logo-input"
              type="file"
              accept="image/*"
              onChange={handleLogoFileChange}
            />
            <button type="button" className="dp-login__logo-reset" onClick={resetCustomLogo}>
              Restablecer
            </button>
          </div>
        </div>

        <form onSubmit={handleLogin} className="dp-login__form">
          <label className="dp-login__field">
            <span>Correo</span>
            <input
              type="email"
              placeholder="admin@dpaso.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>

          <label className="dp-login__field">
            <span>Contraseña</span>
            <div className="dp-login__password-wrap">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="dp-login__eye"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </label>

          <button type="submit" className="dp-login__submit" disabled={loading}>
            {loading ? "Ingresando..." : "Iniciar sesión"}
          </button>

          <button type="button" className="dp-login__forgot" onClick={handleForgotPassword}>
            ¿Olvidaste tu contraseña?
          </button>
        </form>
      </section>
    </main>
  );
}

function Toast({ msg, type }) {
  return <div className={`dp-login__toast dp-login__toast--${type || "success"}`}>{msg}</div>;
}
