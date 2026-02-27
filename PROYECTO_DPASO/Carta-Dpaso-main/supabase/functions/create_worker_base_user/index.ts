// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ADMIN_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function buildCorsHeaders(req: Request) {
  const requestOrigin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : "null";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function jsonResponse(req: Request, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!url || !anon || !service) {
      return jsonResponse(req, 500, { ok: false, error: "MISSING_SUPABASE_ENV" });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const serviceClient = createClient(url, service);

    const { data: callerData } = await callerClient.auth.getUser();
    const caller = callerData?.user;
    if (!caller?.id) return jsonResponse(req, 401, { ok: false, error: "UNAUTHORIZED" });

    const { data: callerRoleRow } = await serviceClient
      .from("admin_panel_user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();

    const callerRole = String(callerRoleRow?.role || "").trim().toLowerCase();
    if (callerRole !== "admin") return jsonResponse(req, 403, { ok: false, error: "FORBIDDEN" });

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "").trim();

    if (!email || !password) return jsonResponse(req, 400, { ok: false, error: "EMAIL_PASSWORD_REQUIRED" });
    if (password.length < 6) return jsonResponse(req, 400, { ok: false, error: "PASSWORD_MIN_6" });

    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { source: "admin_panel", internal_role: "none" },
    });

    if (createError || !created?.user?.id) {
      return jsonResponse(req, 400, { ok: false, error: createError?.message || "CREATE_USER_FAILED" });
    }

    const userId = created.user.id;

    const { error: workerError } = await serviceClient
      .from("internal_worker_accounts")
      .upsert({ user_id: userId, created_by: caller.id }, { onConflict: "user_id" });

    if (workerError) {
      await serviceClient.auth.admin.deleteUser(userId);
      return jsonResponse(req, 500, { ok: false, error: "REGISTER_WORKER_FAILED", detail: workerError.message });
    }

    return jsonResponse(req, 200, { ok: true, user_id: userId, email });
  } catch (error: any) {
    return jsonResponse(req, 500, { ok: false, error: error?.message || "UNEXPECTED_ERROR" });
  }
});
