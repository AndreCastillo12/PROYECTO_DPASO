import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import useIdleLogout, { IDLE_LOGOUT_DEFAULT_MS } from "../hooks/useIdleLogout";

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

  useIdleLogout({
    enabled: true,
    timeoutMs: IDLE_LOGOUT_DEFAULT_MS,
    onIdleLogout: () => {
      localStorage.removeItem("userSession");
      setMenuOpen(false);
      navigate("/login", { replace: true });
    }
  });

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
          <NavLink to="/dashboard" style={({ isActive }) => linkStyle(isActive)}>Dashboard</NavLink>
          <NavLink to="/platos" style={({ isActive }) => linkStyle(isActive)}>Gestión de Platos</NavLink>
          <NavLink to="/categorias" style={({ isActive }) => linkStyle(isActive)}>Gestión de Categorías</NavLink>
          <NavLink to="/pedidos" style={({ isActive }) => linkStyle(isActive)}>Pedidos</NavLink>
          <NavLink to="/clientes" style={({ isActive }) => linkStyle(isActive)}>Clientes</NavLink>
          <NavLink to="/tienda" style={({ isActive }) => linkStyle(isActive)}>Horarios de atención</NavLink>
          <NavLink to="/zonas-delivery" style={({ isActive }) => linkStyle(isActive)}>Zonas delivery</NavLink>
          <NavLink to="/caja" style={({ isActive }) => linkStyle(isActive)}>Caja</NavLink>
          <NavLink to="/reportes" style={({ isActive }) => linkStyle(isActive)}>Reportes</NavLink>
          <NavLink to="/perfil" style={({ isActive }) => linkStyle(isActive)}>Perfil</NavLink>
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
            <NavLink to="/dashboard" style={({ isActive }) => linkStyle(isActive)} onClick={() => setMenuOpen(false)}>
              Dashboard
            </NavLink>
            <NavLink to="/platos" style={({ isActive }) => linkStyle(isActive)} onClick={() => setMenuOpen(false)}>
              Gestión de Platos
            </NavLink>
            <NavLink to="/categorias" style={({ isActive }) => linkStyle(isActive)} onClick={() => setMenuOpen(false)}>
              Gestión de Categorías
            </NavLink>
            <NavLink to="/pedidos" style={({ isActive }) => linkStyle(isActive)} onClick={() => setMenuOpen(false)}>
              Pedidos
            </NavLink>
            <NavLink to="/clientes" style={({ isActive }) => linkStyle(isActive)} onClick={() => setMenuOpen(false)}>
              Clientes
            </NavLink>
            <NavLink to="/tienda" style={({ isActive }) => linkStyle(isActive)} onClick={() => setMenuOpen(false)}>
              Horarios de atención
            </NavLink>
            <NavLink to="/zonas-delivery" style={({ isActive }) => linkStyle(isActive)} onClick={() => setMenuOpen(false)}>
              Zonas delivery
            </NavLink>
            <NavLink to="/caja" style={({ isActive }) => linkStyle(isActive)} onClick={() => setMenuOpen(false)}>
              Caja
            </NavLink>
            <NavLink to="/reportes" style={({ isActive }) => linkStyle(isActive)} onClick={() => setMenuOpen(false)}>
              Reportes
            </NavLink>
            <NavLink to="/perfil" style={({ isActive }) => linkStyle(isActive)} onClick={() => setMenuOpen(false)}>
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
      `}</style>
    </div>
  );
}

const linkStyle = (isActive) => ({
  display: "block",
  margin: "10px 0",
  color: "#fff",
  textDecoration: "none",
  padding: "8px 10px",
  borderRadius: "8px",
  transition: "all 0.2s",
  background: isActive ? "linear-gradient(135deg, #2f4f80, #3c5f97)" : "transparent",
  boxShadow: isActive ? "0 8px 20px rgba(0,0,0,.18)" : "none",
  border: isActive ? "1px solid rgba(255,255,255,.18)" : "1px solid transparent",
  fontWeight: isActive ? 700 : 500,
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