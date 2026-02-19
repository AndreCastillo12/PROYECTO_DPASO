import { supabase } from "./supabaseClient";

function toErrorMeta(error) {
  return {
    message: error?.message || String(error || ""),
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
  };
}

export async function logCriticalEvent(eventName, context, error, extra = {}) {
  try {
    await supabase.rpc("log_app_event", {
      p_event_name: eventName,
      p_level: "error",
      p_context: context,
      p_source: "admin_panel",
      p_payload: {
        ...extra,
        error: toErrorMeta(error),
      },
    });
  } catch (_) {
    // no-op: nunca romper el flujo principal por observabilidad
  }
}

export async function logOperationalMetric(eventName, payload = {}) {
  try {
    await supabase.rpc("log_app_event", {
      p_event_name: eventName,
      p_level: "info",
      p_context: "operational_metrics",
      p_source: "admin_panel",
      p_payload: payload,
    });
  } catch (_) {
    // no-op
  }
}
