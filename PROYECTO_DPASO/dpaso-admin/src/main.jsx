import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import AdminLayout from "./layouts/AdminLayout";
import Platos from "./pages/Platos";
import Categorias from "./pages/Categorias";
import Perfil from "./pages/Perfil";
import Pedidos from "./pages/Pedidos";
import OrderDetail from "./pages/OrderDetail";
import Tienda from "./pages/Tienda";
import ZonasDelivery from "./pages/ZonasDelivery";
import Caja from "./pages/Caja";
import Reportes from "./pages/Reportes";
import Dashboard from "./pages/Dashboard";
import Clientes from "./pages/Clientes";
import Salon from "./pages/Salon";
import Usuarios from "./pages/Usuarios";
import Cocina from "./pages/Cocina";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import ProtectedRoute from "./components/ProtectedRoute";
import RoleRouteGuard from "./components/RoleRouteGuard";

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
    { path: "/reset-password", element: <ResetPassword /> },

  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AdminLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "perfil", element: <Perfil /> },

      { path: "pedidos", element: <RoleRouteGuard area="pedidos"><Pedidos /></RoleRouteGuard> },
      { path: "pedido-detalle", element: <RoleRouteGuard area="pedido-detalle"><OrderDetail /></RoleRouteGuard> },
      { path: "clientes", element: <RoleRouteGuard area="clientes"><Clientes /></RoleRouteGuard> },
      { path: "caja", element: <RoleRouteGuard area="caja"><Caja /></RoleRouteGuard> },
      { path: "salon", element: <RoleRouteGuard area="salon"><Salon /></RoleRouteGuard> },
      { path: "cocina", element: <RoleRouteGuard area="cocina"><Cocina /></RoleRouteGuard> },
      { path: "usuarios", element: <RoleRouteGuard area="usuarios"><Usuarios /></RoleRouteGuard> },

      { path: "reportes", element: <RoleRouteGuard area="reportes"><Reportes /></RoleRouteGuard> },
      { path: "platos", element: <RoleRouteGuard area="platos"><Platos /></RoleRouteGuard> },
      { path: "categorias", element: <RoleRouteGuard area="categorias"><Categorias /></RoleRouteGuard> },
      { path: "tienda", element: <RoleRouteGuard area="tienda"><Tienda /></RoleRouteGuard> },
      { path: "zonas-delivery", element: <RoleRouteGuard area="zonas-delivery"><ZonasDelivery /></RoleRouteGuard> },
    ],
  },

  // fallback simple por si entran a cualquier cosa
  { path: "*", element: <Login /> },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <RouterProvider router={router} />
);
