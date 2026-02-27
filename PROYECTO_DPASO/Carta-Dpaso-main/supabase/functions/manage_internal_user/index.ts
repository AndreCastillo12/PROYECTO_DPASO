// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!url || !anon || !service) {
      return jsonResponse(500, { ok: false, error: "MISSING_SUPABASE_ENV" });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const adminClient = createClient(url, service);

    const { data: authData } = await userClient.auth.getUser();
    const caller = authData?.user;
    if (!caller?.id) return jsonResponse(401, { ok: false, error: "UNAUTHORIZED" });

    const { data: roleRow } = await adminClient
      .from("admin_panel_user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (String(roleRow?.role || "").trim().toLowerCase() !== "admin") {
      return jsonResponse(403, { ok: false, error: "FORBIDDEN" });
    }

    const body = await req.json();
    const action = String(body?.action || "").trim().toLowerCase();
    const userId = String(body?.user_id || "").trim();

    if (!action || !userId) return jsonResponse(400, { ok: false, error: "ACTION_AND_USER_REQUIRED" });
    if (userId === caller.id) return jsonResponse(400, { ok: false, error: "CANNOT_MANAGE_SELF" });

    if (action === "reset_password") {
      const newPassword = String(body?.new_password || "").trim();
      if (!newPassword || newPassword.length < 6) return jsonResponse(400, { ok: false, error: "PASSWORD_MIN_6" });

      const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword });
      if (updateError) return jsonResponse(400, { ok: false, error: updateError.message || "RESET_PASSWORD_FAILED" });
      return jsonResponse(200, { ok: true, action, user_id: userId });
    }


    if (action === "disable_user") {
      const { error: disableError } = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: "876000h",
      });
      if (disableError) return jsonResponse(400, { ok: false, error: disableError.message || "DISABLE_USER_FAILED" });
      return jsonResponse(200, { ok: true, action, user_id: userId });
    }

    if (action === "enable_user") {
      const { error: enableError } = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: "none",
      });
      if (enableError) return jsonResponse(400, { ok: false, error: enableError.message || "ENABLE_USER_FAILED" });
      return jsonResponse(200, { ok: true, action, user_id: userId });
    }

    if (action === "delete_user") {
      const steps: Array<{ step: string; status: "ok" | "error"; detail?: string }> = [];

      const { data: previousRole, error: previousRoleError } = await adminClient
        .from("admin_panel_user_roles")
        .select("user_id, role")
        .eq("user_id", userId)
        .maybeSingle();

      if (previousRoleError) {
        return jsonResponse(500, {
          ok: false,
          error: "PRE_DELETE_SNAPSHOT_FAILED",
          detail: previousRoleError.message,
        });
      }

      const { data: previousProfile, error: previousProfileError } = await adminClient
        .from("profiles")
        .select("id, role")
        .eq("id", userId)
        .maybeSingle();

      if (previousProfileError) {
        return jsonResponse(500, {
          ok: false,
          error: "PRE_DELETE_SNAPSHOT_FAILED",
          detail: previousProfileError.message,
        });
      }

      const { error: roleDeleteError } = await adminClient.from("admin_panel_user_roles").delete().eq("user_id", userId);
      if (roleDeleteError) {
        steps.push({ step: "delete_role", status: "error", detail: roleDeleteError.message });
        return jsonResponse(500, { ok: false, error: "DELETE_ROLE_FAILED", steps });
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

        return jsonResponse(500, { ok: false, error: "DELETE_PROFILE_FAILED", steps });
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

        return jsonResponse(500, { ok: false, error: "DELETE_USER_FAILED", steps });
      }

      steps.push({ step: "delete_auth_user", status: "ok" });
      return jsonResponse(200, { ok: true, action, user_id: userId, steps });
    }

    return jsonResponse(400, { ok: false, error: "INVALID_ACTION" });
  } catch (error: any) {
    return jsonResponse(500, { ok: false, error: error?.message || "UNEXPECTED_ERROR" });
  }
});
