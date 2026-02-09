// src/components/EditProfile.jsx
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export default function EditProfile() {
  const [form, setForm] = useState({ nombre: "", email: "" });

  useEffect(() => {
    async function loadProfile() {
      const user = supabase.auth.user();
      if (!user) return;

      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", user.id)
        .single();

      if (error) console.error(error);
      else setForm({ nombre: data.nombre, email: data.email });
    }

    loadProfile();
  }, []);

  async function handleSave() {
    const user = supabase.auth.user();
    if (!user) return;

    const { error } = await supabase
      .from("users")
      .update({ nombre: form.nombre })
      .eq("id", user.id);

    if (error) console.error(error);
    else alert("Perfil actualizado correctamente");
  }

  return (
    <div style={{ padding: "12px", border: "1px solid #ccc", borderRadius: "8px", maxWidth: "300px", backgroundColor: "#fff" }}>
      <h3>Editar perfil</h3>
      <input
        type="text"
        value={form.nombre}
        onChange={e => setForm({ ...form, nombre: e.target.value })}
        style={{ padding: "6px", marginBottom: "8px", width: "100%", borderRadius: "6px", border: "1px solid #ccc" }}
      />
      <input
        type="email"
        value={form.email}
        disabled
        style={{ padding: "6px", marginBottom: "8px", width: "100%", borderRadius: "6px", border: "1px solid #ccc", backgroundColor: "#eee" }}
      />
      <button onClick={handleSave} style={{
        backgroundColor: "#178d42",
        color: "#fff",
        border: "none",
        padding: "8px 12px",
        borderRadius: "6px",
        cursor: "pointer"
      }}>
        Guardar
      </button>
    </div>
  );
}
