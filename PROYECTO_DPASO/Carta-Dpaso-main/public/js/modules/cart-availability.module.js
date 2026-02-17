(function initCartAvailabilityModule(global) {
  function hasUnlimitedStock(plato) {
    if (!plato || plato.track_stock !== true) return true;
    const rawStock = plato.stock;
    if (rawStock == null) return true;
    if (typeof rawStock === 'string' && ['ilimitado', 'infinito', 'infinite', 'unlimited'].includes(rawStock.trim().toLowerCase())) {
      return true;
    }
    return false;
  }

  function isPlatoSoldOut(plato) {
    if (!plato) return false;
    if (plato.is_available === false) return true;
    if (plato.track_stock !== true) return false;
    if (hasUnlimitedStock(plato)) return false;
    const stock = Number(plato.stock);
    if (!Number.isFinite(stock)) return false;
    return stock <= 0;
  }

  function getPlatoAvailabilityMessage(plato, cartAvailabilityState = 'idle') {
    if (!plato) {
      return cartAvailabilityState === 'loading' ? 'Validando disponibilidad...' : '';
    }
    if (plato.is_available === false) return 'No disponible por el momento';
    if (plato.track_stock === true && !hasUnlimitedStock(plato)) {
      const stock = Number(plato.stock);
      if (Number.isFinite(stock) && stock <= 0) return 'Agotado';
    }
    return '';
  }

  global.DPASO_CART_AVAIL = {
    hasUnlimitedStock,
    isPlatoSoldOut,
    getPlatoAvailabilityMessage
  };
})(window);
