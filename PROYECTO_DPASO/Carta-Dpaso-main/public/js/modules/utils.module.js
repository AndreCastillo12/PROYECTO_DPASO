(function initUtilsModule(global) {
  const state = global.__DPASO_DEBUG_STATE__ || {
    initCount: 0,
    listenerCount: 0,
    timerCount: 0,
    rafCount: 0,
    setupCalls: new Map(),
    requestCounts: new Map(),
    bindings: new Map(),
    inFlightOps: new Map(),
    globalListeners: new Map(),
    lastLogAt: 0
  };
  global.__DPASO_DEBUG_STATE__ = state;

  const debugEnabled = /[?&]dpasoDebug=1\b/.test(global.location.search)
    || global.localStorage?.getItem('dpaso_debug_mode') === '1';

  function mark(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
  }

  function logSnapshot(reason = '') {
    if (!debugEnabled) return;
    const now = Date.now();
    if ((now - state.lastLogAt) < 1200) return;
    state.lastLogAt = now;
    console.info('🧭 dpaso-debug', {
      reason,
      initCount: state.initCount,
      listenerCount: state.listenerCount,
      activeTimersCount: state.timerCount,
      activeRafCount: state.rafCount,
      setups: Object.fromEntries(state.setupCalls.entries()),
      bindings: Object.fromEntries(state.bindings.entries()),
      requests: Object.fromEntries(state.requestCounts.entries()),
      inFlight: Object.fromEntries(state.inFlightOps.entries())
    });
  }


  function markInFlight(opKey = '', delta = 0) {
    if (!opKey || !Number.isFinite(delta) || delta === 0) return 0;
    const next = Math.max(0, (state.inFlightOps.get(opKey) || 0) + delta);
    if (next === 0) state.inFlightOps.delete(opKey);
    else state.inFlightOps.set(opKey, next);
    return next;
  }

  function addGlobalListener(target, id, handler, options) {
    if (!target || !id || typeof handler !== 'function') return false;
    if (state.globalListeners.has(id)) return false;
    target.addEventListener(id.split(':')[1] || id, handler, options);
    state.globalListeners.set(id, { target, handler, options });
    state.listenerCount += 1;
    mark(state.bindings, id);
    return true;
  }

  function createTimeoutController(timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error('timeout'));
    }, timeoutMs);
    return {
      signal: controller.signal,
      abort: () => controller.abort(),
      clear: () => clearTimeout(timer)
    };
  }

  async function runCriticalAction(opKey, action, {
    busySet,
    timeoutMs = 15000,
    onError,
    onFinally
  } = {}) {
    if (busySet?.has(opKey)) {
      if (debugEnabled) console.warn('⚠️ critical-op duplicate blocked', { opKey });
      return { skipped: true };
    }
    busySet?.add(opKey);
    markInFlight(opKey, 1);
    const timeoutCtrl = createTimeoutController(timeoutMs);

    try {
      return await action({ signal: timeoutCtrl.signal });
    } catch (error) {
      if (typeof onError === 'function') onError(error);
      else throw error;
      return null;
    } finally {
      timeoutCtrl.clear();
      busySet?.delete(opKey);
      markInFlight(opKey, -1);
      if (typeof onFinally === 'function') onFinally();
    }
  }

  global.DPASO_UTILS = {
    debugEnabled,
    state,
    diag: {
      markInit(name) { state.initCount += 1; mark(state.setupCalls, name); },
      markSetup(name) { mark(state.setupCalls, name); },
      markBinding(name) { mark(state.bindings, name); state.listenerCount += 1; },
      markRequest(name) { mark(state.requestCounts, name); },
      markTimer(delta = 0) { state.timerCount = Math.max(0, state.timerCount + delta); },
      markRaf(delta = 0) { state.rafCount = Math.max(0, state.rafCount + delta); },
      markInFlight(opKey, delta = 0) { return markInFlight(opKey, delta); },
      logSnapshot
    },
    addGlobalListener,
    runCriticalAction
  };
})(window);
