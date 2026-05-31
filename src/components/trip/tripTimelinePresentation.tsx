import type { AIQueryData, CatchData, FlyChangeData, NoteData, TripEvent } from '@/src/types';
import { Text, View } from 'react-native';
import {
  getCatchDetailLines,
  getFlyChangeTimelineDescription,
  getTripEventDescription,
  type TimelineFlySlot,
} from '@/src/utils/journalTimeline';

export function getTimelineRowPresentation(
  event: TripEvent,
  flySlot: TimelineFlySlot | null,
): { title: string; subtitle: string | null } {
  switch (event.event_type) {
    case 'fly_change': {
      if (!flySlot) {
        return { title: getTripEventDescription(event), subtitle: null };
      }
      const fd = event.data as FlyChangeData;
      const title = getFlyChangeTimelineDescription(event, flySlot);
      const color = flySlot === 'secondary' ? fd.color2 : fd.color;
      const size = flySlot === 'secondary' ? fd.size2 : fd.size;
      const parts: string[] = [];
      if (color != null && String(color).trim()) parts.push(String(color).trim());
      if (size != null) parts.push(`Size ${size}`);
      return { title, subtitle: parts.length > 0 ? parts.join(' • ') : null };
    }
    case 'catch': {
      const data = event.data as CatchData;
      const species = data.species?.trim() || null;
      const sizeInches = data.size_inches;
      const detail: string[] = [];
      if (sizeInches != null) detail.push(`${sizeInches}"`);
      if (species) detail.push(species);
      return {
        title: 'Fish caught',
        subtitle: detail.length > 0 ? detail.join(' ') : null,
      };
    }
    case 'bite':
      return { title: 'Bite', subtitle: null };
    case 'fish_on':
      return { title: 'Fish on', subtitle: null };
    case 'got_off':
      return { title: 'Got off', subtitle: null };
    case 'note': {
      const text = ((event.data as NoteData).text ?? '').trim();
      if (/^trip (started|ended|paused|resumed)/i.test(text)) {
        return { title: text, subtitle: null };
      }
      const preview = text.length > 72 ? `${text.slice(0, 72)}…` : text;
      return { title: 'Note', subtitle: preview || null };
    }
    case 'ai_query': {
      const q = ((event.data as AIQueryData).question ?? '').trim();
      const preview = q.length > 72 ? `${q.slice(0, 72)}…` : q;
      return { title: 'AI question', subtitle: preview || null };
    }
    default:
      return { title: getTripEventDescription(event), subtitle: null };
  }
}

export function CatchDetailsBlock({ data, styles }: { data: CatchData; styles: Record<string, object> }) {
  const lines = getCatchDetailLines(data);
  if (lines.length === 0) return null;
  return (
    <View style={styles.timelineCatchDetails}>
      {lines.map((line, i) => (
        <Text key={i} style={styles.timelineCatchDetailLine}>
          {line}
        </Text>
      ))}
    </View>
  );
}
