import { FunctionsHttpError } from '@supabase/functions-js';
import { edgeFunctionInvokeHeaders, supabase } from '@/src/services/supabase';
import { WeatherData, HourlyForecastItem } from '@/src/types';

const LEGACY_OPENWEATHER_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;
/** When `"0"`, skip Supabase Edge `weather-proxy` and use legacy client key if set. */
const USE_WEATHER_EDGE = process.env.EXPO_PUBLIC_USE_WEATHER_EDGE !== '0';

function weatherClientLog(message: string, extra?: Record<string, unknown>): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (extra) console.log(`[DriftGuide weather] ${message}`, extra);
  else console.log(`[DriftGuide weather] ${message}`);
}

export type WeatherFetchContext = {
  /** Catalog / app location id — enables shared 1h cache via `weather-proxy`. */
  locationId?: string | null;
};

const MOCK_WEATHER: WeatherData = {
  temperature_f: 58,
  condition: 'Partly Cloudy',
  cloud_cover: 45,
  wind_speed_mph: 8,
  wind_direction: 'SW',
  barometric_pressure: 30.12,
  humidity: 52,
};

type ProxyForecastSlot = HourlyForecastItem & {
  humidity: number;
  cloud_cover: number;
  barometric_pressure: number;
};

export type WeatherProxyBundle = {
  current: WeatherData;
  forecast: ProxyForecastSlot[];
  fetched_at: string;
  cached: boolean;
};

const inflightBundles = new Map<string, Promise<WeatherProxyBundle | null>>();

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
}

function parseProxyBundle(data: unknown): WeatherProxyBundle | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const current = o.current;
  if (!current || typeof current !== 'object') return null;
  const c = current as Record<string, unknown>;
  if (typeof c.temperature_f !== 'number' || typeof c.condition !== 'string') return null;
  const forecastRaw = Array.isArray(o.forecast) ? o.forecast : [];
  const forecast: ProxyForecastSlot[] = [];
  for (const item of forecastRaw) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    if (typeof s.timestamp_ms !== 'number' || typeof s.temp_f !== 'number') continue;
    forecast.push({
      timestamp_ms: s.timestamp_ms,
      time: typeof s.time === 'string' ? s.time : '',
      temp_f: s.temp_f,
      condition: typeof s.condition === 'string' ? s.condition : 'Unknown',
      pop: typeof s.pop === 'number' ? s.pop : undefined,
      wind_speed_mph: typeof s.wind_speed_mph === 'number' ? s.wind_speed_mph : undefined,
      wind_direction: typeof s.wind_direction === 'string' ? s.wind_direction : undefined,
      humidity: typeof s.humidity === 'number' ? s.humidity : 0,
      cloud_cover: typeof s.cloud_cover === 'number' ? s.cloud_cover : 0,
      barometric_pressure:
        typeof s.barometric_pressure === 'number' ? s.barometric_pressure : 30.0,
    });
  }
  const fetchedAt = typeof o.fetched_at === 'string' ? o.fetched_at : new Date().toISOString();
  return {
    current: {
      temperature_f: c.temperature_f,
      condition: c.condition,
      cloud_cover: typeof c.cloud_cover === 'number' ? c.cloud_cover : 0,
      wind_speed_mph: typeof c.wind_speed_mph === 'number' ? c.wind_speed_mph : 0,
      wind_direction: typeof c.wind_direction === 'string' ? c.wind_direction : 'N',
      barometric_pressure:
        typeof c.barometric_pressure === 'number' ? c.barometric_pressure : 30.0,
      humidity: typeof c.humidity === 'number' ? c.humidity : 0,
    },
    forecast,
    fetched_at: fetchedAt,
    cached: Boolean(o.cached),
  };
}

/**
 * Fetches normalized current + forecast via Edge (shared DB cache, 1h TTL).
 * Returns null when Edge is disabled, unauthenticated, or the invoke fails (caller may fall back).
 */
