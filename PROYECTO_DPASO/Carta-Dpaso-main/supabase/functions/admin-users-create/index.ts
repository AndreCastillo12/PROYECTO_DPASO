// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const adminClient = createClient(url, service);

    const { data: authData } = await userClient.auth.getUser();
    const caller = authData?.user;
    if (!caller) return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });

    const { data: roleRow } = await adminClient
      .from("admin_panel_user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();

    const callerRole = String(roleRow?.role || caller.user_metadata?.admin_role || caller.app_metadata?.admin_role || "admin").toLowerCase();
    if (callerRole !== "admin") {
      return new Response(JSON.stringify({ ok: false, error: "FORBIDDEN" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "").trim();
    const role = String(body?.role || "cocina").trim().toLowerCase();

    if (!email || !password) {
      return new Response(JSON.stringify({ ok: false, error: "EMAIL_PASSWORD_REQUIRED" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    if (!["admin", "cajero", "mozo", "cocina"].includes(role)) {
      return new Response(JSON.stringify({ ok: false, error: "INVALID_ROLE" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { admin_role: role },
      app_metadata: { admin_role: role },
    });

    if (createError || !created?.user) {
      return new Response(JSON.stringify({ ok: false, error: createError?.message || "CREATE_USER_FAILED" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const userId = created.user.id;

    await adminClient.from("admin_panel_user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id" });
    await adminClient.from("profiles").upsert({ id: userId, role }, { onConflict: "id" });

    return new Response(JSON.stringify({ ok: true, user_id: userId, email, role }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (error: any) {
    return new Response(JSON.stringify({ ok: false, error: error?.message || "UNEXPECTED_ERROR" }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
