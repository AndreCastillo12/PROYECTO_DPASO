// src/components/UserProfile.jsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function UserProfile() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    async function fetchUser() {
      const currentUser = supabase.auth.user(); // información básica
      if (!currentUser) return;
      
      // Si quieres traer datos extra de la tabla users:
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", currentUser.id)
        .single();

      if (error) console.error(error);
      else setUser(data);
    }

    fetchUser();
  }, []);

  if (!user) return <p>Cargando perfil...</p>;

  return (
    <div style={{
      border: "1px solid #ccc",
      padding: "12px",
      borderRadius: "8px",
      backgroundColor: "#fff",
      maxWidth: "250px"
    }}>
      <h3>Perfil</h3>
      <p><strong>Nombre:</strong> {user.nombre || user.email}</p>
      <p><strong>Email:</strong> {user.email}</p>
      {/* Puedes agregar más campos según tu tabla */}
    </div>
  );
}