export async function fetchWeatherBundleForLocation(
  locationId: string | null | undefined,
): Promise<WeatherProxyBundle | null> {
  if (!USE_WEATHER_EDGE) {
    weatherClientLog('skip_edge_disabled', { EXPO_PUBLIC_USE_WEATHER_EDGE: process.env.EXPO_PUBLIC_USE_WEATHER_EDGE });
    return null;
  }
  if (!locationId || !isUuid(locationId)) {
    weatherClientLog('skip_no_or_invalid_location_id', { locationId: locationId ?? null });
    return null;
  }

  const existing = inflightBundles.get(locationId);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<WeatherProxyBundle | null> => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        weatherClientLog('skip_no_session', { locationId });
        return null;
      }

      weatherClientLog('invoke_edge_start', { locationId });
      const { data, error } = await supabase.functions.invoke('weather-proxy', {
        body: { location_id: locationId },
        headers: edgeFunctionInvokeHeaders(accessToken),
      });

      if (error) {
        let detail = error.message;
        if (error instanceof FunctionsHttpError && error.context) {
          const status = error.context.status;
          try {
            const j = (await error.context.clone().json()) as { error?: string; code?: string };
            if (typeof j?.error === 'string') detail = `${detail}: ${j.error}`;
          } catch {
            /* ignore */
          }
          if (status) detail = `${detail} [HTTP ${status}]`;
          if (status === 404 && __DEV__) {
            detail += ' (deploy weather-proxy: supabase functions deploy weather-proxy)';
          }
        }
        console.warn('[DriftGuide weather] edge_invoke_error', { locationId, detail });
        return null;
      }

      const bundle = parseProxyBundle(data);
      if (!bundle) {
        weatherClientLog('edge_response_parse_failed', { locationId });
        return null;
      }

      weatherClientLog('edge_ok', {
        locationId,
        serverCached: bundle.cached,
        fetchedAt: bundle.fetched_at,
        forecastSlots: bundle.forecast.length,
        tempF: bundle.current.temperature_f,
      });
      return bundle;
    } catch (e) {
      console.warn('[DriftGuide weather] edge_throw', { locationId, error: String(e) });
      return null;
    } finally {
      inflightBundles.delete(locationId);
    }
  })();
  inflightBundles.set(locationId, promise);
  return promise;
}

async function legacyGetWeather(lat: number, lng: number): Promise<WeatherData> {
  if (!LEGACY_OPENWEATHER_KEY) {
    await new Promise(resolve => setTimeout(resolve, 300));
    return { ...MOCK_WEATHER };
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${LEGACY_OPENWEATHER_KEY}&units=imperial`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || (data.cod != null && data.cod !== 200)) {
      return { ...MOCK_WEATHER };
    }

    const windDeg = data.wind?.deg ?? 0;
    const windSpeed = data.wind?.speed ?? 0;
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const dirIndex = Math.round(windDeg / 45) % 8;

    return {
      temperature_f: Math.round(data.main?.temp ?? MOCK_WEATHER.temperature_f),
      condition: data.weather?.[0]?.description || 'Unknown',
      cloud_cover: data.clouds?.all ?? 0,
      wind_speed_mph: Math.round(windSpeed),
      wind_direction: directions[dirIndex],
      barometric_pressure: data.main?.pressure != null ? +(data.main.pressure * 0.02953).toFixed(2) : 30.0,
      humidity: data.main?.humidity ?? 0,
    };
  } catch {
    return { ...MOCK_WEATHER };
  }
}

export async function getWeather(
  lat: number,
  lng: number,
  ctx?: WeatherFetchContext,
): Promise<WeatherData> {
  const bundle = await fetchWeatherBundleForLocation(ctx?.locationId);
  if (bundle) return bundle.current;
  weatherClientLog('getWeather_legacy_fallback', {
    locationId: ctx?.locationId ?? null,
    hasLegacyKey: Boolean(LEGACY_OPENWEATHER_KEY),
  });
  return legacyGetWeather(lat, lng);
}

/** Maps OpenWeather 3-hour forecast list entries to app forecast items. */
const WIND_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function slotToItem(slot: {
  dt: number;
  main?: { temp?: number };
  weather?: { description?: string }[];
  pop?: number;
  wind?: { speed?: number; deg?: number };
}): HourlyForecastItem {
  const slotDate = new Date(slot.dt * 1000);
  const hours = slotDate.getHours();
  const ampm = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const suffix = hours < 12 ? 'AM' : 'PM';
  const timeStr = `${ampm} ${suffix}`;
  const condition = slot.weather?.[0]?.description ?? 'Unknown';
  const windSpeed = slot.wind?.speed != null ? Math.round(slot.wind.speed) : undefined;
  const windDeg = slot.wind?.deg ?? 0;
  const windDirIndex = Math.round(windDeg / 45) % 8;
  const windDirection = windSpeed != null ? WIND_DIRECTIONS[windDirIndex] : undefined;
  return {
    timestamp_ms: slot.dt * 1000,
    time: timeStr,
    temp_f: Math.round(slot.main?.temp ?? 0),
    condition,
    pop: slot.pop != null ? Math.round(slot.pop * 100) : undefined,
    wind_speed_mph: windSpeed,
    wind_direction: windDirection,
  };
}

async function legacyGetHourlyForecast(lat: number, lng: number): Promise<HourlyForecastItem[]> {
  if (!LEGACY_OPENWEATHER_KEY) return [];

  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${LEGACY_OPENWEATHER_KEY}&units=imperial`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.list)) {
      return [];
    }

    const now = new Date();
    const items: HourlyForecastItem[] = [];

    for (const slot of data.list) {
      const dt = slot.dt * 1000;
      if (new Date(dt) < now) continue;
      items.push(slotToItem(slot));
    }

    return items;
  } catch {
    return [];
  }
}

function forecastSlotsToHourlyItems(slots: ProxyForecastSlot[]): HourlyForecastItem[] {
  return slots.map(s => ({
    timestamp_ms: s.timestamp_ms,
    time: s.time,
    temp_f: s.temp_f,
    condition: s.condition,
    pop: s.pop,
    wind_speed_mph: s.wind_speed_mph,
    wind_direction: s.wind_direction,
  }));
}

