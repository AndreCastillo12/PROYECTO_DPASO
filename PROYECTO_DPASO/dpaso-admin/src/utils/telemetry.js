const TELEMETRY_KEY = "dpaso_admin_telemetry_v1";
const MAX_EVENTS = 120;

export function readTelemetryEvents() {
  try {
    const raw = localStorage.getItem(TELEMETRY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTelemetryEvents(events) {
  localStorage.setItem(TELEMETRY_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
}

export function logTelemetryEvent({
  level = "info",
  area = "general",
  event = "event",
  message = "",
  meta = {},
  durationMs = null,
}) {
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    level,
    area,
    event,
    message,
    durationMs: Number.isFinite(durationMs) ? Number(durationMs) : null,
    meta: meta && typeof meta === "object" ? meta : {},
  };

  const next = [entry, ...readTelemetryEvents()];
  writeTelemetryEvents(next);

  const logger = level === "error" ? console.error : level === "warning" ? console.warn : console.info;
  logger("[telemetry]", entry);

  return entry;
}

export function clearTelemetryEvents() {
  localStorage.removeItem(TELEMETRY_KEY);
}

export function summarizeTelemetry(events = []) {
  const safe = Array.isArray(events) ? events : [];
  const errors = safe.filter((item) => item.level === "error").length;
  const warnings = safe.filter((item) => item.level === "warning").length;

  const rpcEvents = safe.filter((item) => Number.isFinite(Number(item.durationMs)));
  const avgRpcMs = rpcEvents.length
    ? rpcEvents.reduce((acc, item) => acc + Number(item.durationMs || 0), 0) / rpcEvents.length
    : 0;

  return {
    total: safe.length,
    errors,
    warnings,
    avgRpcMs,
  };
}
