(function initCriticalModule(global) {
  function buildTimeoutError(message = 'La operación tardó demasiado.') {
    const error = new Error(message);
    error.name = 'TimeoutError';
    error.code = 'REQUEST_TIMEOUT';
    return error;
  }

  function logCriticalOpResult(name, startedAt, status, error = null) {
    const durationMs = Math.round(performance.now() - startedAt);
    const payload = { operation: name, status, durationMs };

    if (error) {
      payload.error = {
        message: error?.message || String(error),
        details: error?.details,
        hint: error?.hint,
        stack: error?.stack,
        status: error?.status,
        code: error?.code
      };
      console.error('⛔ critical-op', payload);
      return;
    }

    console.info('✅ critical-op', payload);
  }

  async function runMeasuredOperation(name, action, {
    timeoutMs = 12000,
    timeoutMessage = 'La operación tardó demasiado. Intenta nuevamente.'
  } = {}) {
    const startedAt = performance.now();
    const controller = new AbortController();
    let timeoutId = null;
    let timedOut = false;

    timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort(buildTimeoutError(timeoutMessage));
    }, timeoutMs);

    try {
      const result = await action({ signal: controller.signal });
      logCriticalOpResult(name, startedAt, 'ok');
      return result;
    } catch (error) {
      const finalError = timedOut ? buildTimeoutError(timeoutMessage) : error;
      logCriticalOpResult(name, startedAt, 'error', finalError);
      throw finalError;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  global.DPASO_CRITICAL = {
    buildTimeoutError,
    logCriticalOpResult,
    runMeasuredOperation
  };
})(window);
