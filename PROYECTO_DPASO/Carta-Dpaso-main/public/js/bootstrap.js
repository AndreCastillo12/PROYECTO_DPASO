(function bootstrap(global) {
  const boot = global.__DPASO_BOOTSTRAP__ || {
    initialized: false,
    bootRuns: 0,
    startedAt: 0
  };
  global.__DPASO_BOOTSTRAP__ = boot;

  const utils = global.DPASO_UTILS;

  async function start() {
    if (boot.initialized) {
      utils?.diag?.logSnapshot('bootstrap:already-initialized');
      return;
    }

    boot.initialized = true;
    boot.bootRuns += 1;
    boot.startedAt = Date.now();
    utils?.diag?.markInit('bootstrap:start');

    const modules = global.DPASO_MODULES || {};
    modules.ui?.init?.();
    await modules.auth?.init?.();
    await modules.orders?.init?.();

    utils?.diag?.logSnapshot('bootstrap:done');
  }

  const onLoad = () => {
    start().catch((error) => {
      console.error('❌ bootstrap failure', error);
      boot.initialized = false;
      utils?.diag?.logSnapshot('bootstrap:failed');
    });
  };

  if (document.readyState === 'complete') {
    onLoad();
    return;
  }

  if (utils?.addGlobalListener) {
    utils.addGlobalListener(window, 'window:load', onLoad, { once: true });
  } else {
    window.addEventListener('load', onLoad, { once: true });
  }
})(window);
