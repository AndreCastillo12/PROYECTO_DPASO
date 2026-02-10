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

      if (profileData?.avatar_path) {
        const { data: signedData } = await supabase.storage
          .from("avatars")
          .createSignedUrl(profileData.avatar_path, 60 * 60);

        if (!active) return;

        if (signedData?.signedUrl) {
          setAvatarUrl(signedData.signedUrl);
        } else {
          const { data: publicData } = supabase.storage
            .from("avatars")
            .getPublicUrl(profileData.avatar_path);
          setAvatarUrl(publicData?.publicUrl || "");
        }
      } else {
        setAvatarUrl("");
      }
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
    <div className="admin-shell" style={{ display: "flex", minHeight: "100vh" }}>
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
          <NavLink to="/platos" style={linkStyle}>Gestión de Platos</NavLink>
          <NavLink to="/categorias" style={linkStyle}>Gestión de Categorías</NavLink>
          <NavLink to="/perfil" style={linkStyle}>Perfil</NavLink>
        </div>

        <button onClick={cerrarSesion} style={logoutBtn}>Cerrar Sesión</button>
      </nav>

      {/* NAV MÓVIL */}
      <div className="nav-mobile" style={{ display: "none", position: "relative" }}>
        <button
          className="mobile-menu-trigger"
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
            className="mobile-menu-panel"
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
            <NavLink to="/platos" style={linkStyle} onClick={() => setMenuOpen(false)}>
              Gestión de Platos
            </NavLink>
            <NavLink to="/categorias" style={linkStyle} onClick={() => setMenuOpen(false)}>
              Gestión de Categorías
            </NavLink>
            <NavLink to="/perfil" style={linkStyle} onClick={() => setMenuOpen(false)}>
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
        className="admin-main"
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
          .admin-shell {
            flex-direction: column !important;
            width: 100%;
            max-width: 100%;
            margin: 0;
          }

          .nav-desktop {
            display: none !important;
            width: 0 !important;
            min-width: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
          }

          .nav-mobile {
            display: block !important;
            position: sticky !important;
            top: 0;
            z-index: 120;
            background: #f4f4f4;
            padding: 8px 10px;
            width: 100%;
            box-sizing: border-box;
            flex: 0 0 auto;
          }

          .mobile-menu-trigger {
            margin: 0 !important;
          }

          .mobile-menu-panel {
            width: min(92vw, 260px) !important;
            left: 0 !important;
            top: 46px !important;
          }

          .admin-main {
            width: 100%;
            max-width: 100%;
            flex: 1 1 auto;
            height: auto !important;
            min-height: calc(100vh - 64px);
            padding: 10px !important;
            margin: 0;
            overflow-x: hidden;
          }

          .admin-main > * {
            max-width: 100%;
          }
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
