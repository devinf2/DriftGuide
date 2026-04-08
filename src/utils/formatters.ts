import { format, formatDistanceToNow, differenceInMinutes, differenceInHours } from 'date-fns';

/** Human-readable duration from milliseconds (floored to whole minutes). */
export function formatDurationFromMs(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const rem = totalMinutes % 60;
  if (rem === 0) return `${hours}h`;
  return `${hours}h ${rem}m`;
}

export function formatTripDuration(
  startTime: string,
  endTime: string | null,
  options?: { imported?: boolean | null; activeFishingMs?: number | null },
): string {
  if (options?.imported) return 'Imported';
  const active = options?.activeFishingMs;
  // `0` often means "unset" after sync/rehydration bugs; prefer wall-clock when the trip has an end time.
  if (active != null && Number.isFinite(active) && active > 0) {
    return formatDurationFromMs(active);
  }
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();
  const minutes = differenceInMinutes(end, start);

  if (minutes < 60) return `${minutes}m`;

  const hours = differenceInHours(end, start);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatEventTime(timestamp: string): string {
  return format(new Date(timestamp), 'h:mm a');
}

export function formatTripDate(dateString: string): string {
  return format(new Date(dateString), 'MMM d, yyyy');
}

export function formatRelativeTime(dateString: string): string {
  return formatDistanceToNow(new Date(dateString), { addSuffix: true });
}

export function formatFishCount(count: number): string {
  if (count === 0) return 'No fish';
  if (count === 1) return '1 fish';
  return `${count} fish`;
}

export function formatFlowRate(cfs: number): string {
  return `${Math.round(cfs)} CFS`;
}

export function formatTemperature(tempF: number): string {
  return `${Math.round(tempF)}°F`;
}
