import type { EventConditionsSnapshot, WaterFlowData, WeatherData } from '@/src/types';
import { getMoonPhase } from '@/src/utils/moonPhase';

/** Shared builder for trip events / catches (live or historical). */
export function buildEventConditionsSnapshot(
  weather: WeatherData | null,
  waterFlow: WaterFlowData | null,
  capturedAt: Date = new Date(),
): EventConditionsSnapshot | null {
  if (!weather && !waterFlow) return null;
  return {
    weather,
    waterFlow,
    captured_at: capturedAt.toISOString(),
    moon_phase: getMoonPhase(capturedAt),
  };
}
