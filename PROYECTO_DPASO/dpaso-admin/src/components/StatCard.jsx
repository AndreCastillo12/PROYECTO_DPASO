export default function StatCard({ title, value }) {
  return (
    <div className="stat-card">
      <strong>{title}</strong>
      <span>{value}</span>
    </div>
  )
}
