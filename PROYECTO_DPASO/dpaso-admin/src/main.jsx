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
      { path: "platos", element: <Platos /> }, // /platos
      { path: "categorias", element: <Categorias /> }, // /categorias
      { path: "perfil", element: <Perfil /> }, // /perfil
      { path: "pedidos", element: <Pedidos /> }, // /pedidos
      { path: "pedido-detalle", element: <OrderDetail /> }, // /pedido-detalle
      { path: "tienda", element: <Tienda /> }, // /tienda
      { path: "zonas-delivery", element: <ZonasDelivery /> }, // /zonas-delivery
      { path: "caja", element: <Caja /> }, // /caja
      { path: "dashboard", element: <Dashboard /> }, // /dashboard
      { path: "reportes", element: <Reportes /> }, // /reportes
      { path: "clientes", element: <Clientes /> }, // /clientes
      { path: "usuarios", element: <Usuarios /> }, // /usuarios
      { path: "salon", element: <Salon /> }, // /salon
      { path: "cocina", element: <Cocina /> }, // /cocina
    ],
  },

  // fallback simple por si entran a cualquier cosa
  { path: "*", element: <Login /> },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <RouterProvider router={router} />
);
