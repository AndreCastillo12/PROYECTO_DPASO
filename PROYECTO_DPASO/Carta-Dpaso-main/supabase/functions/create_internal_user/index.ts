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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
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

function missingEnv(req: Request, vars: string[]) {
  return jsonResponse(req, 500, {
    ok: false,
    error: "MISSING_SUPABASE_ENV",
    detail: `Missing required env vars: ${vars.join(", ")}`,
  });
}

function normalizeRole(value: unknown) {
  return String(value || "cocina").trim().toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    if (!Deno.env.get("DPASO_SERVICE_ROLE_KEY")) {
      throw new Error("Missing DPASO_SERVICE_ROLE_KEY secret");
    }

    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("DPASO_SERVICE_ROLE_KEY") || "";

    const missing = [
      !url ? "SUPABASE_URL" : "",
      !anon ? "SUPABASE_ANON_KEY" : "",
      !service ? "DPASO_SERVICE_ROLE_KEY" : "",
    ].filter(Boolean);
    if (missing.length > 0) return missingEnv(req, missing);

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const adminClient = createClient(url, service);

    const { data: authData } = await userClient.auth.getUser();
    const caller = authData?.user;
    if (!caller?.id) return jsonResponse(req, 401, { ok: false, error: "UNAUTHORIZED" });

    const { data: roleRow, error: roleError } = await adminClient
      .from("admin_panel_user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (roleError) return jsonResponse(req, 500, { ok: false, error: "CALLER_ROLE_LOOKUP_FAILED", detail: roleError.message });

    const callerRole = String(roleRow?.role || "").trim().toLowerCase();
    if (!["admin", "superadmin"].includes(callerRole)) return jsonResponse(req, 403, { ok: false, error: "FORBIDDEN" });

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "").trim();
    const role = normalizeRole(body?.role);

    if (!email || !password) return jsonResponse(req, 400, { ok: false, error: "EMAIL_PASSWORD_REQUIRED" });
    if (password.length < 6) return jsonResponse(req, 400, { ok: false, error: "PASSWORD_MIN_6" });

    const { data: roleCatalog, error: roleCatalogError } = await adminClient
      .from("admin_panel_roles_catalog")
      .select("role")
      .eq("role", role)
      .maybeSingle();

    if (roleCatalogError) {
      return jsonResponse(req, 500, { ok: false, error: "ROLE_CATALOG_LOOKUP_FAILED", detail: roleCatalogError.message });
    }
    if (!roleCatalog?.role) return jsonResponse(req, 400, { ok: false, error: "INVALID_ROLE" });

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { source: "admin_panel", internal_role: role },
      app_metadata: { internal_role: role },
    });

    if (createError || !created?.user?.id) {
      return jsonResponse(req, 400, { ok: false, error: createError?.message || "CREATE_USER_FAILED" });
    }

    const userId = created.user.id;

    const { error: workerError } = await adminClient
      .from("internal_worker_accounts")
      .upsert({ user_id: userId, created_by: caller.id }, { onConflict: "user_id" });

    if (workerError) {
      await adminClient.auth.admin.deleteUser(userId);
      return jsonResponse(req, 500, { ok: false, error: "REGISTER_WORKER_FAILED", detail: workerError.message });
    }

    const { error: roleAssignError } = await adminClient.rpc("rpc_admin_set_user_role", {
      p_user_id: userId,
      p_role: role,
    });

    if (roleAssignError) {
      await adminClient.from("internal_worker_accounts").delete().eq("user_id", userId);
      await adminClient.auth.admin.deleteUser(userId);
      return jsonResponse(req, 500, { ok: false, error: "ROLE_ASSIGN_FAILED", detail: roleAssignError.message });
    }

    return jsonResponse(req, 200, { ok: true, user_id: userId, email, role });
  } catch (error: any) {
    return jsonResponse(req, 500, { ok: false, error: error?.message || "UNEXPECTED_ERROR" });
  }
});
