export default function Topbar({ search, setSearch, onOpenCart, onOpenAccount }) {
  return (
    <header className="dpaso-shell">
      <div className="dpaso-topbar">
        <img src="/images/Logos/logo.jpg" className="logo" alt="Logo DPASO" />
        <div className="brand-copy"><strong>DPASO</strong><small>Cocina Libre</small></div>
        <form className="dpaso-search-wrap" onSubmit={(e) => e.preventDefault()}>
          <input id="menuSearchInput" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Busca tu plato" />
        </form>
        <div className="dpaso-actions">
          <button id="nav-account-btn" className="nav-action-btn" onClick={onOpenAccount}>Mi cuenta</button>
          <button id="nav-cart-btn" className="nav-action-btn nav-cart-btn" onClick={onOpenCart}>Carrito</button>
        </div>
      </div>
    </header>
  )
}
