import type { MoonPhase } from '@/src/types';

/** Synodic month in days (new moon to new moon). */
const SYNODIC_DAYS = 29.530588853;

/** Reference: known new moon (UTC). */
const REF_NEW_MOON = new Date('2000-01-06T18:14:00Z').getTime();

/**
 * Returns moon phase for a given date using a simple synodic month calculation.
 * No API call; suitable for offline use.
 */
export function getMoonPhase(date: Date): MoonPhase {
  const t = date.getTime();
  const daysSinceRef = (t - REF_NEW_MOON) / (24 * 60 * 60 * 1000);
  const cyclePosition = (daysSinceRef % SYNODIC_DAYS) / SYNODIC_DAYS; // 0 = new, 0.5 = full
  const index = Math.floor(cyclePosition * 8 + 0.5) % 8;
  const phases: MoonPhase[] = [
    'new',
    'waxing_crescent',
    'first_quarter',
    'waxing_gibbous',
    'full',
    'waning_gibbous',
    'last_quarter',
    'waning_crescent',
  ];
  return phases[index];
}

/** Human-readable labels for current conditions / UI */
export const MOON_PHASE_LABELS: Record<MoonPhase, string> = {
  new: 'New Moon',
  waxing_crescent: 'Waxing Crescent',
  first_quarter: 'First Quarter',
  waxing_gibbous: 'Waxing Gibbous',
  full: 'Full Moon',
  waning_gibbous: 'Waning Gibbous',
  last_quarter: 'Last Quarter',
  waning_crescent: 'Waning Crescent',
};
