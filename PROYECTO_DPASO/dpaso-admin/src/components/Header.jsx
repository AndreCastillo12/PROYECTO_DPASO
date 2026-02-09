import { supabase } from "../lib/supabaseClient"

export default function Header() {
  return (
    <header className="header">
      <span>Panel Administrativo</span>
      <button onClick={() => supabase.auth.signOut()}>
        Cerrar sesión
      </button>
    </header>
  )
}
