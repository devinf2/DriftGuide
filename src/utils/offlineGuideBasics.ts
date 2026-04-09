import type { Location } from '@/src/types';

export function fliesForSeason(season: string): string[] {
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

export function waterBodyHint(type: Location['type']): string {
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

export function bestTimeForClock(tod: string): string {
  if (tod === 'pre-dawn' || tod === 'early morning') return 'Dawn through mid-morning often fishes best.';
  if (tod === 'late morning' || tod === 'midday')
    return 'Midday can be slow on bright water — try deeper runs, shade, or nymphs under an indicator.';
  if (tod === 'afternoon' || tod === 'evening') return 'Late afternoon into evening frequently picks up as temps cool.';
  return 'Low light periods (early and late) are a good default when you lack live conditions.';
}

/** Compact clock window for UI tiles; keys match `getTimeOfDay()` buckets. */
export function clockRangeForTimeOfDay(tod: string): string {
  switch (tod) {
    case 'pre-dawn':
      return '5–7 AM';
    case 'early morning':
      return '6–9 AM';
    case 'late morning':
      return '9 AM–12 PM';
    case 'midday':
      return '11 AM–2 PM';
    case 'afternoon':
      return '2–5 PM';
    case 'evening':
      return '5–8 PM';
    case 'night':
      return '8–10 PM';
    default:
      return '6–9 AM & 5–8 PM';
  }
}

const HAS_CLOCK_DIGIT = /\d/;

/**
 * Keep model output when it already includes hours; otherwise substitute a clock range from the time bucket.
 */
export function ensureBestTimeIsClockRange(bestTime: string, timeOfDay: string): string {
  const t = bestTime.trim();
  if (t && HAS_CLOCK_DIGIT.test(t)) return t;
  return clockRangeForTimeOfDay(timeOfDay);
}
