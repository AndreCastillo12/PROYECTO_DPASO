import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const INITIAL_FORM = {
  nombre: "",
  apellidos: "",
  telefono: "",
  avatarUrl: "",
};

export default function Perfil() {
  const [user, setUser] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function cargarPerfil() {
      setLoading(true);
      setError("");
      setSuccess("");

      const { data, error: userError } = await supabase.auth.getUser();
      if (!isMounted) return;

      if (userError || !data?.user) {
        setError("No se pudo cargar la sesión. Inicia sesión nuevamente.");
        setLoading(false);
        return;
      }

      const currentUser = data.user;
      setUser(currentUser);
      setForm({
        nombre: currentUser.user_metadata?.nombre || "",
        apellidos: currentUser.user_metadata?.apellidos || "",
        telefono: currentUser.user_metadata?.telefono || "",
        avatarUrl: currentUser.user_metadata?.avatar_url || "",
      });
      setLoading(false);
    }

    cargarPerfil();

    return () => {
      isMounted = false;
    };
  }, []);

  const email = user?.email || "";
  const avatarPreview = useMemo(() => {
    if (form.avatarUrl?.trim()) return form.avatarUrl.trim();
    if (email) {
      return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(email)}`;
    }
    return "";
  }, [email, form.avatarUrl]);

  function actualizarCampo(campo) {
    return (event) => {
      setForm((prev) => ({ ...prev, [campo]: event.target.value }));
    };
  }

  function validarFormulario() {
    if (!form.nombre.trim()) return "El nombre es obligatorio.";
    if (!form.apellidos.trim()) return "Los apellidos son obligatorios.";
    return "";
  }

  async function guardarPerfil(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const mensajeError = validarFormulario();
    if (mensajeError) {
      setError(mensajeError);
      return;
    }

    setSaving(true);

    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        nombre: form.nombre.trim(),
        apellidos: form.apellidos.trim(),
        telefono: form.telefono.trim(),
        avatar_url: form.avatarUrl.trim(),
      },
    });

    if (updateError) {
      setError("No se pudo guardar el perfil. Intenta nuevamente.");
      setSaving(false);
      return;
    }

    const { data } = await supabase.auth.getUser();
    if (data?.user) {
      setUser(data.user);
      localStorage.setItem("userSession", JSON.stringify({ user: data.user }));
    }

    setSuccess("Perfil actualizado correctamente.");
    setSaving(false);
  }

  if (loading) {
    return <p style={loadingStyle}>Cargando perfil...</p>;
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <header style={headerStyle}>
          <div style={avatarWrapperStyle}>
            {avatarPreview ? (
              <img src={avatarPreview} alt="Foto de perfil" style={avatarStyle} />
            ) : (
              <div style={avatarFallbackStyle}>?</div>
            )}
          </div>
          <div>
            <h2 style={titleStyle}>Perfil</h2>
            <p style={subtitleStyle}>Actualiza tus datos personales.</p>
          </div>
        </header>

        <form onSubmit={guardarPerfil} style={formStyle}>
          {error && <div style={errorStyle}>{error}</div>}
          {success && <div style={successStyle}>{success}</div>}

          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Correo</label>
            <input type="email" value={email} readOnly style={{ ...inputStyle, backgroundColor: "#f3f4f6" }} />
            <span style={helperStyle}>El correo se toma de la sesión actual y no se puede editar.</span>
          </div>

          <div style={gridStyle}>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Nombre</label>
              <input
                type="text"
                placeholder="Tu nombre"
                value={form.nombre}
                onChange={actualizarCampo("nombre")}
                style={inputStyle}
                required
              />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Apellidos</label>
              <input
                type="text"
                placeholder="Tus apellidos"
                value={form.apellidos}
                onChange={actualizarCampo("apellidos")}
                style={inputStyle}
                required
              />
            </div>
          </div>

          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Teléfono</label>
            <input
              type="text"
              placeholder="Ej: 999 999 999"
              value={form.telefono}
              onChange={actualizarCampo("telefono")}
              style={inputStyle}
            />
          </div>

          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Foto de perfil (URL)</label>
            <input
              type="url"
              placeholder="https://..."
              value={form.avatarUrl}
              onChange={actualizarCampo("avatarUrl")}
              style={inputStyle}
            />
            <span style={helperStyle}>Puedes usar un enlace público de imagen.</span>
          </div>

          <button type="submit" style={saving ? { ...btnSave, opacity: 0.7 } : btnSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </form>
      </div>
    </div>
  );
}

const pageStyle = {
  width: "100%",
  display: "flex",
  justifyContent: "center",
  padding: "24px",
};

const cardStyle = {
  width: "100%",
  maxWidth: "720px",
  backgroundColor: "#ffffff",
  borderRadius: "16px",
  boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
  padding: "28px",
};

const headerStyle = {
  display: "flex",
  gap: "16px",
  alignItems: "center",
  marginBottom: "24px",
};

const avatarWrapperStyle = {
  width: "72px",
  height: "72px",
  borderRadius: "50%",
  overflow: "hidden",
  border: "2px solid #e5e7eb",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#f9fafb",
};

const avatarStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const avatarFallbackStyle = {
  fontSize: "28px",
  color: "#9ca3af",
};

const titleStyle = {
  margin: 0,
  fontSize: "22px",
  color: "#111827",
};

const subtitleStyle = {
  margin: "6px 0 0",
  color: "#6b7280",
  fontSize: "14px",
};

const formStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "16px",
};

const fieldGroupStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const labelStyle = {
  fontWeight: "600",
  color: "#374151",
  fontSize: "14px",
};

const helperStyle = {
  fontSize: "12px",
  color: "#6b7280",
};

const inputStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: "10px",
  border: "1px solid #e5e7eb",
  fontSize: "14px",
  outline: "none",
};

const btnSave = {
  width: "100%",
  backgroundColor: "#178d42",
  color: "#fff",
  border: "none",
  padding: "12px",
  borderRadius: "10px",
  cursor: "pointer",
  fontSize: "15px",
  fontWeight: "600",
};

const loadingStyle = {
  padding: "24px",
  color: "#6b7280",
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
