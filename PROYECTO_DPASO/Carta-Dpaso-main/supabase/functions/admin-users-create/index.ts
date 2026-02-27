// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

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

    const callerRole = String(roleRow?.role || "").trim().toLowerCase();
    if (callerRole !== "admin") return jsonResponse(403, { ok: false, error: "FORBIDDEN" });

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "").trim();
    const role = String(body?.role || "cocina").trim().toLowerCase();

    if (!email || !password) return jsonResponse(400, { ok: false, error: "EMAIL_PASSWORD_REQUIRED" });
    if (password.length < 6) return jsonResponse(400, { ok: false, error: "PASSWORD_MIN_6" });
    if (!["admin", "cajero", "mozo", "cocina"].includes(role)) return jsonResponse(400, { ok: false, error: "INVALID_ROLE" });

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { admin_role: role },
      app_metadata: { admin_role: role },
    });

    if (createError || !created?.user?.id) {
      return jsonResponse(400, { ok: false, error: createError?.message || "CREATE_USER_FAILED" });
    }

    const userId = created.user.id;

    const { error: roleError } = await adminClient.from("admin_panel_user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id" });
    if (roleError) {
      await adminClient.auth.admin.deleteUser(userId);
      return jsonResponse(500, { ok: false, error: "ROLE_ASSIGN_FAILED", detail: roleError.message });
    }

    const { error: profileError } = await adminClient.from("profiles").upsert({ id: userId, role }, { onConflict: "id" });
    if (profileError) {
      await adminClient.from("admin_panel_user_roles").delete().eq("user_id", userId);
      await adminClient.auth.admin.deleteUser(userId);
      return jsonResponse(500, { ok: false, error: "PROFILE_SYNC_FAILED", detail: profileError.message });
    }

    await adminClient.from("internal_worker_accounts").upsert({ user_id: userId, created_by: caller.id }, { onConflict: "user_id" });

    return jsonResponse(200, { ok: true, user_id: userId, email, role });
  } catch (error: any) {
    return jsonResponse(500, { ok: false, error: error?.message || "UNEXPECTED_ERROR" });
  }
});
