import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const INITIAL_FORM = {
  nombre: "",
  apellidos: "",
  telefono: "",
};

export default function Perfil() {
  const [user, setUser] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [avatarPath, setAvatarPath] = useState("");
  const [avatarDisplayUrl, setAvatarDisplayUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [localAvatarFile, setLocalAvatarFile] = useState(null);
  const [localAvatarPreview, setLocalAvatarPreview] = useState("");

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

      const { data: profileData } = await supabase
        .from("profiles")
        .select("nombre, apellidos, telefono, avatar_path")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (!isMounted) return;

      setForm({
        nombre: profileData?.nombre || "",
        apellidos: profileData?.apellidos || "",
        telefono: profileData?.telefono || "",
      });
      setAvatarPath(profileData?.avatar_path || "");
      setLoading(false);
    }

    cargarPerfil();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!localAvatarFile) {
      setLocalAvatarPreview("");
      return undefined;
    }

    const previewUrl = URL.createObjectURL(localAvatarFile);
    setLocalAvatarPreview(previewUrl);

    return () => URL.revokeObjectURL(previewUrl);
  }, [localAvatarFile]);

  useEffect(() => {
    let active = true;

    async function cargarAvatar() {
      if (localAvatarPreview) return;

      if (avatarPath) {
        const { data, error: signedError } = await supabase.storage
          .from("avatars")
          .createSignedUrl(avatarPath, 60 * 60);

        if (!active) return;

        if (signedError || !data?.signedUrl) {
          const { data: publicData } = supabase.storage
            .from("avatars")
            .getPublicUrl(avatarPath);
          setAvatarDisplayUrl(publicData?.publicUrl || "");
          return;
        }

        setAvatarDisplayUrl(data.signedUrl);
        return;
      }

      setAvatarDisplayUrl("");
    }

    cargarAvatar();

    return () => {
      active = false;
    };
  }, [avatarPath, localAvatarPreview]);

  const email = user?.email || "";
  const emailConfirmado = Boolean(user?.email_confirmed_at);
  const avatarPreview = useMemo(() => {
    if (localAvatarPreview) return localAvatarPreview;
    if (avatarDisplayUrl) return avatarDisplayUrl;
    if (email) {
      return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(email)}`;
    }
    return "";
  }, [email, avatarDisplayUrl, localAvatarPreview]);

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

  async function reenviarVerificacion() {
    if (!email) return;
    setResendLoading(true);
    setError("");
    setSuccess("");

    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
    });

    if (resendError) {
      setError("No se pudo reenviar el correo de verificación.");
      setResendLoading(false);
      return;
    }

    setSuccess("Correo de verificación enviado. Revisa tu bandeja.");
    setResendLoading(false);
  }

  async function subirAvatarLocal() {
    if (!localAvatarFile || !user) return null;

    const extension = localAvatarFile.name.split(".").pop();
    const fileName = `${user.id}/${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(fileName, localAvatarFile, { upsert: true });

    if (uploadError) {
      throw new Error(
        uploadError.message ||
          "No se pudo subir el avatar. Verifica el bucket \"avatars\" y sus permisos."
      );
    }

    return fileName;
  }

  async function eliminarAvatarStorage(path) {
    if (!path) return;
    const { error: removeError } = await supabase.storage
      .from("avatars")
      .remove([path]);
    if (removeError) {
      throw new Error(removeError.message || "No se pudo eliminar la foto anterior.");
    }
  }

  async function eliminarFotoPerfil() {
    if (!avatarPath || !user) {
      setError("No hay una foto guardada para eliminar.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await eliminarAvatarStorage(avatarPath);

      const { error: updateError } = await supabase
        .from("profiles")
        .upsert({ id: user.id, avatar_path: null }, { onConflict: "id" });

      if (updateError) throw updateError;

      setAvatarPath("");
      setLocalAvatarFile(null);
      setSuccess("Foto eliminada correctamente.");
      window.dispatchEvent(
        new CustomEvent("profile-updated", {
          detail: { nombre: form.nombre.trim(), apellidos: form.apellidos.trim(), avatar_path: null },
        })
      );
    } catch (removeError) {
      console.error(removeError);
      setError(removeError?.message || "No se pudo eliminar la foto.");
    } finally {
      setSaving(false);
    }
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

    if (!user) {
      setError("No se pudo identificar al usuario actual.");
      return;
    }

    setSaving(true);

    try {
      let nextAvatarPath = avatarPath || null;

      if (localAvatarFile) {
        const newPath = await subirAvatarLocal();
        if (avatarPath && avatarPath !== newPath) {
          await eliminarAvatarStorage(avatarPath);
        }
        nextAvatarPath = newPath;
      }

      const payload = {
        id: user.id,
        nombre: form.nombre.trim(),
        apellidos: form.apellidos.trim(),
        telefono: form.telefono.trim(),
        avatar_path: nextAvatarPath,
      };

      const { error: updateError } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "id" });

      if (updateError) throw updateError;

      setAvatarPath(nextAvatarPath || "");
      setLocalAvatarFile(null);
      setSuccess("Perfil actualizado correctamente.");
      window.dispatchEvent(
        new CustomEvent("profile-updated", {
          detail: {
            nombre: form.nombre.trim(),
            apellidos: form.apellidos.trim(),
            avatar_path: nextAvatarPath || null,
          },
        })
      );
    } catch (saveError) {
      console.error(saveError);
      setError(saveError?.message || "No se pudo guardar el perfil. Intenta nuevamente.");
    } finally {
      setSaving(false);
    }
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
            <div style={statusRowStyle}>
              <span style={emailConfirmado ? verifiedStyle : pendingStyle}>
                {emailConfirmado ? "Correo verificado" : "Correo sin verificar"}
              </span>
              {!emailConfirmado && (
                <button
                  type="button"
                  style={resendButtonStyle}
                  onClick={reenviarVerificacion}
                  disabled={resendLoading}
                >
                  {resendLoading ? "Enviando..." : "Reenviar verificación"}
                </button>
              )}
            </div>
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
            <label style={labelStyle}>Foto de perfil (archivo local)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setLocalAvatarFile(file);
              }}
            />
            <span style={helperStyle}>
              Se subirá al bucket &quot;avatars&quot; en Supabase. Asegúrate de que exista y tenga permisos de lectura/escritura.
            </span>
          </div>

          <div style={buttonRowStyle}>
            <button type="submit" style={saving ? { ...btnSave, opacity: 0.7 } : btnSave} disabled={saving}>
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
            <button type="button" style={btnOutline} disabled={saving} onClick={eliminarFotoPerfil}>
              Eliminar foto
            </button>
          </div>
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

const statusRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
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

const verifiedStyle = {
  backgroundColor: "#dcfce7",
  color: "#166534",
  padding: "4px 8px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: "600",
};

const pendingStyle = {
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  padding: "4px 8px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: "600",
};

const resendButtonStyle = {
  backgroundColor: "transparent",
  border: "1px solid #d1d5db",
  borderRadius: "999px",
  padding: "4px 10px",
  fontSize: "12px",
  cursor: "pointer",
};

const buttonRowStyle = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
};

const btnSave = {
  flex: 1,
  backgroundColor: "#178d42",
  color: "#fff",
  border: "none",
  padding: "12px",
  borderRadius: "10px",
  cursor: "pointer",
  fontSize: "15px",
  fontWeight: "600",
};

const btnOutline = {
  flex: 1,
  backgroundColor: "#fff",
  color: "#111827",
  border: "1px solid #d1d5db",
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
