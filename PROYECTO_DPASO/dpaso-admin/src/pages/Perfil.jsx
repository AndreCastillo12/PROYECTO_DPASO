import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Perfil() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ nombre: "", telefono: "" });

  useEffect(() => {
    const session = JSON.parse(localStorage.getItem("userSession"));
    if (session?.user) {
      setUser(session.user);
      setForm({ nombre: session.user.user_metadata?.nombre || "", telefono: session.user.user_metadata?.telefono || "" });
    }
    setLoading(false);
  }, []);

  async function guardarPerfil() {
    if (!form.nombre) return alert("Nombre es obligatorio");

    await supabase.auth.updateUser({
      data: { nombre: form.nombre, telefono: form.telefono }
    });

    alert("Perfil actualizado");
  }

  return loading ? <p>Cargando...</p> : (
    <div style={{ maxWidth: "400px", width: "100%", backgroundColor: "#fff", padding: "20px", borderRadius: "10px" }}>
      <h2>Perfil de Usuario</h2>
      <input type="text" placeholder="Nombre" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} style={inputStyle} />
      <input type="text" placeholder="Teléfono" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} style={inputStyle} />
      <button onClick={guardarPerfil} style={btnSave}>Guardar Cambios</button>
    </div>
  );
}

const inputStyle = { width: "100%", padding: "10px", marginBottom: "12px", borderRadius: "6px", border: "1px solid #ccc" };
const btnSave = { width: "100%", backgroundColor: "#178d42", color: "#fff", border: "none", padding: "10px", borderRadius: "6px", cursor: "pointer" };
