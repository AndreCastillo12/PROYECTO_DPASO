import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AdminLayout() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

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
          <h2 style={{ textAlign: "center", marginBottom: "30px" }}>Admin</h2>
          <NavLink to="/platos" style={linkStyle}>Gestión de Platos</NavLink>
          <NavLink to="/categorias" style={linkStyle}>Gestión de Categorías</NavLink>
          <NavLink to="/perfil" style={linkStyle}>Perfil</NavLink>
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
