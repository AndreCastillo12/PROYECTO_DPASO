import { useState } from 'react'

export default function AccountModal({ open, onClose, onLogin, onRegister, onGoogle, onOpenOrders, onOpenProfile, loading, error, session, onLogout }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  if (!open) return null

  return (
    <div className="auth-screen open" aria-hidden="false">
      <div className="auth-screen-layout">
        <section className="auth-side-form">
          <button id="authCloseBtn" className="auth-close-icon" onClick={onClose}>✕</button>
          <h3>Mi cuenta</h3>
          {!session?.user ? (
            <>
              <input placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input placeholder="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button onClick={() => onLogin(email, password)} disabled={loading}>Ingresar</button>
              <button onClick={() => onRegister(email, password)} disabled={loading}>Crear cuenta</button>
              <button onClick={onGoogle} disabled={loading}>Ingresar con Google</button>
            </>
          ) : (
            <>
              <button onClick={onOpenOrders}>Mis pedidos</button>
              <button onClick={onOpenProfile}>Editar perfil</button>
              <button onClick={onLogout} disabled={loading}>Cerrar sesión</button>
            </>
          )}
          {error ? <p className="tracking-error">{error}</p> : null}
        </section>
      </div>
    </div>
  )
}
