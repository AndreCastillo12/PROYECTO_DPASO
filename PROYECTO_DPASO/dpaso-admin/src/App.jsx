import { Routes, Route } from "react-router-dom"
import Login from "./pages/Login"
import Dashboard from "./pages/Dashboard"
import Categorias from "./pages/Categorias"
import ProtectedRoute from "./components/ProtectedRoute"
import AdminLayout from "./layouts/AdminLayout"

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="categorias" element={<Categorias />} />
      </Route>
    </Routes>
  )
}