export async function getHourlyForecast(
  lat: number,
  lng: number,
  ctx?: WeatherFetchContext,
): Promise<HourlyForecastItem[]> {
  const bundle = await fetchWeatherBundleForLocation(ctx?.locationId);
  if (bundle) return forecastSlotsToHourlyItems(bundle.forecast);
  weatherClientLog('getHourlyForecast_legacy_fallback', {
    locationId: ctx?.locationId ?? null,
    hasLegacyKey: Boolean(LEGACY_OPENWEATHER_KEY),
  });
  return legacyGetHourlyForecast(lat, lng);
}

export type PlannedTimeWeatherSource = 'current' | 'forecast';

export type GetWeatherForPlannedTimeResult =
  | { status: 'ok'; data: WeatherData; source: PlannedTimeWeatherSource }
  | { status: 'too_far_out' };

function forecastSlotToWeatherData(slot: ProxyForecastSlot): WeatherData {
  return {
    temperature_f: slot.temp_f,
    condition: slot.condition,
    cloud_cover: slot.cloud_cover,
    wind_speed_mph: slot.wind_speed_mph ?? 0,
    wind_direction: slot.wind_direction ?? 'N',
    barometric_pressure: slot.barometric_pressure,
    humidity: slot.humidity,
  };
}

function getWeatherForPlannedTimeFromBundle(
  bundle: WeatherProxyBundle,
  plannedAt: Date,
): GetWeatherForPlannedTimeResult {
  const plannedMs = plannedAt.getTime();
  const nowMs = Date.now();
  const list = bundle.forecast;

  if (list.length === 0) {
    return { status: 'ok', data: bundle.current, source: 'current' };
  }

  const lastSlotMs = list[list.length - 1].timestamp_ms;
  if (plannedMs > lastSlotMs) {
    return { status: 'too_far_out' };
  }

  if (plannedMs < nowMs) {
    return { status: 'ok', data: bundle.current, source: 'current' };
  }

  let best = list[0];
  let bestDiff = Infinity;
  for (const slot of list) {
    const d = Math.abs(slot.timestamp_ms - plannedMs);
    if (d < bestDiff) {
      bestDiff = d;
      best = slot;
    }
  }

  return { status: 'ok', data: forecastSlotToWeatherData(best), source: 'forecast' };
}

export async function getWeatherForPlannedTime(
  lat: number,
  lng: number,
  plannedAt: Date,
  ctx?: WeatherFetchContext,
): Promise<GetWeatherForPlannedTimeResult> {
  const bundle = await fetchWeatherBundleForLocation(ctx?.locationId);
  if (bundle) {
    return getWeatherForPlannedTimeFromBundle(bundle, plannedAt);
  }

  if (!LEGACY_OPENWEATHER_KEY) {
    await new Promise(resolve => setTimeout(resolve, 300));
    return { status: 'ok', data: { ...MOCK_WEATHER }, source: 'forecast' };
  }

  const plannedMs = plannedAt.getTime();
  const nowMs = Date.now();

  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${LEGACY_OPENWEATHER_KEY}&units=imperial`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.list) || data.list.length === 0) {
      const current = await legacyGetWeather(lat, lng);
      return { status: 'ok', data: current, source: 'current' };
    }

    const list = data.list as {
      dt: number;
      main?: { temp?: number; pressure?: number; humidity?: number };
      weather?: { description?: string }[];
      clouds?: { all?: number };
      wind?: { speed?: number; deg?: number };
    }[];

    const lastSlotMs = list[list.length - 1].dt * 1000;
    if (plannedMs > lastSlotMs) {
      return { status: 'too_far_out' };
    }

    if (plannedMs < nowMs) {
      const current = await legacyGetWeather(lat, lng);
      return { status: 'ok', data: current, source: 'current' };
    }

    let best = list[0];
    let bestDiff = Infinity;
    for (const slot of list) {
      const t = slot.dt * 1000;
      const d = Math.abs(t - plannedMs);
      if (d < bestDiff) {
        bestDiff = d;
        best = slot;
      }
    }

    const windDeg = best.wind?.deg ?? 0;
    const windSpeed = best.wind?.speed ?? 0;
    const dirIndex = Math.round(windDeg / 45) % 8;
    return {
      status: 'ok',
      data: {
        temperature_f: Math.round(best.main?.temp ?? MOCK_WEATHER.temperature_f),
        condition: best.weather?.[0]?.description || 'Unknown',
        cloud_cover: best.clouds?.all ?? 0,
        wind_speed_mph: Math.round(windSpeed),
        wind_direction: WIND_DIRECTIONS[dirIndex],
        barometric_pressure:
          best.main?.pressure != null ? +(best.main.pressure * 0.02953).toFixed(2) : 30.0,
        humidity: best.main?.humidity ?? 0,
      },
      source: 'forecast',
    };
  } catch {
    const current = await legacyGetWeather(lat, lng);
    return { status: 'ok', data: current, source: 'current' };
  }
}
