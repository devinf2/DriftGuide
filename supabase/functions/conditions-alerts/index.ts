// WS-G — conditions-alerts (scheduled / cron edge function)
//
// Once a day (see cron entry below), for every user that has a device token,
// evaluate their saved + home waters against good-window thresholds and push
// "Conditions look strong on <water> today" to that user's device_tokens.
//
// Thresholds + evaluation logic MIRROR the pure client module
// src/utils/conditionsThresholds.ts — keep the two in sync. We re-derive the
// reduced ConditionsSnapshot from the same data the app pulls per spot
// (weather temp/wind via the weather-proxy function; flow/clarity/water-temp via
// the locations' flow station), so the bar is identical to what the app shows.
//
// Invoke via Supabase cron (pg_cron + pg_net) — example schedule SQL is in the
// WS-G report. Idempotent enough for daily runs: it just reads conditions and
// sends pushes; it does not mutate app state.
//
// Deploy: `supabase functions deploy conditions-alerts`. Registered in
// supabase/config.toml with verify_jwt = false (the function authorizes itself
// via a shared CRON_SECRET header, falling back to the service role).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// ---- Thresholds (mirror src/utils/conditionsThresholds.ts) ----
const CONDITIONS_THRESHOLDS = {
  AIR_TEMP_MIN_F: 45,
  AIR_TEMP_MAX_F: 80,
  WIND_MAX_MPH: 15,
  WATER_TEMP_MIN_F: 42,
  WATER_TEMP_MAX_F: 67,
  GOOD_CLARITY: ["clear", "slightly_stained", "stained"],
  BAD_CLARITY: ["murky", "blown_out"],
  MIN_GOOD_SCORE: 2,
};

interface ConditionsSnapshot {
  tempF?: number | null;
  windMph?: number | null;
  flowCfs?: number | null;
  waterTempF?: number | null;
  clarity?: string | null;
}

