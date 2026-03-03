import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

function isDev() {
  return import.meta.env.MODE !== "production";
}

function debugLog(message, payload) {
  if (isDev()) {
    // eslint-disable-next-line no-console
    console.error(message, payload);
  }
}

function toFriendlyError(error, fallback = "Ocurrió un error, intenta nuevamente.") {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("rate limit") || message.includes("too many requests")) {
    return "Se realizaron demasiadas solicitudes. Intenta en unos minutos.";
  }
  if (message.includes("invalid") || message.includes("expired") || message.includes("otp")) {
    return "El enlace es inválido o expiró. Solicita uno nuevo.";
  }

  return fallback;
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [linkStatus, setLinkStatus] = useState("validating"); // validating | ready | invalid

  const submitDisabled = useMemo(
    () => loading || linkStatus !== "ready",
    [loading, linkStatus],
  );

  useEffect(() => {
    let alive = true;

    async function bootstrapRecoverySession() {
      setError("");
      setMessage("");
      setLinkStatus("validating");

      const search = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));

      const code = search.get("code");
      const tokenHash = search.get("token_hash");
      const type = search.get("type");
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");

      const hashErrorCode = String(hash.get("error_code") || "").toLowerCase();
      const hashError = String(hash.get("error") || "").toLowerCase();

      try {
        if (hashErrorCode === "otp_expired" || hashError === "access_denied") {
          throw new Error("recovery_link_expired");
        }

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (tokenHash && type === "recovery") {
          const { error: otpError } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
          if (otpError) throw otpError;
        } else if (accessToken && refreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setSessionError) throw setSessionError;
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (!data?.session) {
          throw new Error("missing_recovery_session");
        }

        if (!alive) return;
        setLinkStatus("ready");
        window.history.replaceState({}, "", window.location.pathname);
      } catch (recoveryError) {
        debugLog("admin reset recovery bootstrap error", {
          message: recoveryError?.message,
          code: recoveryError?.code,
          status: recoveryError?.status,
        });
        if (!alive) return;
        setLinkStatus("invalid");
        setError(toFriendlyError(recoveryError, "El enlace es inválido o expiró. Solicita uno nuevo."));
      }
    }

    bootstrapRecoverySession();

    return () => {
      alive = false;
    };
  }, []);

  async function handleReset(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!password || !confirmPassword) {
      setError("Completa ambos campos de contraseña.");
      return;
    }

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData?.session) {
        throw new Error("missing_recovery_session");
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      setMessage("Contraseña actualizada. Ya puedes iniciar sesión.");
      setTimeout(() => navigate("/login"), 1300);
    } catch (updateError) {
      debugLog("admin reset update password error", {
        message: updateError?.message,
        code: updateError?.code,
        status: updateError?.status,
      });
      setError(toFriendlyError(updateError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={container}>
      <form onSubmit={handleReset} style={formStyle}>
        <h2 style={{ textAlign: "center", marginBottom: 8 }}>Restablecer contraseña</h2>

        {linkStatus === "validating" && <div style={infoStyle}>Validando enlace de recuperación...</div>}
        {linkStatus === "invalid" && (
          <div style={errorStyle}>
            {error || "El enlace es inválido o expiró. Solicita uno nuevo desde el login."}
          </div>
        )}

        {error && linkStatus !== "invalid" && <div style={errorStyle}>{error}</div>}
        {message && <div style={successStyle}>{message}</div>}

        <input
          type="password"
          placeholder="Nueva contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
          disabled={linkStatus !== "ready"}
        />

        <input
          type="password"
          placeholder="Confirmar contraseña"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          style={inputStyle}
          disabled={linkStatus !== "ready"}
        />

        <button type="submit" disabled={submitDisabled} style={btnPrimary}>
          {loading ? "Guardando..." : "Guardar contraseña"}
        </button>

        <button type="button" onClick={() => navigate("/login")} style={btnSecondary}>
          Volver al login
        </button>
      </form>
    </div>
  );
}

const container = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  height: "100vh",
  backgroundColor: "#1a1a2e",
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
  gap: "12px",
};

const inputStyle = {
  padding: "10px",
  borderRadius: "6px",
  border: "none",
  width: "100%",
};

const btnPrimary = {
  padding: "10px",
  backgroundColor: "#fca311",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
};

const btnSecondary = {
  padding: "10px",
  backgroundColor: "#e5e5e5",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
};

const infoStyle = {
  backgroundColor: "#dbeafe",
  color: "#1d4ed8",
  padding: "10px 12px",
  borderRadius: "8px",
  fontSize: "13px",
};

const errorStyle = {
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  padding: "10px 12px",
  borderRadius: "8px",
  fontSize: "13px",
};

const successStyle = {
  backgroundColor: "#dcfce7",
  color: "#166534",
  padding: "10px 12px",
  borderRadius: "8px",
  fontSize: "13px",
};
