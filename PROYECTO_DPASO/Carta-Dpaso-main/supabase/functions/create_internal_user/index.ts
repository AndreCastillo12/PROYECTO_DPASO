// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ADMIN_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const IS_DEV = (Deno.env.get("DENO_ENV") || "").toLowerCase() === "development";

function buildCorsHeaders(req: Request, forceOrigin?: string) {
  const requestOrigin = forceOrigin ?? req.headers.get("Origin") ?? "";
  const allowAnyOrigin = IS_DEV && ALLOWED_ORIGINS.length === 0;
  const allowedOrigin = allowAnyOrigin
    ? "*"
    : (ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : "null");

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function jsonResponse(req: Request, status: number, payload: Record<string, unknown>, forceOrigin?: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...buildCorsHeaders(req, forceOrigin), "Content-Type": "application/json" },
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

function assertAllowedOrigin(req: Request) {
  const origin = req.headers.get("origin") || req.headers.get("Origin") || "";
  if (!origin || ALLOWED_ORIGINS.length === 0) return { ok: true, origin };
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return { ok: false, origin };
  }
  return { ok: true, origin };
}

Deno.serve(async (req) => {
  const originCheck = assertAllowedOrigin(req);
  const authHeaderRaw = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const apikeyHeaderRaw = req.headers.get("apikey") || "";

  console.log("[create_internal_user] request", {
    method: req.method,
    origin: originCheck.origin || null,
    hasAuthorizationHeader: Boolean(authHeaderRaw),
    hasApiKeyHeader: Boolean(apikeyHeaderRaw),
    authorizationLength: authHeaderRaw.length,
    authorizationPrefix: authHeaderRaw ? authHeaderRaw.slice(0, 12) : null,
  });

  if (!originCheck.ok) {
    return jsonResponse(req, 403, {
      ok: false,
      error: "FORBIDDEN",
      detail: "ORIGIN_NOT_ALLOWED",
    }, originCheck.origin);
  }

  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: buildCorsHeaders(req, originCheck.origin) });
  if (req.method !== "POST") return jsonResponse(req, 405, { ok: false, error: "METHOD_NOT_ALLOWED" }, originCheck.origin);

  try {
    if (!authHeaderRaw) {
      return jsonResponse(req, 401, { ok: false, error: "UNAUTHORIZED", detail: "MISSING_AUTHORIZATION" }, originCheck.origin);
    }

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

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeaderRaw } } });
    const adminClient = createClient(url, service);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    const caller = authData?.user;
    if (!caller?.id) {
      return jsonResponse(req, 401, {
        ok: false,
        error: "UNAUTHORIZED",
        detail: authError?.message ? `INVALID_JWT: ${authError.message}` : "INVALID_JWT",
      }, originCheck.origin);
    }

    const { data: roleRow, error: roleError } = await adminClient
      .from("admin_panel_user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (roleError) return jsonResponse(req, 500, { ok: false, error: "CALLER_ROLE_LOOKUP_FAILED", detail: roleError.message }, originCheck.origin);

    const callerRole = String(roleRow?.role || "").trim().toLowerCase();
    if (![
      "admin",
      "superadmin",
    ].includes(callerRole)) return jsonResponse(req, 403, { ok: false, error: "FORBIDDEN" }, originCheck.origin);

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "").trim();
    const role = normalizeRole(body?.role);

    if (!email || !password) return jsonResponse(req, 400, { ok: false, error: "EMAIL_PASSWORD_REQUIRED" }, originCheck.origin);
    if (password.length < 6) return jsonResponse(req, 400, { ok: false, error: "PASSWORD_MIN_6" }, originCheck.origin);

    const { data: roleCatalog, error: roleCatalogError } = await adminClient
      .from("admin_panel_roles_catalog")
      .select("role")
      .eq("role", role)
      .maybeSingle();

    if (roleCatalogError) {
      return jsonResponse(req, 500, { ok: false, error: "ROLE_CATALOG_LOOKUP_FAILED", detail: roleCatalogError.message }, originCheck.origin);
    }
    if (!roleCatalog?.role) return jsonResponse(req, 400, { ok: false, error: "INVALID_ROLE" }, originCheck.origin);

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { source: "admin_panel", internal_role: role },
      app_metadata: { internal_role: role },
    });

    if (createError || !created?.user?.id) {
      return jsonResponse(req, 400, { ok: false, error: createError?.message || "CREATE_USER_FAILED" }, originCheck.origin);
    }

    const userId = created.user.id;

    const { error: workerError } = await adminClient
      .from("internal_worker_accounts")
      .upsert({ user_id: userId, created_by: caller.id }, { onConflict: "user_id" });

    if (workerError) {
      await adminClient.auth.admin.deleteUser(userId);
      return jsonResponse(req, 500, { ok: false, error: "REGISTER_WORKER_FAILED", detail: workerError.message }, originCheck.origin);
    }

    const { error: roleAssignError } = await adminClient.rpc("rpc_admin_set_user_role", {
      p_user_id: userId,
      p_role: role,
    });

    if (roleAssignError) {
      await adminClient.from("internal_worker_accounts").delete().eq("user_id", userId);
      await adminClient.auth.admin.deleteUser(userId);
      return jsonResponse(req, 500, { ok: false, error: "ROLE_ASSIGN_FAILED", detail: roleAssignError.message }, originCheck.origin);
    }

    return jsonResponse(req, 200, { ok: true, user_id: userId, email, role }, originCheck.origin);
  } catch (error: any) {
    return jsonResponse(req, 500, { ok: false, error: error?.message || "UNEXPECTED_ERROR" }, originCheck.origin);
  }
});
