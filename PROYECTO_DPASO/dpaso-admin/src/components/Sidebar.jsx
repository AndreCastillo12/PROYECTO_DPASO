import { NavLink } from "react-router-dom"

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <h2>DPASO</h2>
      <nav>
        <NavLink to="/">Dashboard</NavLink>
        <NavLink to="/categorias">Categorías</NavLink>
      </nav>
    </aside>
  )
}
