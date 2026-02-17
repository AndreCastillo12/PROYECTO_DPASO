export default function DishCard({ item, onAdd }) {
  const soldOut = item.is_available === false || (item.track_stock === true && Number(item.stock ?? 0) <= 0)
  const imageUrl = item.imagen ? `https://gtczpfxdkiajprnluokq.supabase.co/storage/v1/object/public/platos/${item.imagen}` : '/images/Logos/logo.jpg'

  return (
    <article className="plato fade-up">
      <img src={imageUrl} alt={item.nombre} />
      <h3>{item.nombre}</h3>
      <p>{item.descripcion || ''}</p>
      <span>S/ {Number(item.precio || 0).toFixed(2)}</span>
      <button className="plato-add-mini" type="button" disabled={soldOut} onClick={() => onAdd({ ...item, imagen: imageUrl })}>＋ Agregar</button>
      {soldOut ? <span className="sold-out-badge">Agotado</span> : null}
    </article>
  )
}
