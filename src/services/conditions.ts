import { Location, LocationConditions, ConditionRating, WaterClarity, WeatherData, WaterFlowData } from '@/src/types';
import { getWeather, getWeatherForPlannedTime } from './weather';
import { getStreamFlow } from './waterFlow';

function rateWind(speedMph: number): ConditionRating {
  if (speedMph <= 10) return 'good';
  if (speedMph <= 20) return 'fair';
  return 'poor';
}

function rateTemperature(tempF: number): ConditionRating {
  if (tempF >= 45 && tempF <= 80) return 'good';
  if (tempF >= 35 && tempF <= 90) return 'fair';
  return 'poor';
}

function rateWater(clarity: WaterClarity): ConditionRating {
  if (clarity === 'clear' || clarity === 'slightly_stained') return 'good';
  if (clarity === 'stained' || clarity === 'unknown') return 'fair';
  return 'poor';
}

function rateSky(condition: string): ConditionRating {
  const c = condition.toLowerCase();
  if (c === 'unavailable') return 'fair';
  if (c.includes('thunder') || c.includes('storm') || c.includes('blizzard')) return 'poor';
  if (c.includes('rain') || c.includes('drizzle') || c.includes('shower') || c.includes('snow') || c.includes('sleet')) return 'poor';
  if (c.includes('overcast') || c.includes('fog') || c.includes('mist') || c.includes('haze')) return 'fair';
  if (c.includes('cloud') || c.includes('broken') || c.includes('scattered')) return 'fair';
  return 'good';
}

export function formatSkyLabel(condition: string): string {
  const c = condition.toLowerCase();
  if (c === 'unavailable') return '\u2014';
  if (c.includes('thunder') || c.includes('storm')) return 'Storm';
  if (c.includes('heavy rain')) return 'Heavy Rain';
  if (c.includes('rain') || c.includes('drizzle') || c.includes('shower')) return 'Rain';
  if (c.includes('snow') || c.includes('blizzard')) return 'Snow';
  if (c.includes('sleet')) return 'Sleet';
  if (c.includes('overcast')) return 'Overcast';
  if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return 'Foggy';
  if (c.includes('partly') || c.includes('few')) return 'Ptly Cloudy';
  if (c.includes('cloud') || c.includes('broken') || c.includes('scattered')) return 'Cloudy';
  if (c.includes('clear') || c.includes('sunny')) return 'Clear';
  return condition.length > 12 ? condition.slice(0, 12) : condition;
}

export function getWeatherIconName(condition: string): string {
  const c = condition.toLowerCase();
  if (c === 'unavailable') return 'cloud-offline-outline';
  if (c.includes('thunder') || c.includes('storm')) return 'thunderstorm-outline';
  if (c.includes('snow') || c.includes('blizzard') || c.includes('sleet')) return 'snow-outline';
  if (c.includes('rain') || c.includes('drizzle') || c.includes('shower')) return 'rainy-outline';
  if (c.includes('overcast') || c.includes('fog') || c.includes('mist')) return 'cloud-outline';
  if (c.includes('cloud') || c.includes('broken') || c.includes('scattered') || c.includes('partly')) return 'partly-sunny-outline';
  return 'sunny-outline';
}

export async function fetchLocationConditions(
  location: Location,
  allLocations?: Location[],
): Promise<LocationConditions> {
  const stationId = (location.metadata as Record<string, string> | null)?.usgs_station_id;

  // Use parent's coordinates when this location has none (e.g. child reach without its own lat/long)
  const parent = location.parent_location_id && allLocations
    ? allLocations.find(l => l.id === location.parent_location_id)
    : null;
  const lat = location.latitude ?? parent?.latitude ?? null;
  const lng = location.longitude ?? parent?.longitude ?? null;

  const [weather, waterFlow] = await Promise.all([
    lat != null && lng != null
      ? getWeather(lat, lng, { locationId: location.id })
      : Promise.resolve(null),
    stationId ? getStreamFlow(stationId) : Promise.resolve(null),
  ]);

  const condition = weather?.condition ?? 'Clear';
  const windSpeed = weather?.wind_speed_mph ?? 0;
  // Prefer USGS water temp for river/stream locations when available; otherwise use air temp
  const tempF = waterFlow?.water_temp_f ?? weather?.temperature_f ?? 60;
  const clarity = waterFlow?.clarity ?? 'unknown';
  const flowCfs = waterFlow?.flow_cfs ?? null;

  return {
    locationId: location.id,
    sky: { condition, label: formatSkyLabel(condition), rating: rateSky(condition) },
    wind: { speed_mph: windSpeed, rating: rateWind(windSpeed) },
    temperature: { temp_f: tempF, rating: rateTemperature(tempF) },
    water: { clarity, flow_cfs: flowCfs, rating: rateWater(clarity) },
    fetchedAt: new Date().toISOString(),
    rawWeather: weather,
    rawWaterFlow: waterFlow,
  };
}

