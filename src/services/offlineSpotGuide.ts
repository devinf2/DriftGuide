import type { Location, LocationConditions } from '@/src/types';
import type { SpotFishingSummary } from '@/src/services/ai';
import { getSeason, getTimeOfDay } from '@/src/services/ai';

function fliesForSeason(season: string): string[] {
  switch (season) {
    case 'spring':
      return ['Blue Wing Olive', 'Parachute Adams', 'Pheasant Tail Nymph', 'Zebra Midge', 'Copper John', 'Elk Hair Caddis'];
    case 'summer':
      return ['Elk Hair Caddis', 'Stimulator', 'Hopper patterns', 'Pheasant Tail Nymph', 'Copper John', 'Woolly Bugger'];
    case 'fall':
      return ['Blue Wing Olive', 'Midges (generic)', 'Streamers / Woolly Bugger', 'Prince Nymph', 'Zebra Midge'];
    default:
      return ['Zebra Midge', 'Griffiths Gnat', 'Pheasant Tail Nymph', 'Woolly Bugger', 'San Juan Worm', 'Prince Nymph'];
  }
}

function bestTimeForClock(tod: string): string {
  if (tod === 'pre-dawn' || tod === 'early morning') return 'Dawn through mid-morning often fishes best.';
  if (tod === 'late morning' || tod === 'midday')
    return 'Midday can be slow on bright water — try deeper runs, shade, or nymphs under an indicator.';
  if (tod === 'afternoon' || tod === 'evening') return 'Late afternoon into evening frequently picks up as temps cool.';
  return 'Low light periods (early and late) are a good default when you lack live conditions.';
}

function waterBodyHint(type: Location['type']): string {
  switch (type) {
    case 'lake':
    case 'reservoir':
    case 'pond':
      return 'Stillwater: work structure, depth changes, and inlets; watch for wind lanes concentrating food.';
    case 'stream':
    case 'river':
    default:
      return 'Moving water: focus on seams, pocket water, and softer edges behind structure.';
  }
}

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
    bestTime: bestTimeForClock(tod).replace(/\.$/, ''),
    sources: [],
    fishingQualitySignal: null,
    fetchedAt: now.toISOString(),
  };
}
