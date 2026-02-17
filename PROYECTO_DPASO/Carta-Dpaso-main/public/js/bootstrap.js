(function bootstrap(global) {
  let initialized = false;

  async function start() {
    if (initialized) return;
    initialized = true;

    const modules = global.DPASO_MODULES || {};
    modules.ui?.init?.();
    await modules.auth?.init?.();
    await modules.orders?.init?.();
  }

  window.addEventListener('load', () => {
    start().catch((error) => {
      console.error('❌ bootstrap failure', error);
      initialized = false;
    });
  }, { once: true });
})(window);