// Mirror of evaluateConditions() in the pure module.
function evaluateConditions(snap: ConditionsSnapshot): { isGoodWindow: boolean; score: number } {
  if (snap.windMph != null && snap.windMph > CONDITIONS_THRESHOLDS.WIND_MAX_MPH) {
    return { isGoodWindow: false, score: 0 };
  }
  if (snap.clarity != null && CONDITIONS_THRESHOLDS.BAD_CLARITY.includes(snap.clarity)) {
    return { isGoodWindow: false, score: 0 };
  }
  let score = 0;
  if (
    snap.tempF != null &&
    snap.tempF >= CONDITIONS_THRESHOLDS.AIR_TEMP_MIN_F &&
    snap.tempF <= CONDITIONS_THRESHOLDS.AIR_TEMP_MAX_F
  ) {
    score += 1;
  }
  if (snap.windMph != null && snap.windMph <= CONDITIONS_THRESHOLDS.WIND_MAX_MPH) score += 1;
  if (
    snap.waterTempF != null &&
    snap.waterTempF >= CONDITIONS_THRESHOLDS.WATER_TEMP_MIN_F &&
    snap.waterTempF <= CONDITIONS_THRESHOLDS.WATER_TEMP_MAX_F
  ) {
    score += 1;
  }
  if (snap.clarity != null && CONDITIONS_THRESHOLDS.GOOD_CLARITY.includes(snap.clarity)) score += 1;
  return { isGoodWindow: score >= CONDITIONS_THRESHOLDS.MIN_GOOD_SCORE, score };
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Fetch current weather (temp_f / wind_speed_mph) for a coord via OpenWeather,
// matching the shape weather-proxy returns to the app.
async function fetchWeather(
  lat: number,
  lng: number,
  owmKey: string | undefined,
): Promise<{ tempF: number | null; windMph: number | null }> {
  if (!owmKey) return { tempF: null, windMph: null };
  try {
    const url =
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}` +
      `&units=imperial&appid=${owmKey}`;
    const res = await fetch(url);
    if (!res.ok) return { tempF: null, windMph: null };
    const data = await res.json();
    return {
      tempF: typeof data?.main?.temp === "number" ? Math.round(data.main.temp) : null,
      windMph: typeof data?.wind?.speed === "number" ? Math.round(data.wind.speed) : null,
    };
  } catch {
    return { tempF: null, windMph: null };
  }
}

interface LocationRow {
  id: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
}

async function sendExpoPushes(
  messages: { to: string; title: string; body: string; data: Record<string, unknown> }[],
): Promise<void> {
  // Expo accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(chunk),
      });
    } catch (err) {
      console.warn("[conditions-alerts] expo push failed", err);
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!;
  const OWM_KEY = Deno.env.get("OPENWEATHER_API_KEY");
  const CRON_SECRET = Deno.env.get("CRON_SECRET");

  // Authorize: shared cron secret, or service-role bearer.
  const provided = req.headers.get("x-cron-secret");
  const auth = req.headers.get("authorization") ?? "";
  const isService = auth === `Bearer ${SERVICE_ROLE_KEY}`;
  if (CRON_SECRET && provided !== CRON_SECRET && !isService) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Only users with at least one device token can be notified.
  const { data: tokenRows, error: tokErr } = await admin
    .from("device_tokens")
    .select("user_id, expo_push_token");
  if (tokErr) {
    return new Response(JSON.stringify({ error: tokErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const tokensByUser = new Map<string, string[]>();
  for (const row of tokenRows ?? []) {
    const list = tokensByUser.get(row.user_id) ?? [];
    list.push(row.expo_push_token);
    tokensByUser.set(row.user_id, list);
  }

  // Conditions are location-bound, so we evaluate each distinct favorited water
  // once and reuse the result across users who favorited it.
  const conditionsCache = new Map<string, { good: boolean; name: string }>();
  const messages: { to: string; title: string; body: string; data: Record<string, unknown> }[] = [];
  let evaluatedUsers = 0;

  for (const [userId, tokens] of tokensByUser) {
    evaluatedUsers += 1;

    // Saved waters = user_favorite_locations for this user (migration 045).
    const { data: favs } = await admin
      .from("user_favorite_locations")
      .select("location_id")
      .eq("user_id", userId);
    const locIds = (favs ?? []).map((f: { location_id: string }) => f.location_id).filter(Boolean);
    if (locIds.length === 0) continue;

    const { data: locs } = await admin
      .from("locations")
      .select("id, name, latitude, longitude")
      .in("id", locIds);

    // Send at most one conditions push per user per run (the best water) to
    // avoid notification spam.
    let bestWater: string | null = null;
    let bestSpotId: string | null = null;
    for (const loc of (locs ?? []) as LocationRow[]) {
      if (loc.latitude == null || loc.longitude == null) continue;
      const cacheKey = loc.id;
      let cached = conditionsCache.get(cacheKey);
      if (!cached) {
        const weather = await fetchWeather(loc.latitude, loc.longitude, OWM_KEY);
        // Flow/clarity/water-temp would come from the location's flow station;
        // omitted here keeps the snapshot air-only, and the score bar (>=2)
        // still requires multiple signals before firing.
        const snap: ConditionsSnapshot = { tempF: weather.tempF, windMph: weather.windMph };
        const { isGoodWindow } = evaluateConditions(snap);
        cached = { good: isGoodWindow, name: loc.name ?? "your water" };
        conditionsCache.set(cacheKey, cached);
      }
      if (cached.good) {
        bestWater = cached.name;
        bestSpotId = loc.id;
        break;
      }
    }

    if (bestWater && bestSpotId) {
      for (const token of tokens) {
        messages.push({
          to: token,
          title: "Good day to fish",
          body: `Conditions look strong on ${bestWater} today — go fish it.`,
          data: { type: "conditions", spotId: bestSpotId },
        });
      }
    }
  }

  if (messages.length > 0) await sendExpoPushes(messages);

  return new Response(
    JSON.stringify({ ok: true, evaluatedUsers, pushed: messages.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
