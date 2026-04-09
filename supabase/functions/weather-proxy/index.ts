/// <reference path="../global.d.ts" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { resolveAuthedUserId } from "../_shared/resolveUserId.ts";

/**
 * Per-location shared cache in `location_weather_cache`:
 * - If `fetched_at` is within 1h and `current_json` is valid → return row (no OWM call).
 * - Else → fetch OpenWeather, upsert row, return fresh payload.
 * (401s were from Kong JWT verification, not this logic.)
 */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TTL_MS = 60 * 60 * 1000;
const MOCK_WEATHER = {
  temperature_f: 58,
  condition: "Partly Cloudy",
  cloud_cover: 45,
  wind_speed_mph: 8,
  wind_direction: "SW",
  barometric_pressure: 30.12,
  humidity: 52,
};

const WIND_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

type WeatherData = {
  temperature_f: number;
  condition: string;
  cloud_cover: number;
  wind_speed_mph: number;
  wind_direction: string;
  barometric_pressure: number;
  humidity: number;
};

/** Stored forecast slot: UI fields + extras for plan-a-trip nearest-slot logic. */
type CachedForecastSlot = {
  timestamp_ms: number;
  time: string;
  temp_f: number;
  condition: string;
  pop?: number;
  wind_speed_mph?: number;
  wind_direction?: string;
  humidity: number;
  cloud_cover: number;
  barometric_pressure: number;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type AdminClient = ReturnType<typeof createClient>;

/** Persist row so Table Editor shows activity; TTL applies to mock / no-coord responses too. */
async function upsertLocationWeatherCache(
  admin: AdminClient,
  locationId: string,
  current: WeatherData,
  forecast: CachedForecastSlot[],
  logReason: string,
): Promise<{ fetchedAt: string; upsertOk: boolean }> {
  const fetchedAt = new Date().toISOString();
  const { error } = await admin.from("location_weather_cache").upsert(
    {
      location_id: locationId,
      current_json: current,
      forecast_json: forecast,
      fetched_at: fetchedAt,
      updated_at: fetchedAt,
    },
    { onConflict: "location_id" },
  );
  if (error) {
    console.error("[weather-proxy] cache_upsert_failed", {
      locationId,
      logReason,
      message: error.message,
    });
    return { fetchedAt, upsertOk: false };
  }
  console.log("[weather-proxy] cache_upsert_ok", {
    locationId,
    logReason,
    forecastSlots: forecast.length,
    fetchedAt,
  });
  return { fetchedAt, upsertOk: true };
}

function parseOwmCurrent(data: Record<string, unknown>): WeatherData {
  const windDeg = Number((data.wind as { deg?: number } | undefined)?.deg ?? 0);
  const windSpeed = Number((data.wind as { speed?: number } | undefined)?.speed ?? 0);
  const dirIndex = Math.round(windDeg / 45) % 8;
  const main = data.main as {
    temp?: number;
    pressure?: number;
    humidity?: number;
  } | undefined;
  const clouds = data.clouds as { all?: number } | undefined;
  const weatherArr = data.weather as { description?: string }[] | undefined;
  return {
    temperature_f: Math.round(main?.temp ?? MOCK_WEATHER.temperature_f),
    condition: String(weatherArr?.[0]?.description ?? "Unknown"),
    cloud_cover: clouds?.all ?? 0,
    wind_speed_mph: Math.round(windSpeed),
    wind_direction: WIND_DIRECTIONS[dirIndex] ?? "N",
    barometric_pressure: main?.pressure != null
      ? Math.round(main.pressure * 0.02953 * 100) / 100
      : 30.0,
    humidity: main?.humidity ?? 0,
  };
}

function slotToCachedItem(slot: {
  dt: number;
  main?: { temp?: number; pressure?: number; humidity?: number };
  weather?: { description?: string }[];
  clouds?: { all?: number };
  pop?: number;
  wind?: { speed?: number; deg?: number };
}): CachedForecastSlot {
  const slotDate = new Date(slot.dt * 1000);
  const hours = slotDate.getHours();
  const ampm = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const suffix = hours < 12 ? "AM" : "PM";
  const timeStr = `${ampm} ${suffix}`;
  const condition = slot.weather?.[0]?.description ?? "Unknown";
  const windSpeed = slot.wind?.speed != null ? Math.round(slot.wind.speed) : undefined;
  const windDeg = slot.wind?.deg ?? 0;
  const windDirIndex = Math.round(windDeg / 45) % 8;
  const windDirection = windSpeed != null ? WIND_DIRECTIONS[windDirIndex] : undefined;
  const main = slot.main;
  return {
    timestamp_ms: slot.dt * 1000,
    time: timeStr,
    temp_f: Math.round(main?.temp ?? 0),
    condition,
    pop: slot.pop != null ? Math.round(slot.pop * 100) : undefined,
    wind_speed_mph: windSpeed,
    wind_direction: windDirection,
    humidity: main?.humidity ?? 0,
    cloud_cover: slot.clouds?.all ?? 0,
    barometric_pressure: main?.pressure != null
      ? Math.round(main.pressure * 0.02953 * 100) / 100
      : 30.0,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed", code: "method_not_allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
  const OWM_KEY = Deno.env.get("OPENWEATHER_API_KEY");

  if (!SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Server misconfigured", code: "server_error" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing authorization", code: "unauthorized" }, 401);
  }
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return jsonResponse({ error: "Missing authorization", code: "unauthorized" }, 401);
  }

  const userId = await resolveAuthedUserId(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    authHeader,
    accessToken,
  );
  if (!userId) {
    return jsonResponse({ error: "Invalid session", code: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON", code: "bad_request" }, 400);
  }

  const locationId = String(body.location_id ?? "").trim();
  if (!UUID_RE.test(locationId)) {
    return jsonResponse({ error: "Invalid location_id", code: "bad_request" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: loc, error: locErr } = await admin
    .from("locations")
    .select("id, latitude, longitude, parent_location_id, is_public, created_by")
    .eq("id", locationId)
    .maybeSingle();

  if (locErr || !loc) {
    console.warn("[weather-proxy] location_not_found", { locationId });
    return jsonResponse({ error: "Location not found", code: "not_found" }, 404);
  }

  const isPublic = loc.is_public !== false;
  const isOwner = loc.created_by === userId;
  if (!isPublic && !isOwner) {
    console.warn("[weather-proxy] forbidden_private_location", { locationId, userId: userId });
    return jsonResponse({ error: "Forbidden", code: "forbidden" }, 403);
  }

  let lat = loc.latitude != null ? Number(loc.latitude) : null;
  let lng = loc.longitude != null ? Number(loc.longitude) : null;

  if ((lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) && loc.parent_location_id) {
    const { data: parent } = await admin
      .from("locations")
      .select("latitude, longitude")
      .eq("id", loc.parent_location_id)
      .maybeSingle();
    if (parent?.latitude != null && parent?.longitude != null) {
      lat = Number(parent.latitude);
      lng = Number(parent.longitude);
    }
  }

  const now = Date.now();

  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    console.log("[weather-proxy] response_no_coordinates", { locationId, userId: userId });
    const { data: noCoordCache } = await admin
      .from("location_weather_cache")
      .select("current_json, forecast_json, fetched_at")
      .eq("location_id", locationId)
      .maybeSingle();
    if (noCoordCache?.fetched_at) {
      const fetchedMs = new Date(String(noCoordCache.fetched_at)).getTime();
      if (!Number.isNaN(fetchedMs) && now - fetchedMs < TTL_MS) {
        const current = noCoordCache.current_json as WeatherData | null;
        const forecast = (noCoordCache.forecast_json as CachedForecastSlot[] | null) ?? [];
        if (current && typeof current.temperature_f === "number") {
          console.log("[weather-proxy] cache_hit", {
            locationId,
            userId: userId,
            fetchedAt: String(noCoordCache.fetched_at),
            ageMs: now - fetchedMs,
            forecastSlots: forecast.length,
            branch: "no_coordinates",
          });
          return jsonResponse({
            current,
            forecast,
            fetched_at: String(noCoordCache.fetched_at),
            cached: true,
            no_coordinates: true,
          });
        }
      }
    }
    const emptyForecast: CachedForecastSlot[] = [];
    const { fetchedAt } = await upsertLocationWeatherCache(
      admin,
      locationId,
      { ...MOCK_WEATHER },
      emptyForecast,
      "no_coordinates_mock",
    );
    return jsonResponse({
      current: { ...MOCK_WEATHER },
      forecast: emptyForecast,
      fetched_at: fetchedAt,
      cached: false,
      no_coordinates: true,
    });
  }

  const { data: cacheRow } = await admin
    .from("location_weather_cache")
    .select("current_json, forecast_json, fetched_at")
    .eq("location_id", locationId)
    .maybeSingle();

  if (cacheRow?.fetched_at) {
    const fetchedMs = new Date(String(cacheRow.fetched_at)).getTime();
    const ageMs = Number.isNaN(fetchedMs) ? null : now - fetchedMs;
    if (!Number.isNaN(fetchedMs) && now - fetchedMs < TTL_MS) {
      const current = cacheRow.current_json as WeatherData | null;
      const forecast = (cacheRow.forecast_json as CachedForecastSlot[] | null) ?? [];
      if (current && typeof current.temperature_f === "number") {
        console.log("[weather-proxy] cache_hit", {
          locationId,
          userId: userId,
          fetchedAt: String(cacheRow.fetched_at),
          ageMs,
          forecastSlots: forecast.length,
        });
        return jsonResponse({
          current,
          forecast,
          fetched_at: String(cacheRow.fetched_at),
          cached: true,
        });
      }
      console.warn("[weather-proxy] cache_row_invalid_shape_refreshing", { locationId });
    }
    if (ageMs != null) {
      console.log("[weather-proxy] cache_stale_or_invalid", {
        locationId,
        ageMs,
        ttlMs: TTL_MS,
        hadRow: true,
      });
    }
  } else {
    console.log("[weather-proxy] cache_miss", { locationId });
  }

  if (!OWM_KEY) {
    console.warn("[weather-proxy] openweather_key_missing_returning_mock", { locationId });
    const emptyForecast: CachedForecastSlot[] = [];
    const { fetchedAt } = await upsertLocationWeatherCache(
      admin,
      locationId,
      { ...MOCK_WEATHER },
      emptyForecast,
      "openweather_key_missing_mock",
    );
    return jsonResponse({
      current: { ...MOCK_WEATHER },
      forecast: emptyForecast,
      fetched_at: fetchedAt,
      cached: false,
      mock: true,
    });
  }

  const weatherUrl =
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OWM_KEY}&units=imperial`;
  const forecastUrl =
    `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OWM_KEY}&units=imperial`;

  const [wRes, fRes] = await Promise.all([fetch(weatherUrl), fetch(forecastUrl)]);
  const wData = (await wRes.json()) as Record<string, unknown>;
  const fData = (await fRes.json()) as { list?: unknown[] };

  let current: WeatherData = { ...MOCK_WEATHER };
  const codOk = wData.cod == null || wData.cod === 200 || wData.cod === "200";
  if (wRes.ok && codOk) {
    current = parseOwmCurrent(wData);
  }

  const forecastSlots: CachedForecastSlot[] = [];
  if (fRes.ok && Array.isArray(fData.list)) {
    const tNow = new Date();
    for (const slot of fData.list) {
      if (!slot || typeof slot !== "object") continue;
      const s = slot as { dt?: number };
      if (s.dt == null) continue;
      const dtMs = s.dt * 1000;
      if (new Date(dtMs) < tNow) continue;
      forecastSlots.push(slotToCachedItem(s as Parameters<typeof slotToCachedItem>[0]));
    }
  }

  const { fetchedAt, upsertOk } = await upsertLocationWeatherCache(
    admin,
    locationId,
    current,
    forecastSlots,
    "openweather_refresh",
  );

  console.log("[weather-proxy] openweather_refresh_ok", {
    locationId,
    userId: userId,
    lat,
    lng,
    currentOk: wRes.ok && codOk,
    forecastOk: fRes.ok,
    forecastSlots: forecastSlots.length,
    fetchedAt,
    upsertOk,
  });

  return jsonResponse({
    current,
    forecast: forecastSlots,
    fetched_at: fetchedAt,
    cached: false,
  });
});
