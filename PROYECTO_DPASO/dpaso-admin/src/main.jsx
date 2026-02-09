import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import AdminLayout from "./layouts/AdminLayout";
import Platos from "./pages/Platos";
import Categorias from "./pages/Categorias";
import Perfil from "./pages/Perfil";
import Login from "./pages/Login";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AdminLayout />,
    children: [
      { path: "platos", element: <Platos /> },
      { path: "categorias", element: <Categorias /> },
      { path: "perfil", element: <Perfil /> },
      { index: true, element: <Platos /> },
    ],
  },
  { path: "/login", element: <Login /> },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <RouterProvider router={router} />
);
