export default function OrdersModal({ open, onClose, orders, onRefresh, loading, error }) {
  if (!open) return null
  return (
    <div className="cart-modal open">
      <div className="cart-modal-content">
        <button className="cart-close" onClick={onClose}>×</button>
        <h2>Mis pedidos</h2>
        <button onClick={onRefresh} disabled={loading}>Actualizar</button>
        {error ? <p className="tracking-error">{error}</p> : null}
        <div className="tracking-result">
          {orders.map((o) => <div key={o.id}><strong>{o.short_code || o.id}</strong> · {o.estado} · S/ {Number(o.total || 0).toFixed(2)}</div>)}
          {!orders.length && !loading ? <p>No tienes pedidos registrados todavía.</p> : null}
        </div>
      </div>
    </div>
  )
}
