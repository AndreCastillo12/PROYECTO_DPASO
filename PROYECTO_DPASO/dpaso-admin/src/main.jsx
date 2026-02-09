import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import AdminLayout from "./layouts/AdminLayout";
import Platos from "./pages/Platos";
import Categorias from "./pages/Categorias";
import Perfil from "./pages/Perfil";
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
      { index: true, element: <Platos /> },   // / -> platos
      { path: "platos", element: <Platos /> }, // /platos
      { path: "categorias", element: <Categorias /> }, // /categorias
      { path: "perfil", element: <Perfil /> }, // /perfil
    ],
  },

  // fallback simple por si entran a cualquier cosa
  { path: "*", element: <Login /> },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <RouterProvider router={router} />
);
