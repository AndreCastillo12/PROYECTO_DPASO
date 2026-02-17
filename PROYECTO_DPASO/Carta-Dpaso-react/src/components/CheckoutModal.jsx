import { useState } from 'react'

export default function CheckoutModal({ open, onClose, onSubmit, busy }) {
  const [form, setForm] = useState({ nombre: '', telefono: '', modalidad: 'Delivery', direccion: '', referencia: '', comentario: '' })
  if (!open) return null

  return (
    <div className="cart-modal open" aria-hidden="false">
      <div className="cart-modal-content">
        <button className="cart-close" onClick={onClose}>×</button>
        <h2>Completa tus datos</h2>
        <form className="checkout-form" onSubmit={(e) => { e.preventDefault(); onSubmit(form) }}>
          <label>Nombre *</label><input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
          <label>Teléfono *</label><input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} required />
          <label>Modalidad *</label>
          <select value={form.modalidad} onChange={(e) => setForm({ ...form, modalidad: e.target.value })}><option>Delivery</option><option>Recojo</option></select>
          <label>Dirección</label><input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
          <label>Referencia</label><input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} />
          <label>Comentario</label><textarea value={form.comentario} onChange={(e) => setForm({ ...form, comentario: e.target.value })} />
          <button id="confirm-order-btn" className="checkout-confirm" type="submit" disabled={busy}>{busy ? 'Creando pedido...' : 'Confirmar pedido'}</button>
        </form>
      </div>
    </div>
  )
}
