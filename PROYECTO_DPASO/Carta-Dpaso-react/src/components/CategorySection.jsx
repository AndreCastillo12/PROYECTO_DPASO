import DishCard from './DishCard'

export default function CategorySection({ category, items, onAdd }) {
  if (!items.length) return null
  return (
    <section className="menu-category">
      <h2 className="section-title">{category.nombre}</h2>
      <div className="menu-row">
        {items.map((item) => <DishCard key={item.id} item={item} onAdd={onAdd} />)}
      </div>
    </section>
  )
}
