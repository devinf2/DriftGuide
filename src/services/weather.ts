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

/**
 * Fetches 5-day / 3-hour forecast and returns today's remaining slots (and next day if early).
 * Uses same API key as getWeather. Free tier: 5 day forecast with 3-hour steps.
 */
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
    time: timeStr,
    temp_f: Math.round(slot.main?.temp ?? 0),
    condition,
    pop: slot.pop != null ? Math.round(slot.pop * 100) : undefined,
    wind_speed_mph: windSpeed,
    wind_direction: windDirection,
  };
}

/**
 * Fetches 5-day / 3-hour forecast and returns today's remaining slots (and next day if early).
 * Uses same API key as getWeather. Free tier: 5 day forecast with 3-hour steps.
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
    const cutoff = new Date(now);
    cutoff.setHours(cutoff.getHours() + 24);
    const items: HourlyForecastItem[] = [];
    const fallbackItems: HourlyForecastItem[] = [];
    const maxFallback = 8;

    for (const slot of data.list) {
      const dt = slot.dt * 1000;
      const slotDate = new Date(dt);
      if (slotDate < now) continue;

      const item = slotToItem(slot);
      if (slotDate <= cutoff) {
        items.push(item);
      }
      if (fallbackItems.length < maxFallback) {
        fallbackItems.push(item);
      }
    }

    return items.length > 0 ? items : fallbackItems;
  } catch {
    return [];
  }
}
