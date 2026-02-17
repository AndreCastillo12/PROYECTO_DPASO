(function initCriticalModule(global) {
  const utils = global.DPASO_UTILS || null;
  const localInFlight = new Map();

  function buildTimeoutError(message = 'La operación tardó demasiado.') {
    const error = new Error(message);
    error.name = 'TimeoutError';
    error.code = 'REQUEST_TIMEOUT';
    return error;
  }

  function isTransientRequestError(error) {
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('network')
      || message.includes('fetch')
      || message.includes('timeout')
      || message.includes('timed out')
      || message.includes('connection')
      || message.includes('abort')
    );
  }

  function markInFlight(name = '', delta = 0) {
    if (!name || !Number.isFinite(delta) || delta === 0) return 0;
    if (utils?.diag?.markInFlight) return utils.diag.markInFlight(name, delta);

    const next = Math.max(0, (localInFlight.get(name) || 0) + delta);
    if (next === 0) localInFlight.delete(name);
    else localInFlight.set(name, next);
    return next;
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

    if (utils?.debugEnabled) console.info('✅ critical-op', payload);
  }

  async function runMeasuredOperation(name, action, {
    timeoutMs = 12000,
    timeoutMessage = 'La operación tardó demasiado. Intenta nuevamente.',
    retries = 1
  } = {}) {
    const startedAt = performance.now();
    const attemptsLimit = Math.max(0, Math.min(1, Number(retries) || 0));
    let attempt = 0;
    let lastError = null;

    while (attempt <= attemptsLimit) {
      const controller = new AbortController();
      let timeoutId = null;
      let timedOut = false;

      const active = markInFlight(name, 1);
      if (active > 1) {
        console.warn('⚠️ critical-op concurrent duplicate', { operation: name, active });
      }

      timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort(buildTimeoutError(timeoutMessage));
      }, timeoutMs);

      try {
        const result = await action({ signal: controller.signal, attempt });
        logCriticalOpResult(name, startedAt, attempt > 0 ? 'ok-after-retry' : 'ok');
        return result;
      } catch (error) {
        const finalError = timedOut ? buildTimeoutError(timeoutMessage) : error;
        lastError = finalError;
        const canRetry = attempt < attemptsLimit && isTransientRequestError(finalError);
        if (!canRetry) {
          logCriticalOpResult(name, startedAt, 'error', finalError);
          throw finalError;
        }
        if (utils?.debugEnabled) {
          console.warn('⚠️ critical-op retrying transient error', {
            operation: name,
            attempt,
            message: finalError?.message || String(finalError)
          });
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        markInFlight(name, -1);
      }

      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw lastError || buildTimeoutError(timeoutMessage);
  }

  global.DPASO_CRITICAL = {
    buildTimeoutError,
    logCriticalOpResult,
    runMeasuredOperation,
    isTransientRequestError
  };
})(window);
