import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AdminLayout() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState("");

  useEffect(() => {
    let active = true;

    async function resolverAvatarUrl(path) {
      if (!path) {
        setAvatarUrl("");
        return;
      }

      const { data: signedData } = await supabase.storage
        .from("avatars")
        .createSignedUrl(path, 60 * 60);

      if (!active) return;

      if (signedData?.signedUrl) {
        setAvatarUrl(signedData.signedUrl);
        return;
      }

      const { data: publicData } = supabase.storage
        .from("avatars")
        .getPublicUrl(path);
      setAvatarUrl(publicData?.publicUrl || "");
    }

    async function cargarPerfil() {
      const { data } = await supabase.auth.getUser();
      if (!active) return;

      const currentUser = data?.user || null;
      setUser(currentUser);

      if (!currentUser) return;

      const { data: profileData } = await supabase
        .from("profiles")
        .select("nombre, apellidos, avatar_path")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (!active) return;

      setProfile(profileData || null);

      await resolverAvatarUrl(profileData?.avatar_path || "");
    }

    cargarPerfil();

    return () => {
      active = false;
    };
  }, []);

  const displayName = useMemo(() => {
    const nombre = profile?.nombre || "";
    const apellidos = profile?.apellidos || "";
    return `${nombre} ${apellidos}`.trim();
  }, [profile?.nombre, profile?.apellidos]);

  useEffect(() => {
    let active = true;

    async function actualizarDesdeEvento(detail) {
      if (!detail || !active) return;
      setProfile((prev) => ({
        ...prev,
        nombre: detail.nombre ?? prev?.nombre ?? "",
        apellidos: detail.apellidos ?? prev?.apellidos ?? "",
        avatar_path: detail.avatar_path ?? prev?.avatar_path ?? "",
      }));

      if (typeof detail.avatar_path !== "undefined") {
        const { data: signedData } = await supabase.storage
          .from("avatars")
          .createSignedUrl(detail.avatar_path || "", 60 * 60);

        if (!active) return;

        if (signedData?.signedUrl) {
          setAvatarUrl(signedData.signedUrl);
        } else if (detail.avatar_path) {
          const { data: publicData } = supabase.storage
            .from("avatars")
            .getPublicUrl(detail.avatar_path);
          setAvatarUrl(publicData?.publicUrl || "");
        } else {
          setAvatarUrl("");
        }
      }
    }

    const handler = (event) => {
      actualizarDesdeEvento(event.detail);
    };

    window.addEventListener("profile-updated", handler);

    return () => {
      active = false;
      window.removeEventListener("profile-updated", handler);
    };
  }, []);

  const cerrarSesion = async () => {
    // Cierre REAL de sesión Supabase
    await supabase.auth.signOut();

    // Por si lo sigues usando para expiración custom
    localStorage.removeItem("userSession");

    setMenuOpen(false);
    navigate("/login", { replace: true });
  };

  const toggleMenu = () => setMenuOpen(!menuOpen);

  return (
    <div style={{ display: "flex", minHeight: "100vh", flexDirection: "row" }}>
      {/* NAV FIJO / DESKTOP */}
      <nav
        style={{
          width: "220px",
          height: "100vh",
          backgroundColor: "#162447",
          padding: "20px 10px",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
        }}
        className="nav-desktop"
      >
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "24px" }}>
            <div style={avatarWrapperStyle}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" style={avatarStyle} />
              ) : (
                <div style={avatarFallbackStyle}>
                  {(displayName || user?.email || "A").charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <h2 style={{ textAlign: "center", margin: "12px 0 4px" }}>Admin</h2>
            {displayName && <span style={userNameStyle}>{displayName}</span>}
          </div>
          <NavLink to="/platos" style={navLinkStyle} className="nav-link">Gestión de Platos</NavLink>
          <NavLink to="/categorias" style={navLinkStyle} className="nav-link">Gestión de Categorías</NavLink>
          <NavLink to="/perfil" style={navLinkStyle} className="nav-link">Perfil</NavLink>
        </div>

        <button onClick={cerrarSesion} style={logoutBtn}>Cerrar Sesión</button>
      </nav>

      {/* NAV MÓVIL */}
      <div className="nav-mobile" style={{ display: "none", position: "relative" }}>
        <button
          onClick={toggleMenu}
          style={{
            backgroundColor: "#162447",
            color: "#fff",
            padding: "10px 15px",
            border: "none",
            borderRadius: "6px",
            margin: "10px",
            cursor: "pointer",
          }}
        >
          ☰ Menú
        </button>

        {menuOpen && (
          <div
            style={{
              position: "absolute",
              top: "50px",
              left: "10px",
              backgroundColor: "#162447",
              borderRadius: "8px",
              padding: "10px",
              zIndex: 100,
              width: "200px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 8px" }}>
              <div style={avatarWrapperStyleSmall}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" style={avatarStyle} />
                ) : (
                  <div style={avatarFallbackStyleSmall}>
                    {(displayName || user?.email || "A").charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={userNameStyle}>{displayName || "Usuario"}</span>
              </div>
            </div>
            <NavLink to="/platos" style={navLinkStyle} className="nav-link" onClick={() => setMenuOpen(false)}>
              Gestión de Platos
            </NavLink>
            <NavLink to="/categorias" style={navLinkStyle} className="nav-link" onClick={() => setMenuOpen(false)}>
              Gestión de Categorías
            </NavLink>
            <NavLink to="/perfil" style={navLinkStyle} className="nav-link" onClick={() => setMenuOpen(false)}>
              Perfil
            </NavLink>

            <button onClick={cerrarSesion} style={{ ...logoutBtn, marginTop: "10px" }}>
              Cerrar Sesión
            </button>
          </div>
        )}
      </div>

      {/* CONTENIDO */}
      <main
        style={{
          flex: 1,
          padding: "20px",
          backgroundColor: "#f4f4f4",
          overflowY: "auto",
          height: "100vh",
        }}
      >
        <Outlet />
      </main>

      {/* RESPONSIVE */}
      <style>{`
        @media (max-width: 768px) {
          .nav-desktop { display: none; }
          .nav-mobile { display: block; }
        }
        .nav-link:hover {
          background: rgba(255,255,255,0.12);
        }
      `}</style>
    </div>
  );
}

const linkStyle = {
  display: "block",
  margin: "10px 0",
  color: "#fff",
  textDecoration: "none",
  padding: "6px 10px",
  borderRadius: "6px",
  transition: "background 0.2s",
};

const navLinkStyle = ({ isActive }) => ({
  ...linkStyle,
  backgroundColor: isActive ? "rgba(255,255,255,0.12)" : "transparent",
  borderLeft: isActive ? "3px solid #fca311" : "3px solid transparent",
});

const logoutBtn = {
  width: "100%",
  backgroundColor: "#d9534f",
  color: "#fff",
  border: "none",
  padding: "8px 0",
  borderRadius: "6px",
  cursor: "pointer",
  marginTop: "20px",
};

const avatarWrapperStyle = {
  width: "72px",
  height: "72px",
  borderRadius: "50%",
  overflow: "hidden",
  border: "2px solid rgba(255,255,255,0.2)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#1f2a44",
};

const avatarWrapperStyleSmall = {
  width: "40px",
  height: "40px",
  borderRadius: "50%",
  overflow: "hidden",
  border: "2px solid rgba(255,255,255,0.2)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#1f2a44",
};

const avatarStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const avatarFallbackStyle = {
  color: "#f3f4f6",
  fontSize: "28px",
  fontWeight: 600,
};

const avatarFallbackStyleSmall = {
  color: "#f3f4f6",
  fontSize: "16px",
  fontWeight: 600,
};

const userNameStyle = {
  color: "#e5e7eb",
  fontSize: "14px",
  textAlign: "center",
};
