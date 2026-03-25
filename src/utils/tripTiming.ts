/** Re-export for screens that already import trip timing (keeps Metro/Hermes from dropping `formatTripDuration` when the timer bundle needs it). */
export { formatTripDuration } from './formatters';

/** Active fishing time excluding paused intervals (client-side; also logged via note events). */
export function getLiveFishingElapsedMs(
  fishingElapsedMs: number | undefined,
  fishingSegmentStartedAt: string | null | undefined,
  isTripPaused: boolean | undefined,
  /** When segment start was never persisted (e.g. pre–pause feature), fall back to trip start. */
  tripStartTimeIso: string | null,
): number {
  const base = fishingElapsedMs ?? 0;
  if (isTripPaused) return base;
  const segment = fishingSegmentStartedAt ?? tripStartTimeIso;
  if (!segment) return base;
  return base + (Date.now() - new Date(segment).getTime());
}

export function formatFishingElapsedLabel(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const rem = totalMinutes % 60;
  if (rem === 0) return `${hours}h`;
  return `${hours}h ${rem}m`;
}
