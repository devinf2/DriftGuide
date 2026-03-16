import { format, formatDistanceToNow, differenceInMinutes, differenceInHours } from 'date-fns';

export function formatTripDuration(startTime: string, endTime: string | null): string {
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
