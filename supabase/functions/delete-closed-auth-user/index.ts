/// <reference path="../global.d.ts" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { resolveAuthedUserId } from "../_shared/resolveUserId.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Called right after `soft_delete_my_account` while the user still has a valid JWT.
 * Clears FKs that would block removing `auth.users`, then deletes the auth user so the
 * same email / Google account can register again.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");

  if (!SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawAuth = req.headers.get("Authorization");
  const jwt = rawAuth?.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const bearerHeader = `Bearer ${jwt}`;
  const userId = await resolveAuthedUserId(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    bearerHeader,
    jwt,
  );
  if (!userId) {
    return new Response(JSON.stringify({ error: "Invalid session" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("account_deleted_at")
    .eq("id", userId)
    .maybeSingle();

  if (profErr) {
    console.error(profErr);
    return new Response(JSON.stringify({ error: "Could not verify account state" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!profile?.account_deleted_at) {
    return new Response(
      JSON.stringify({
        error: "Account must be closed in the app before removing the login.",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  await admin.from("locations").update({ created_by: null }).eq("created_by", userId);
  await admin.from("locations").update({ deleted_by: null }).eq("deleted_by", userId);
  await admin.from("access_points").update({ created_by: null }).eq("created_by", userId);

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    console.error(delErr);
    return new Response(JSON.stringify({ error: delErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
