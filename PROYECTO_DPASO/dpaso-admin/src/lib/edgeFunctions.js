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

export async function invokeEdge(functionName, body = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    throw new EdgeFunctionError("Sesión no válida, vuelva a iniciar sesión", {
      status: 401,
      code: "SESSION_INVALID",
    });
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new EdgeFunctionError("Faltan variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY", {
      status: 500,
      code: "MISSING_VITE_ENV",
    });
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new EdgeFunctionError(payload?.error || `HTTP_${response.status}`, {
      status: response.status,
      code: payload?.error || "EDGE_FUNCTION_FAILED",
      detail: payload?.detail || null,
    });
  }

  return payload;
}
