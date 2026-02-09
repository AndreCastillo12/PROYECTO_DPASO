// src/components/LogoutButton.jsx
import { supabase } from "../lib/supabaseClient";
import { useNavigate } from "react-router-dom";

export default function LogoutButton() {
  const navigate = useNavigate();

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Error cerrando sesión:", error.message);
    } else {
      // Redirige automáticamente al login
      navigate("/login");
    }
  }

  return (
    <button
      onClick={handleLogout}
      style={{
        backgroundColor: "#d9534f",
        color: "#fff",
        border: "none",
        padding: "6px 14px",
        borderRadius: "6px",
        cursor: "pointer"
      }}
    >
      Cerrar sesión
    </button>
  );
}
