import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const DEFAULT_ROLE = "admin";

const ROLE_ALLOWED_AREAS = {
  admin: ["*"],
  cajero: ["dashboard", "pedidos", "pedido-detalle", "caja", "reportes"],
  mozo: ["dashboard", "salon", "cocina", "pedidos", "pedido-detalle"],
  cocina: ["dashboard", "cocina"],
};

function resolveRoleFromUser(user) {
  const claimRole = user?.app_metadata?.admin_role || user?.user_metadata?.admin_role;
  return String(claimRole || "").trim().toLowerCase();
}

export default function useAdminRole() {
  const [role, setRole] = useState(DEFAULT_ROLE);
  const [loadingRole, setLoadingRole] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadRole() {
      setLoadingRole(true);
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user || null;
      const claimRole = resolveRoleFromUser(user);
      if (claimRole && ROLE_ALLOWED_AREAS[claimRole]) {
        if (mounted) {
          setRole(claimRole);
          setLoadingRole(false);
        }
        return;
      }

      if (!user?.id) {
        if (mounted) {
          setRole(DEFAULT_ROLE);
          setLoadingRole(false);
        }
        return;
      }

      const { data: roleData } = await supabase
        .from("admin_panel_user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      const dbRole = String(roleData?.role || "").trim().toLowerCase();
      if (mounted) {
        setRole(ROLE_ALLOWED_AREAS[dbRole] ? dbRole : DEFAULT_ROLE);
        setLoadingRole(false);
      }
    }

    loadRole();
    return () => {
      mounted = false;
    };
  }, []);

  const api = useMemo(() => ({
    role,
    loadingRole,
    canAccess: (area) => {
      const allowed = ROLE_ALLOWED_AREAS[role] || ROLE_ALLOWED_AREAS[DEFAULT_ROLE];
      return allowed.includes("*") || allowed.includes(area);
    },
    isOneOf: (roles) => roles.includes(role),
  }), [loadingRole, role]);

  return api;
}
