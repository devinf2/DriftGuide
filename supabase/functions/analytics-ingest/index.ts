/// <reference path="../global.d.ts" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

/**
 * Analytics ingest. Accepts anonymous AND authed callers (verify_jwt = false in config.toml).
 * Performs a service-role insert into public.analytics_events so the table can stay RLS-locked.
 *
 * URL: POST .../functions/v1/analytics-ingest
 * Body: { events: AnalyticsPayload[] }  (also accepts a single { event, ... } object)
 *
 * Each event:
 *   { device_id, user_id?, event, props?, session_id?, platform?, app_version?, ts? }
 *
 * Fire-and-forget client contract: we always return 200 quickly on success and keep validation
 * lenient so a malformed prop never blocks the rest of a batch.
 */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_EVENTS = 500;
const MAX_EVENT_NAME = 120;

type IncomingEvent = {
  device_id?: unknown;
  user_id?: unknown;
  event?: unknown;
  props?: unknown;
  session_id?: unknown;
  platform?: unknown;
  app_version?: unknown;
  ts?: unknown;
};

type EventRow = {
  device_id: string;
  user_id: string | null;
  event: string;
  props: Record<string, unknown>;
  session_id: string | null;
  platform: string | null;
  app_version: string | null;
};

function str(v: unknown, max = 256): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function normalize(raw: IncomingEvent): EventRow | null {
  const event = str(raw.event, MAX_EVENT_NAME);
  if (!event) return null;
  const device_id = str(raw.device_id) ?? "unknown";

  const userIdStr = str(raw.user_id);
  const user_id = userIdStr && UUID_RE.test(userIdStr) ? userIdStr : null;

  let props: Record<string, unknown> = {};
  if (raw.props && typeof raw.props === "object" && !Array.isArray(raw.props)) {
    props = raw.props as Record<string, unknown>;
  }
  // Preserve the client's timestamp for skew analysis without a dedicated column.
  const clientTs = str(raw.ts);
  if (clientTs) props = { ...props, client_ts: clientTs };

  return {
    device_id,
    user_id,
    event,
    props,
    session_id: str(raw.session_id),
    platform: str(raw.platform, 32),
    app_version: str(raw.app_version, 32),
  };
}

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

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const list: IncomingEvent[] = Array.isArray((body as { events?: unknown })?.events)
    ? ((body as { events: IncomingEvent[] }).events)
    : body && typeof body === "object"
    ? [body as IncomingEvent]
    : [];

  if (list.length === 0) {
    return new Response(JSON.stringify({ inserted: 0 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = list
    .slice(0, MAX_EVENTS)
    .map(normalize)
    .filter((r): r is EventRow => r !== null);

  if (rows.length === 0) {
    return new Response(JSON.stringify({ inserted: 0 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin.from("analytics_events").insert(rows);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ inserted: rows.length }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
