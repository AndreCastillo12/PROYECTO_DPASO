(function initOrdersModule(global) {
  const app = global.DPASO_APP || {};
  let ready = false;

  async function initOrders() {
    if (ready) return;
    ready = true;
    await app.bootstrapAppCore?.();
  }

  global.DPASO_MODULES = Object.assign(global.DPASO_MODULES || {}, {
    orders: { init: initOrders }
  });
})(window);
