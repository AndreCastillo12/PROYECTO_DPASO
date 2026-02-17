(function initAuthModule(global) {
  const app = global.DPASO_APP || {};
  let ready = false;

  async function initAuth() {
    if (ready) return;
    ready = true;
    await app.initAuth?.();
  }

  global.DPASO_MODULES = Object.assign(global.DPASO_MODULES || {}, {
    auth: { init: initAuth }
  });
})(window);
