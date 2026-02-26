import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useEffect, useState } from "react";

export default function ProtectedRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function validateSession() {
      const [{ data: sessionData }, { data: authData }] = await Promise.all([
        supabase.auth.getSession(),
        supabase.auth.getUser(),
      ]);

      if (!mounted) return;

      const nextSession = sessionData?.session || null;
      setSession(nextSession);

      if (!nextSession || !authData?.user?.id) {
        setLoading(false);
        return;
      }

      const { data: roleData } = await supabase
        .from("admin_panel_user_roles")
        .select("role")
        .eq("user_id", authData.user.id)
        .maybeSingle();

      if (!mounted) return;

      const normalizedRole = String(roleData?.role || "").trim().toLowerCase();
      const authorized = ["admin", "cajero", "mozo", "cocina"].includes(normalizedRole);

      if (!authorized) {
        await supabase.auth.signOut();
        localStorage.removeItem("userSession");
        setForbidden(true);
      }

      setLoading(false);
    }

    validateSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 20 }}>
        <p>Cargando sesión...</p>
      </div>
    );
  }

  if (forbidden) return <Navigate to="/login?reason=unauthorized" replace />;
  if (!session) return <Navigate to="/login" replace />;

  return children;
}
