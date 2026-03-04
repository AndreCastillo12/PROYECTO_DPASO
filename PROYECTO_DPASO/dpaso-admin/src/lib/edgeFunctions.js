import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export class EdgeFunctionError extends Error {
  constructor(message, { status = 500, code = "EDGE_FUNCTION_ERROR", detail = null } = {}) {
    super(message);
    this.name = "EdgeFunctionError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function resolveAccessToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) return session.access_token;

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !refreshed?.session?.access_token) {
    throw new EdgeFunctionError("Sesión no válida, vuelva a iniciar sesión", {
      status: 401,
      code: "SESSION_INVALID",
      detail: refreshError?.message || null,
    });
  }

  return refreshed.session.access_token;
}

export async function invokeEdge(functionName, body = {}) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new EdgeFunctionError("Faltan variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY", {
      status: 500,
      code: "MISSING_VITE_ENV",
    });
  }

  const token = await resolveAccessToken();

  supabase.functions.setAuth(token);
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
    },
  });

  if (!error) return data;

  if (error instanceof FunctionsHttpError) {
    const response = error.context;
    const status = response?.status || 500;
    const payload = await response?.json?.().catch(() => ({}));
    throw new EdgeFunctionError(payload?.error || `HTTP_${status}`, {
      status,
      code: payload?.error || "EDGE_FUNCTION_FAILED",
      detail: payload?.detail || null,
    });
  }

  throw new EdgeFunctionError(error.message || "EDGE_FUNCTION_FAILED", {
    status: 500,
    code: "EDGE_FUNCTION_FAILED",
    detail: error.message || null,
  });
}
