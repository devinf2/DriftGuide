import { WeatherData } from '@/src/types';

const WIND_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** WMO Weather interpretation codes (Open-Meteo). */
function wmoCodeToCondition(code: number): string {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 55) return 'Drizzle';
  if (code >= 56 && code <= 57) return 'Freezing drizzle';
  if (code >= 61 && code <= 65) return 'Rain';
  if (code >= 66 && code <= 67) return 'Freezing rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95 && code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

function parseOpenMeteoUtcHour(iso: string): number {
  const [datePart, timePart = '00:00'] = iso.split('T');
  const [Y, M, D] = datePart.split('-').map((x) => parseInt(x, 10));
  const [h, m = 0] = timePart.split(':').map((x) => parseInt(x, 10));
  return Date.UTC(Y, M - 1, D, h, m, 0, 0);
}

/**
 * Historical hour closest to `at` from Open-Meteo archive (free, no API key).
 * Uses UTC alignment for hourly rows; pairing with EXIF-derived Date is best-effort.
 */
export async function fetchHistoricalWeather(
  lat: number,
  lng: number,
  at: Date,
): Promise<WeatherData | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Number.isNaN(at.getTime())) return null;

  const pad = 86400000;
  const start = new Date(at.getTime() - pad);
  const end = new Date(at.getTime() + pad);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('start_date', ymd(start));
  url.searchParams.set('end_date', ymd(end));
  url.searchParams.set(
    'hourly',
    'temperature_2m,weather_code,cloud_cover,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure',
  );
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('timezone', 'UTC');

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as {
      hourly?: {
        time?: string[];
        temperature_2m?: (number | null)[];
        weather_code?: (number | null)[];
        cloud_cover?: (number | null)[];
        relative_humidity_2m?: (number | null)[];
        wind_speed_10m?: (number | null)[];
        wind_direction_10m?: (number | null)[];
        surface_pressure?: (number | null)[];
      };
    };

    const hourly = data.hourly;
    const times = hourly?.time;
    if (!times?.length) return null;

    const target = at.getTime();
    let bestI = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = parseOpenMeteoUtcHour(times[i]);
      const diff = Math.abs(t - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestI = i;
      }
    }

    const temp = hourly!.temperature_2m?.[bestI];
    const code = hourly!.weather_code?.[bestI];
    if (temp == null || code == null) return null;

    const cloud = hourly!.cloud_cover?.[bestI] ?? 0;
    const humidity = hourly!.relative_humidity_2m?.[bestI] ?? 0;
    const windSpeed = hourly!.wind_speed_10m?.[bestI] ?? 0;
    const windDeg = hourly!.wind_direction_10m?.[bestI] ?? 0;
    const hPa = hourly!.surface_pressure?.[bestI];
    const dirIndex = Math.round(windDeg / 45) % 8;

    return {
      temperature_f: Math.round(temp),
      condition: wmoCodeToCondition(Number(code)),
      cloud_cover: Math.round(Math.min(100, Math.max(0, cloud))),
      wind_speed_mph: Math.round(windSpeed),
      wind_direction: WIND_DIRECTIONS[dirIndex] ?? 'N',
      barometric_pressure:
        hPa != null ? Math.round(hPa * 0.02953 * 100) / 100 : 30.0,
      humidity: Math.round(Math.min(100, Math.max(0, humidity))),
    };
  } catch {
    return null;
  }
}
