import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FiBarChart2,
  FiBox,
  FiCalendar,
  FiClock,
  FiGrid,
  FiList,
  FiLogOut,
  FiMapPin,
  FiMenu,
  FiSearch,
  FiSettings,
  FiShoppingBag,
  FiUser,
  FiUsers,
  FiX,
  FiFileText,
} from "react-icons/fi";

import { supabase } from "../lib/supabaseClient";
import useIdleLogout, { IDLE_LOGOUT_DEFAULT_MS } from "../hooks/useIdleLogout";
import "../styles/admin-shell.css";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: FiGrid },
  { to: "/pedidos", label: "Lista pedidos", icon: FiShoppingBag },
  { to: "/pedido-detalle", label: "Detalle pedido", icon: FiFileText },
  { to: "/clientes", label: "Clientes", icon: FiUsers },
  { to: "/caja", label: "Caja", icon: FiBox },
  { to: "/reportes", label: "Reportes", icon: FiBarChart2 },
  { to: "/platos", label: "Platos", icon: FiList },
  { to: "/categorias", label: "Categorías", icon: FiSettings },
  { to: "/tienda", label: "Horarios", icon: FiClock },
  { to: "/zonas-delivery", label: "Zonas", icon: FiMapPin },
  { to: "/perfil", label: "Perfil", icon: FiUser },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const profileMenuRef = useRef(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
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

      if (!profileData?.avatar_path) {
        setAvatarUrl("");
        return;
      }

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
    }

    cargarPerfil();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onOutside(event) {
      if (!profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const displayName = useMemo(() => {
    const nombre = profile?.nombre || "";
    const apellidos = profile?.apellidos || "";
    return `${nombre} ${apellidos}`.trim();
  }, [profile?.nombre, profile?.apellidos]);

  const cerrarSesion = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("userSession");
    setMenuOpen(false);
    setProfileMenuOpen(false);
    navigate("/login", { replace: true });
  };

  useIdleLogout({
    enabled: true,
    timeoutMs: IDLE_LOGOUT_DEFAULT_MS,
    onIdleLogout: () => {
      localStorage.removeItem("userSession");
      setMenuOpen(false);
      setProfileMenuOpen(false);
      navigate("/login", { replace: true });
    },
  });

  const openProfile = () => {
    setProfileMenuOpen(false);
    navigate("/perfil");
  };

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${menuOpen ? "is-open" : ""}`}>
        <div>
          <div className="admin-brand">
            <div className="admin-brand-logo">D</div>
            <div>
              <h1>DPASO</h1>
              <p>Panel administrativo</p>
            </div>
          </div>

          <nav className="admin-nav" aria-label="Navegación principal">
            {NAV_ITEMS.map((item) => {
              const IconComponent = item.icon;
              return (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `admin-nav-link ${isActive ? "is-active" : ""}`} onClick={() => setMenuOpen(false)}>
                  <IconComponent size={16} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <button onClick={cerrarSesion} className="admin-logout-btn" type="button">
          <FiLogOut size={16} /> Cerrar sesión
        </button>
      </aside>

      {menuOpen ? <button type="button" aria-label="Cerrar menú" className="admin-backdrop" onClick={() => setMenuOpen(false)} /> : null}

      <section className="admin-content-area">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button className="admin-menu-btn" onClick={() => setMenuOpen((prev) => !prev)} type="button" aria-label="Abrir menú">
              {menuOpen ? <FiX size={18} /> : <FiMenu size={18} />}
            </button>
            <div className="admin-search-shell" role="search">
              <FiSearch size={16} />
              <input type="search" placeholder="Buscar aquí" aria-label="Buscar" />
            </div>
          </div>

          <div className="admin-topbar-right">
            <button className="admin-icon-btn" type="button" aria-label="Calendario"><FiCalendar size={15} /></button>
            <button className="admin-icon-btn" type="button" aria-label="Métricas"><FiBarChart2 size={15} /></button>

            <div className="admin-profile-menu" ref={profileMenuRef}>
              <button className="admin-user-pill" type="button" onClick={() => setProfileMenuOpen((prev) => !prev)} aria-expanded={profileMenuOpen}>
                <div className="admin-avatar-sm">
                  {avatarUrl ? <img src={avatarUrl} alt="Avatar" /> : <span>{(displayName || user?.email || "A").charAt(0).toUpperCase()}</span>}
                </div>
                <div>
                  <small>Hola</small>
                  <strong>{displayName || "Admin Dpaso"}</strong>
                </div>
              </button>

              {profileMenuOpen ? (
                <div className="admin-profile-dropdown">
                  <button type="button" onClick={openProfile}>Editar perfil</button>
                  <button type="button" onClick={cerrarSesion}>Cerrar sesión</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="admin-page-wrap">
          <Outlet />
        </main>
      </section>
    </div>
  );
}
