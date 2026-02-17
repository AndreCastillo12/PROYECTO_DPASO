import { useMemo } from 'react'

export default function CartModal({ open, items, onClose, onQty, onDelete, onCheckout }) {
  const total = useMemo(() => items.reduce((acc, i) => acc + (Number(i.precio || 0) * Number(i.cantidad || 0)), 0), [items])
  if (!open) return null
  return (
    <div className="cart-modal open" aria-hidden="false">
      <div className="cart-modal-content">
        <button id="cart-close-btn" className="cart-close" onClick={onClose}>×</button>
        <h2>Tu pedido</h2>
        <div className="cart-items">
          {items.length === 0 ? <p className="cart-empty">Tu carrito está vacío.</p> : items.map((item) => (
            <div className="cart-item" key={item.id}>
              <img src={item.imagen} alt={item.nombre} />
              <div className="cart-item-data">
                <h4>{item.nombre}</h4>
                <p>S/ {Number(item.precio || 0).toFixed(2)}</p>
                <div className="cart-item-actions">
                  <button onClick={() => onQty(item.id, -1)}>-</button>
                  <span>{item.cantidad}</span>
                  <button onClick={() => onQty(item.id, 1)}>+</button>
                  <button className="danger" onClick={() => onDelete(item.id)}>Eliminar</button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="cart-total-row cart-total-final"><strong>Total final:</strong><strong>S/ {total.toFixed(2)}</strong></div>
        <button id="go-checkout-btn" className="go-checkout-btn" onClick={onCheckout} disabled={!items.length}>Continuar con tus datos</button>
      </div>
    </div>
  )
}
