import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleReset(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!password || !confirmPassword) {
      setError("Completa ambos campos de contraseña.");
      return;
    }

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError("No se pudo actualizar la contraseña. Intenta nuevamente.");
      setLoading(false);
      return;
    }

    setMessage("Contraseña actualizada. Ya puedes iniciar sesión.");
    setLoading(false);
    setTimeout(() => navigate("/login"), 1200);
  }

  return (
    <div style={container}>
      <form onSubmit={handleReset} style={formStyle}>
        <h2 style={{ textAlign: "center", marginBottom: 20 }}>Restablecer contraseña</h2>

        {error && <div style={errorStyle}>{error}</div>}
        {message && <div style={successStyle}>{message}</div>}

        <input
          type="password"
          placeholder="Nueva contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />

        <input
          type="password"
          placeholder="Confirmar contraseña"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          style={inputStyle}
        />

        <button type="submit" disabled={loading} style={btnPrimary}>
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