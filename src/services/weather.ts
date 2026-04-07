import { WeatherData, HourlyForecastItem } from '@/src/types';

const OPENWEATHER_API_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;

const MOCK_WEATHER: WeatherData = {
  temperature_f: 58,
  condition: 'Partly Cloudy',
  cloud_cover: 45,
  wind_speed_mph: 8,
  wind_direction: 'SW',
  barometric_pressure: 30.12,
  humidity: 52,
};

export async function getWeather(lat: number, lng: number): Promise<WeatherData> {
  if (!OPENWEATHER_API_KEY) {
    await new Promise(resolve => setTimeout(resolve, 300));
    return { ...MOCK_WEATHER };
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=imperial`;
    const response = await fetch(url);
    const data = await response.json();

    // API returns { cod: 401 } etc. on error; success has cod 200 or no cod
    if (!response.ok || (data.cod != null && data.cod !== 200)) {
      return { ...MOCK_WEATHER };
    }

    // Wind can be omitted when calm; avoid reading undefined
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

/**
 * Fetches 5-day / 3-hour forecast (all future slots in the API response).
 * Free tier: up to 5 days at 3-hour steps (~40 points).
 * OpenWeatherMap returns cod as string "200" on success; we treat response.ok + list as success.
 */
export async function getHourlyForecast(lat: number, lng: number): Promise<HourlyForecastItem[]> {
  if (!OPENWEATHER_API_KEY) return [];

  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=imperial`;
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

export type PlannedTimeWeatherSource = 'current' | 'forecast';

export type GetWeatherForPlannedTimeResult =
  | { status: 'ok'; data: WeatherData; source: PlannedTimeWeatherSource }
  | { status: 'too_far_out' };

function forecastSlotToWeatherData(slot: {
  dt: number;
  main?: { temp?: number; pressure?: number; humidity?: number };
  weather?: { description?: string }[];
  clouds?: { all?: number };
  wind?: { speed?: number; deg?: number };
}): WeatherData {
  const windDeg = slot.wind?.deg ?? 0;
  const windSpeed = slot.wind?.speed ?? 0;
  const dirIndex = Math.round(windDeg / 45) % 8;
  return {
    temperature_f: Math.round(slot.main?.temp ?? MOCK_WEATHER.temperature_f),
    condition: slot.weather?.[0]?.description || 'Unknown',
    cloud_cover: slot.clouds?.all ?? 0,
    wind_speed_mph: Math.round(windSpeed),
    wind_direction: WIND_DIRECTIONS[dirIndex],
    barometric_pressure:
      slot.main?.pressure != null ? +(slot.main.pressure * 0.02953).toFixed(2) : 30.0,
    humidity: slot.main?.humidity ?? 0,
  };
}

/**
 * Weather for a user-chosen trip time: nearest 3-hour forecast slot within OpenWeather's ~5-day window,
 * or current conditions if the planned time is already in the past.
 */
export async function getWeatherForPlannedTime(
  lat: number,
  lng: number,
  plannedAt: Date,
): Promise<GetWeatherForPlannedTimeResult> {
  if (!OPENWEATHER_API_KEY) {
    await new Promise(resolve => setTimeout(resolve, 300));
    return { status: 'ok', data: { ...MOCK_WEATHER }, source: 'forecast' };
  }

  const plannedMs = plannedAt.getTime();
  const nowMs = Date.now();

  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=imperial`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.list) || data.list.length === 0) {
      const current = await getWeather(lat, lng);
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
      const current = await getWeather(lat, lng);
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

    return { status: 'ok', data: forecastSlotToWeatherData(best), source: 'forecast' };
  } catch {
    const current = await getWeather(lat, lng);
    return { status: 'ok', data: current, source: 'current' };
  }
}
