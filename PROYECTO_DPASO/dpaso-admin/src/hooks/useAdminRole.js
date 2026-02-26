import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export const DEFAULT_ROLE = "none";
export const VALID_ROLES = ["admin", "cajero", "mozo", "cocina"];

export const ROLE_ALLOWED_AREAS = {
  none: [],
  admin: ["*"],
  cajero: ["dashboard", "pedidos", "pedido-detalle", "clientes", "caja", "reportes"],
  mozo: ["dashboard", "pedidos", "pedido-detalle", "salon", "cocina"],
  cocina: ["dashboard", "cocina"],
};

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return VALID_ROLES.includes(role) ? role : DEFAULT_ROLE;
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

      if (mounted) {
        setRole(normalizeRole(roleData?.role));
        setLoadingRole(false);
      }
    }

    loadRole();

    return () => {
      mounted = false;
    };
  }, []);

  return useMemo(() => {
    const allowed = ROLE_ALLOWED_AREAS[role] || ROLE_ALLOWED_AREAS[DEFAULT_ROLE];

    return {
      role,
      loadingRole,
      canAccess: (area) => allowed.includes("*") || allowed.includes(area),
      isOneOf: (roles) => roles.includes(role),
    };
  }, [loadingRole, role]);
}
