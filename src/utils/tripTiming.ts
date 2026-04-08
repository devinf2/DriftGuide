import type { TripEvent } from '@/src/types';
import { coerceTripEventDataObject } from '@/src/utils/journalTimeline';
import { formatDurationFromMs, formatTripDuration } from './formatters';

/** Re-export for screens that already import trip timing (keeps Metro/Hermes from dropping `formatTripDuration` when the timer bundle needs it). */
export { formatTripDuration };

export const formatFishingElapsedLabel = formatDurationFromMs;

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

function pauseResumeNoteText(e: TripEvent): string | null {
  if (e.event_type !== 'note') return null;
  const d = coerceTripEventDataObject(e);
  return typeof d.text === 'string' ? d.text : null;
}

/**
 * When `active_fishing_ms` was never stored (legacy), infer active time from
 * "Trip paused" / "Trip resumed" note events. Returns null if there were no pauses
 * (caller should use wall-clock start→end).
 */
export function inferActiveFishingMsFromPauseResumeEvents(
  startTimeIso: string,
  endTimeIso: string | null,
  events: TripEvent[],
): number | null {
  const hasPause = events.some((e) => pauseResumeNoteText(e) === 'Trip paused');
  if (!hasPause) return null;

  const endMs = endTimeIso ? new Date(endTimeIso).getTime() : Date.now();
  const startMs = new Date(startTimeIso).getTime();
  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  let runningStart: number | null = startMs;
  let total = 0;
  for (const e of sorted) {
    const t = new Date(e.timestamp).getTime();
    const text = pauseResumeNoteText(e);
    if (text === 'Trip paused' && runningStart != null) {
      total += Math.max(0, t - runningStart);
      runningStart = null;
    } else if (text === 'Trip resumed') {
      runningStart = t;
    }
  }
  if (runningStart != null) {
    total += Math.max(0, endMs - runningStart);
  }
  return Math.max(0, Math.round(total));
}
