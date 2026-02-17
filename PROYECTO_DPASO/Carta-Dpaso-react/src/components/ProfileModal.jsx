import { useState } from 'react'

export default function ProfileModal({ open, onClose, profile, onSave, onUploadAvatar }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', dni: '' })
  if (!open) return null

  return (
    <div className="cart-modal open">
      <div className="cart-modal-content">
        <button className="cart-close" onClick={onClose}>×</button>
        <h2>Perfil</h2>
        <input placeholder="Nombres" defaultValue={profile?.name?.split(' ')?.[0] || ''} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
        <input placeholder="Apellidos" onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
        <input placeholder="Teléfono" onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        <input placeholder="DNI" onChange={(e) => setForm((f) => ({ ...f, dni: e.target.value }))} />
        <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onUploadAvatar(e.target.files[0])} />
        <button onClick={() => onSave(form)}>Guardar perfil</button>
      </div>
    </div>
  )
}
