import type { ThemeColors } from '@/src/constants/theme';

export type TripLifecycleTimelineIcon = {
  name: 'play-arrow' | 'pause';
  color: string;
};

/** Icons for auto-generated trip session notes on the fishing timeline. */
export function tripLifecycleNoteTimelineIcon(
  noteText: string | undefined,
  colors: ThemeColors,
): TripLifecycleTimelineIcon | null {
  if (noteText === 'Trip started' || noteText === 'Trip resumed') {
    return { name: 'play-arrow', color: colors.success };
  }
  if (noteText === 'Trip paused') {
    return { name: 'pause', color: colors.warning };
  }
  return null;
}
