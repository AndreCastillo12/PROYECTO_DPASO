import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useEffect, useState } from "react";

async function recoverSession() {
  const { data: current } = await supabase.auth.getSession();
  if (current?.session) return current.session;

  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return refreshed?.session || null;
}

export default function ProtectedRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const nextSession = await recoverSession();
        if (!mounted) return;
        setSession(nextSession);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    bootstrap();

    const onWake = async () => {
      if (document.hidden) return;
      const nextSession = await recoverSession();
      if (!mounted) return;
      setSession(nextSession);
    };

    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
    });

    return () => {
      mounted = false;
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
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

  if (!session) return <Navigate to="/login" replace />;

  return children;
}
