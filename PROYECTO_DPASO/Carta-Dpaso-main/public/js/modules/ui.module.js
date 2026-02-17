(function initUiModule(global) {
  const app = global.DPASO_APP || {};
  let ready = false;

  function initUi() {
    if (ready) return;
    ready = true;
    app.setupCartModalEvents?.();
    app.setupTrackingEvents?.();
    app.setupTopbarShortcuts?.();
    app.setupMenuSearch?.();

    const platoModal = document.getElementById('platoModal');
    document.getElementById('platoModalClose')?.addEventListener('click', app.closePlatoModal || (() => {}));
    platoModal?.addEventListener('click', (e) => {
      if (e.target === platoModal) (app.closePlatoModal || (() => {}))();
    });
  }

  global.DPASO_MODULES = Object.assign(global.DPASO_MODULES || {}, {
    ui: { init: initUi }
  });
})(window);
