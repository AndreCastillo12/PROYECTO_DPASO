import { Navigate } from "react-router-dom";
import useAdminRole from "../hooks/useAdminRole";

export default function RoleRouteGuard({ area, children }) {
  const { loadingRole, canAccess } = useAdminRole();

  if (loadingRole) return <p>Cargando permisos...</p>;
  if (!canAccess(area)) return <Navigate to="/dashboard" replace />;

  return children;
}
