import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import AdminLayout from "./layouts/AdminLayout";
import Dashboard from "./pages/Dashboard";
import Platos from "./pages/Platos";
import Categorias from "./pages/Categorias";
import Perfil from "./pages/Perfil";
import Pedidos from "./pages/Pedidos";
import Tienda from "./pages/Tienda";
import ZonasDelivery from "./pages/ZonasDelivery";
import Caja from "./pages/Caja";
import Reportes from "./pages/Reportes";
import Clientes from "./pages/Clientes";
import EstadoOperativo from "./pages/EstadoOperativo";
import Observabilidad from "./pages/Observabilidad";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import ProtectedRoute from "./components/ProtectedRoute";

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
      { index: true, element: <Dashboard /> },   // / -> dashboard
      { path: "dashboard", element: <Dashboard /> }, // /dashboard
      { path: "platos", element: <Platos /> }, // /platos
      { path: "categorias", element: <Categorias /> }, // /categorias
      { path: "perfil", element: <Perfil /> }, // /perfil
      { path: "pedidos", element: <Pedidos /> }, // /pedidos
      { path: "tienda", element: <Tienda /> }, // /tienda
      { path: "zonas-delivery", element: <ZonasDelivery /> }, // /zonas-delivery
      { path: "caja", element: <Caja /> }, // /caja
      { path: "reportes", element: <Reportes /> }, // /reportes
      { path: "clientes", element: <Clientes /> }, // /clientes
      { path: "estado-operativo", element: <EstadoOperativo /> }, // /estado-operativo
      { path: "observabilidad", element: <Observabilidad /> }, // /observabilidad
    ],
  },

  // fallback simple por si entran a cualquier cosa
  { path: "*", element: <Login /> },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <RouterProvider router={router} />
);