/** Rating points for weighted score (good=3, fair=2, poor=1). */
const RATING_POINTS: Record<ConditionRating, number> = {
  good: 3,
  fair: 2,
  poor: 1,
};

/** Rate flow from CFS when no baseline is available. Generic bands for wadeable rivers. */
function rateFlowFromCfs(flowCfs: number): ConditionRating {
  if (flowCfs < 40) return 'poor'; // critically low or dewatered risk
  if (flowCfs < 120) return 'fair';
  if (flowCfs <= 2000) return 'good';
  if (flowCfs <= 4500) return 'fair';
  return 'poor'; // very high, wading unsafe
}

/** Effective water rating: combine clarity with flow when flow data exists (use worse of the two). */
function getWaterPoints(conditions: LocationConditions): number {
  const clarityPoints = RATING_POINTS[conditions.water.rating];
  const flowCfs = conditions.water.flow_cfs;
  if (flowCfs == null) return clarityPoints;
  const flowRating = rateFlowFromCfs(flowCfs);
  const flowPoints = RATING_POINTS[flowRating];
  return Math.min(clarityPoints, flowPoints);
}

/** Weights: water (clarity + flow) counts double for fishing quality. */
const WEIGHT_SKY = 1;
const WEIGHT_WIND = 1;
const WEIGHT_TEMP = 1;
const WEIGHT_WATER = 2;

/** Result of DriftGuide conditions score: continuous 0–5 for display, plus optional "fire". */
export interface DriftGuideScoreResult {
  /** Continuous 0–5 (e.g. 3.4 for 3 full + 40% of 4th). Use for full/half/proportional star display. */
  stars: number;
  showFire: boolean;
}

/** Compute a 0–5 star score (continuous) from current conditions, with water (and flow) weighted more. Fire = 5 stars. */
export function getDriftGuideScore(conditions: LocationConditions): DriftGuideScoreResult {
  const waterP = getWaterPoints(conditions);

  if (conditions.plannedTimeWeatherUnavailable) {
    const weightedSum = WEIGHT_WATER * waterP;
    const maxWeighted = WEIGHT_WATER * 3;
    const normalized = weightedSum / maxWeighted;
    const stars = Math.max(0, Math.min(5, Math.round(normalized * 5 * 10) / 10));
    return {
      stars,
      showFire: false,
    };
  }

  const skyP = RATING_POINTS[conditions.sky.rating];
  const windP = RATING_POINTS[conditions.wind.rating];
  const tempP = RATING_POINTS[conditions.temperature.rating];

  const weightedSum =
    WEIGHT_SKY * skyP +
    WEIGHT_WIND * windP +
    WEIGHT_TEMP * tempP +
    WEIGHT_WATER * waterP;
  const maxWeighted = WEIGHT_SKY * 3 + WEIGHT_WIND * 3 + WEIGHT_TEMP * 3 + WEIGHT_WATER * 3;

  const normalized = weightedSum / maxWeighted; // 0–1
  const stars = Math.max(0, Math.min(5, Math.round(normalized * 5 * 10) / 10)); // 1 decimal, e.g. 3.4

  return {
    stars,
    showFire: stars >= 4.75,
  };
}

export async function fetchAllLocationConditions(
  locations: Location[],
): Promise<Map<string, LocationConditions>> {
  const results = new Map<string, LocationConditions>();

  const settled = await Promise.allSettled(
    locations.map(loc => fetchLocationConditions(loc, locations)),
  );

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.set(result.value.locationId, result.value);
    }
  }

  return results;
}

function coordKey(lat: number, lng: number): string {
  return `${lat},${lng}`;
}

