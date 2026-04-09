import type { Location, LocationConditions } from '@/src/types';
import type { SpotFishingSummary } from '@/src/services/ai';
import { getSeason, getTimeOfDay } from '@/src/services/ai';
import { bestTimeForClock, clockRangeForTimeOfDay, fliesForSeason, waterBodyHint } from '@/src/utils/offlineGuideBasics';

/**
 * Deterministic spot briefing when offline / no cached AI — season, time of day, water type.
 */
export function buildOfflineSpotGuide(
  location: Location,
  conditions: LocationConditions | null,
): SpotFishingSummary {
  const now = new Date();
  const season = getSeason(now);
  const tod = getTimeOfDay(now);
  const flies = fliesForSeason(season);
  const condLine =
    conditions?.water?.rating != null
      ? ` Saved conditions snapshot (water ${conditions.water.rating}) is a rough offline hint.`
      : '';

  const report = [
    `Offline guide for ${location.name} (${season}, ${tod.replace(/-/g, ' ')}).`,
    waterBodyHint(location.type),
    bestTimeForClock(tod),
    condLine.trim(),
    ' Reconnect for live weather, flows, and AI-tailored advice.',
  ]
    .filter(Boolean)
    .join('');

  return {
    report,
    topFlies: flies.slice(0, 6),
    bestTime: clockRangeForTimeOfDay(tod),
    sources: [],
    fishingQualitySignal: null,
    fetchedAt: now.toISOString(),
  };
}
