import type { Location, LocationConditions } from '@/src/types';

export type SpotGearChip = {
  key: string;
  /** Bold lead token, e.g. "5 wt" */
  lead: string;
  /** Remainder of the chip, e.g. "· 9 ft rod" */
  rest?: string;
};

const STILLWATER_TYPES = new Set(['lake', 'reservoir', 'pond']);

/**
 * First-pass, rule-based gear for a water. Deliberately static (no network / AI): derived from the
 * water type plus the one temperature signal we have (air temp). Cheap and trustworthy — an AI gear
 * call can come later if this proves too coarse.
 */
export function deriveSpotGear(loc: Location, conditions: LocationConditions): SpotGearChip[] {
  const stillwater = STILLWATER_TYPES.has(loc.type);
  const airF = conditions.temperature?.temp_f ?? null;

  let rod: SpotGearChip;
  let tippet: SpotGearChip;
  if (stillwater) {
    rod = { key: 'rod', lead: '6 wt', rest: '· 9 ft rod' };
    tippet = { key: 'tippet', lead: '3–5X', rest: 'tippet' };
  } else if (loc.type === 'stream') {
    rod = { key: 'rod', lead: '3–4 wt', rest: "· 8'6\" rod" };
    tippet = { key: 'tippet', lead: '5–6X', rest: 'tippet' };
  } else {
    rod = { key: 'rod', lead: '5 wt', rest: '· 9 ft rod' };
    tippet = { key: 'tippet', lead: '4–6X', rest: 'tippet' };
  }

  const wading: SpotGearChip =
    airF != null && airF < 60
      ? { key: 'wading', lead: 'Waders', rest: airF < 45 ? '(cold)' : undefined }
      : { key: 'wading', lead: 'Wet-wade', rest: 'OK' };

  return [rod, tippet, wading];
}