function resolveLocationCoords(
  location: Location,
  allLocations: Location[],
): { lat: number; lng: number } | null {
  const parent = location.parent_location_id
    ? allLocations.find(l => l.id === location.parent_location_id)
    : null;
  const lat = location.latitude ?? parent?.latitude ?? null;
  const lng = location.longitude ?? parent?.longitude ?? null;
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

async function buildLocationConditionsWithWeather(
  location: Location,
  allLocations: Location[],
  weather: WeatherData | null,
  plannedTimeWeatherUnavailable: boolean,
  weatherIsForecastForPlannedTime: boolean,
): Promise<LocationConditions> {
  const stationId = (location.metadata as Record<string, string> | null)?.usgs_station_id;
  const waterFlow = stationId ? await getStreamFlow(stationId) : null;

  const condition = plannedTimeWeatherUnavailable ? 'unavailable' : (weather?.condition ?? 'Clear');
  const windSpeed = plannedTimeWeatherUnavailable ? 0 : (weather?.wind_speed_mph ?? 0);
  const tempF = plannedTimeWeatherUnavailable
    ? 60
    : (waterFlow?.water_temp_f ?? weather?.temperature_f ?? 60);
  const clarity = waterFlow?.clarity ?? 'unknown';
  const flowCfs = waterFlow?.flow_cfs ?? null;

  return {
    locationId: location.id,
    sky: { condition, label: formatSkyLabel(condition), rating: rateSky(condition) },
    wind: { speed_mph: windSpeed, rating: plannedTimeWeatherUnavailable ? 'fair' : rateWind(windSpeed) },
    temperature: {
      temp_f: tempF,
      rating: plannedTimeWeatherUnavailable ? 'fair' : rateTemperature(tempF),
    },
    water: { clarity, flow_cfs: flowCfs, rating: rateWater(clarity) },
    fetchedAt: new Date().toISOString(),
    rawWeather: plannedTimeWeatherUnavailable ? null : weather,
    rawWaterFlow: waterFlow,
    ...(weatherIsForecastForPlannedTime ? { weatherIsForecastForPlannedTime: true } : {}),
    ...(plannedTimeWeatherUnavailable ? { plannedTimeWeatherUnavailable: true } : {}),
  };
}

/**
 * Conditions for plan-a-trip: one forecast request per distinct coordinates; water/flow still current USGS.
 */
export async function fetchAllLocationConditionsForPlannedTime(
  locations: Location[],
  plannedAt: Date,
): Promise<Map<string, LocationConditions>> {
  const results = new Map<string, LocationConditions>();
  const groupCoords = new Map<string, { lat: number; lng: number; repLocationId: string }>();
  const locationCoords = new Map<string, { lat: number; lng: number } | null>();

  for (const loc of locations) {
    const coords = resolveLocationCoords(loc, locations);
    locationCoords.set(loc.id, coords);
    if (coords) {
      const key = coordKey(coords.lat, coords.lng);
      if (!groupCoords.has(key)) {
        groupCoords.set(key, { ...coords, repLocationId: loc.id });
      }
    }
  }

  const weatherByKey = new Map<string, Awaited<ReturnType<typeof getWeatherForPlannedTime>>>();
  await Promise.all(
    Array.from(groupCoords.values()).map(async ({ lat, lng, repLocationId }) => {
      const key = coordKey(lat, lng);
      const r = await getWeatherForPlannedTime(lat, lng, plannedAt, { locationId: repLocationId });
      weatherByKey.set(key, r);
    }),
  );

  const settled = await Promise.allSettled(
    locations.map(async loc => {
      const coords = locationCoords.get(loc.id) ?? null;
      let weather: WeatherData | null = null;
      let plannedTimeWeatherUnavailable = false;
      let weatherIsForecastForPlannedTime = false;

      if (coords) {
        const wr = weatherByKey.get(coordKey(coords.lat, coords.lng));
        if (wr?.status === 'ok') {
          weather = wr.data;
          weatherIsForecastForPlannedTime = wr.source === 'forecast';
        } else {
          plannedTimeWeatherUnavailable = true;
        }
      }

      return buildLocationConditionsWithWeather(
        loc,
        locations,
        weather,
        plannedTimeWeatherUnavailable,
        weatherIsForecastForPlannedTime,
      );
    }),
  );

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.set(result.value.locationId, result.value);
    }
  }

  return results;
}

/** Build LocationConditions from trip-store weather + water flow (for Strategy tab on trip view). */
export function buildConditionsFromWeatherAndFlow(
  weather: WeatherData | null,
  waterFlow: WaterFlowData | null,
  locationId: string,
): LocationConditions | null {
  if (!weather && !waterFlow) return null;
  const condition = weather?.condition ?? 'Clear';
  const windSpeed = weather?.wind_speed_mph ?? 0;
  const tempF = waterFlow?.water_temp_f ?? weather?.temperature_f ?? 60;
  const clarity = waterFlow?.clarity ?? 'unknown';
  const flowCfs = waterFlow?.flow_cfs ?? null;
  return {
    locationId,
    sky: { condition, label: formatSkyLabel(condition), rating: rateSky(condition) },
    wind: { speed_mph: windSpeed, rating: rateWind(windSpeed) },
    temperature: { temp_f: tempF, rating: rateTemperature(tempF) },
    water: { clarity, flow_cfs: flowCfs, rating: rateWater(clarity) },
    fetchedAt: new Date().toISOString(),
    rawWeather: weather,
    rawWaterFlow: waterFlow,
  };
}
