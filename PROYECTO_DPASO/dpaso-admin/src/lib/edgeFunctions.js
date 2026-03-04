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

const IS_DEV = import.meta.env.DEV;

function devLog(label, payload) {
  if (!IS_DEV) return;
  console.log(`[invokeEdge] ${label}`, payload);
}

async function readSessionToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session?.access_token || null;
}

async function ensureToken() {
  const token = await readSessionToken();
  if (!token) {
    throw new EdgeFunctionError("Sesión no válida", {
      status: 401,
      code: "SESSION_INVALID",
    });
  }
  return token;
}

async function doFetch(functionName, body, token, anonKey, supabaseUrl) {
  const endpoint = `${supabaseUrl}/functions/v1/${functionName}`;
  const requestHeaders = {
    Authorization: `Bearer ${token}`,
    apikey: anonKey,
    "Content-Type": "application/json",
  };

  devLog("request", {
    functionName,
    hasToken: Boolean(token),
    tokenLength: token?.length || 0,
    headers: {
      Authorization: token ? `Bearer ${token.slice(0, 12)}...` : null,
      apikey: anonKey ? `[present:${anonKey.length}]` : null,
      "Content-Type": "application/json",
    },
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  devLog("response", {
    functionName,
    status: response.status,
    body: payload,
  });

  return { response, payload };
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

  let token = await ensureToken();
  let { response, payload } = await doFetch(functionName, body, token, supabaseAnonKey, supabaseUrl);

  if (response.status === 401) {
    devLog("retry", { functionName, reason: "401 detected, trying refreshSession once" });
    await supabase.auth.refreshSession();
    token = await ensureToken();
    ({ response, payload } = await doFetch(functionName, body, token, supabaseAnonKey, supabaseUrl));
  }

  if (!response.ok || payload?.ok === false) {
    throw new EdgeFunctionError(payload?.error || `HTTP_${response.status}`, {
      status: response.status,
      code: payload?.error || "EDGE_FUNCTION_FAILED",
      detail: payload?.detail || null,
    });
  }

  return payload;
}
