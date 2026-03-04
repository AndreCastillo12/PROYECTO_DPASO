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

function assertAllowedOrigin(req: Request) {
  const origin = req.headers.get("origin") || req.headers.get("Origin") || "";
  if (!origin || ALLOWED_ORIGINS.length === 0) return { ok: true, origin };
  if (!ALLOWED_ORIGINS.includes(origin)) return { ok: false, origin };
  return { ok: true, origin };
}

Deno.serve(async (req) => {
  const originCheck = assertAllowedOrigin(req);
  const authHeaderRaw = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const apikeyHeaderRaw = req.headers.get("apikey") || "";

  console.log("[manage_internal_user] request", {
    method: req.method,
    origin: originCheck.origin || null,
    hasAuthorizationHeader: Boolean(authHeaderRaw),
    hasApiKeyHeader: Boolean(apikeyHeaderRaw),
    authorizationLength: authHeaderRaw.length,
    authorizationPrefix: authHeaderRaw ? authHeaderRaw.slice(0, 12) : null,
  });

  if (!originCheck.ok) {
    return jsonResponse(req, 403, { ok: false, error: "FORBIDDEN", detail: "ORIGIN_NOT_ALLOWED" }, originCheck.origin);
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

    if (missing.length > 0) {
      return jsonResponse(req, 500, {
        ok: false,
        error: "MISSING_SUPABASE_ENV",
        detail: `Missing required env vars: ${missing.join(", ")}`,
      }, originCheck.origin);
    }

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

    const { data: roleRow } = await adminClient
      .from("admin_panel_user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();

    const callerRole = String(roleRow?.role || "").trim().toLowerCase();
    if (![
      "admin",
      "superadmin",
    ].includes(callerRole)) {
      return jsonResponse(req, 403, { ok: false, error: "FORBIDDEN" }, originCheck.origin);
    }

    const body = await req.json();
    const action = String(body?.action || "").trim().toLowerCase();
    const userId = String(body?.user_id || "").trim();

    if (!action || !userId) return jsonResponse(req, 400, { ok: false, error: "ACTION_AND_USER_REQUIRED" }, originCheck.origin);
    if (userId === caller.id) return jsonResponse(req, 400, { ok: false, error: "CANNOT_MANAGE_SELF" }, originCheck.origin);

    const { data: targetRoleRow } = await adminClient
      .from("admin_panel_user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    const targetRole = String(targetRoleRow?.role || "").trim().toLowerCase();
    if (targetRole === "superadmin" && callerRole !== "superadmin") {
      return jsonResponse(req, 403, { ok: false, error: "FORBIDDEN_SUPERADMIN_TARGET" }, originCheck.origin);
    }

    if (action === "reset_password") {
      const newPassword = String(body?.new_password || "").trim();
      if (!newPassword || newPassword.length < 6) return jsonResponse(req, 400, { ok: false, error: "PASSWORD_MIN_6" }, originCheck.origin);

      const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword });
      if (updateError) return jsonResponse(req, 400, { ok: false, error: updateError.message || "RESET_PASSWORD_FAILED" }, originCheck.origin);
      return jsonResponse(req, 200, { ok: true, action, user_id: userId }, originCheck.origin);
    }

    if (action === "disable_user") {
      const { error: disableError } = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: "876000h",
      });
      if (disableError) return jsonResponse(req, 400, { ok: false, error: disableError.message || "DISABLE_USER_FAILED" }, originCheck.origin);
      return jsonResponse(req, 200, { ok: true, action, user_id: userId }, originCheck.origin);
    }

    if (action === "enable_user") {
      const { error: enableError } = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: "none",
      });
      if (enableError) return jsonResponse(req, 400, { ok: false, error: enableError.message || "ENABLE_USER_FAILED" }, originCheck.origin);
      return jsonResponse(req, 200, { ok: true, action, user_id: userId }, originCheck.origin);
    }

    if (action === "delete_user") {
      const steps: Array<{ step: string; status: "ok" | "error"; detail?: string }> = [];

      const { data: previousRole, error: previousRoleError } = await adminClient
        .from("admin_panel_user_roles")
        .select("user_id, role")
        .eq("user_id", userId)
        .maybeSingle();

      if (previousRoleError) {
        return jsonResponse(req, 500, {
          ok: false,
          error: "PRE_DELETE_SNAPSHOT_FAILED",
          detail: previousRoleError.message,
        }, originCheck.origin);
      }

      const { data: previousProfile, error: previousProfileError } = await adminClient
        .from("profiles")
        .select("id, role")
        .eq("id", userId)
        .maybeSingle();

      if (previousProfileError) {
        return jsonResponse(req, 500, {
          ok: false,
          error: "PRE_DELETE_SNAPSHOT_FAILED",
          detail: previousProfileError.message,
        }, originCheck.origin);
      }

      const { error: roleDeleteError } = await adminClient.from("admin_panel_user_roles").delete().eq("user_id", userId);
      if (roleDeleteError) {
        steps.push({ step: "delete_role", status: "error", detail: roleDeleteError.message });
        return jsonResponse(req, 500, { ok: false, error: "DELETE_ROLE_FAILED", steps }, originCheck.origin);
      }
      steps.push({ step: "delete_role", status: "ok" });

      const { error: profileDeleteError } = await adminClient.from("profiles").delete().eq("id", userId);
      if (profileDeleteError) {
        steps.push({ step: "delete_profile", status: "error", detail: profileDeleteError.message });

        if (previousRole) {
          const { error: rollbackRoleError } = await adminClient
            .from("admin_panel_user_roles")
            .upsert(previousRole, { onConflict: "user_id" });
          steps.push({
            step: "rollback_role",
            status: rollbackRoleError ? "error" : "ok",
            detail: rollbackRoleError?.message,
          });
        }

        return jsonResponse(req, 500, { ok: false, error: "DELETE_PROFILE_FAILED", steps }, originCheck.origin);
      }
      steps.push({ step: "delete_profile", status: "ok" });

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
      if (deleteError) {
        steps.push({ step: "delete_auth_user", status: "error", detail: deleteError.message || "DELETE_USER_FAILED" });

        if (previousRole) {
          const { error: rollbackRoleError } = await adminClient
            .from("admin_panel_user_roles")
            .upsert(previousRole, { onConflict: "user_id" });
          steps.push({
            step: "rollback_role",
            status: rollbackRoleError ? "error" : "ok",
            detail: rollbackRoleError?.message,
          });
        }

        if (previousProfile) {
          const { error: rollbackProfileError } = await adminClient
            .from("profiles")
            .upsert(previousProfile, { onConflict: "id" });
          steps.push({
            step: "rollback_profile",
            status: rollbackProfileError ? "error" : "ok",
            detail: rollbackProfileError?.message,
          });
        }

        return jsonResponse(req, 500, { ok: false, error: "DELETE_USER_FAILED", steps }, originCheck.origin);
      }

      steps.push({ step: "delete_auth_user", status: "ok" });
      return jsonResponse(req, 200, { ok: true, action, user_id: userId, steps }, originCheck.origin);
    }

    return jsonResponse(req, 400, { ok: false, error: "INVALID_ACTION" }, originCheck.origin);
  } catch (error: any) {
    return jsonResponse(req, 500, { ok: false, error: error?.message || "UNEXPECTED_ERROR" }, originCheck.origin);
  }
});
