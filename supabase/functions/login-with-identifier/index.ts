/// <reference path="../global.d.ts" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GENERIC = "Invalid email/username or password.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: GENERIC }, 400);
  }

  const rawUser = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  const norm = rawUser.trim().toLowerCase().replace(/^@+/, "");

  if (!/^[a-z0-9_]{3,20}$/.test(norm) || password.length === 0) {
    return json({ error: GENERIC }, 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");

  if (!SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id")
    .eq("username", norm)
    .maybeSingle();

  if (profileErr || !profile?.id) {
    return json({ error: GENERIC }, 401);
  }

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(profile.id);
  const email = userData.user?.email?.trim();
  if (userErr || !email) {
    return json({ error: GENERIC }, 401);
  }

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: signData, error: signErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });

  if (signErr || !signData.session) {
    return json({ error: GENERIC }, 401);
  }

  return json({
    access_token: signData.session.access_token,
    refresh_token: signData.session.refresh_token,
  });
});
