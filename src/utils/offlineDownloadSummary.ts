import type { CatchRow, CommunityCatchRow, ConditionsSnapshotRow } from '@/src/types';
import type { OfflineTripSummary } from '@/src/services/sync';
import type { DownloadedWaterway } from '@/src/services/waterwayCache';
import { formatCatchWeightLabel } from '@/src/utils/journalTimeline';

export function offlineWaterwayLabel(w: DownloadedWaterway): string {
  if (w.locationId.startsWith('offline-custom-')) return 'Custom map region';
  return w.locations.find((l) => l.id === w.locationId)?.name ?? w.locationId;
}

const OFFLINE_DETAIL_MAX_CATCH_LINES = 80;
const OFFLINE_NOTE_MAX_CHARS = 1200;

function formatLocaleDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatFlyFullDisplay(
  pattern: string | null | undefined,
  size: number | null | undefined,
  color: string | null | undefined,
): string {
  const p = pattern?.trim() || '';
  const sz = size != null ? `#${size}` : '';
  const col = color?.trim() || '';
  return [p, sz, col].filter(Boolean).join(' · ');
}

function clipLongNote(note: string | null | undefined): string | null {
  const t = note?.trim();
  if (!t) return null;
  if (t.length <= OFFLINE_NOTE_MAX_CHARS) return t;
  return `${t.slice(0, OFFLINE_NOTE_MAX_CHARS)}…`;
}

function formatConditionsSnapshotCompact(s: ConditionsSnapshotRow | undefined): string | null {
  if (!s) return null;
  const bits: string[] = [];
  if (s.temperature_f != null) bits.push(`${s.temperature_f}°F`);
  if (s.condition) bits.push(String(s.condition));
  if (s.wind_speed_mph != null) bits.push(`wind ${s.wind_speed_mph} mph`);
  if (s.flow_cfs != null) bits.push(`flow ${s.flow_cfs} cfs`);
  if (s.water_temp_f != null) bits.push(`water ${s.water_temp_f}°F`);
  if (s.moon_phase) bits.push(`moon ${s.moon_phase}`);
  if (bits.length === 0) return null;
  return `At catch: ${bits.join(' · ')}`;
}

function snapshotById(
  snaps: ConditionsSnapshotRow[],
  id: string | null | undefined,
): ConditionsSnapshotRow | undefined {
  if (!id) return undefined;
  return snaps.find((x) => x.id === id);
}

function formatCommunityTripContextLines(c: CommunityCatchRow): string[] {
  const lines: string[] = [];
  const head: string[] = [];
  if (c.trip_fishing_type) head.push(c.trip_fishing_type);
  if (c.trip_session_type) head.push(`session: ${c.trip_session_type}`);
  if (c.trip_status) head.push(`trip ${c.trip_status}`);
  if (head.length) lines.push(`      Trip context: ${head.join(' · ')}`);
  if (c.trip_planned_date) {
    lines.push(`      Trip planned: ${formatLocaleDateTime(c.trip_planned_date)}`);
  }
  const window: string[] = [];
  if (c.trip_start_time) window.push(`trip start ${formatLocaleDateTime(c.trip_start_time)}`);
  if (c.trip_end_time) window.push(`trip end ${formatLocaleDateTime(c.trip_end_time)}`);
  if (window.length) lines.push(`      ${window.join(' · ')}`);
  return lines;
}

function formatPersonalTripLines(trip: OfflineTripSummary | undefined): string[] {
  if (!trip) return [];
  const lines: string[] = [];
  lines.push('      ─ Your trip ─');
  lines.push(
    `      Status: ${trip.status} · Fishing: ${trip.fishing_type}` +
      (trip.session_type ? ` · Session: ${trip.session_type}` : ''),
  );
  if (trip.planned_date) lines.push(`      Planned: ${formatLocaleDateTime(trip.planned_date)}`);
  const tw: string[] = [];
  if (trip.start_time) tw.push(`Start ${formatLocaleDateTime(trip.start_time)}`);
  if (trip.end_time) tw.push(`End ${formatLocaleDateTime(trip.end_time)}`);
  if (tw.length) lines.push(`      ${tw.join(' · ')}`);
  if (trip.rating != null) lines.push(`      Rating: ${trip.rating}/5`);
  if (trip.user_reported_clarity) lines.push(`      Clarity: ${trip.user_reported_clarity}`);
  const n = clipLongNote(trip.notes);
  if (n) lines.push(`      Trip notes: ${n}`);
  return lines;
}

function formatCatchDetailsCommunity(
  c: CommunityCatchRow,
  snaps: ConditionsSnapshotRow[],
): string {
  const snap = snapshotById(snaps, c.conditions_snapshot_id);
  const flyLine = formatFlyFullDisplay(c.fly_pattern, c.fly_size, c.fly_color);
  const lines: string[] = [];
  lines.push(`  • Catch ${formatLocaleDateTime(c.timestamp)}`);
  lines.push(`      Species: ${c.species?.trim() || 'Unknown'} · ×${Math.max(1, c.quantity)}`);
  if (c.size_inches != null) lines.push(`      Fish size: ${c.size_inches}"`);
  {
    const w = formatCatchWeightLabel(c.weight_lb, c.weight_oz);
    if (w) lines.push(`      Weight: ${w}`);
  }
  if (c.depth_ft != null) lines.push(`      Depth: ${c.depth_ft} ft`);
  if (c.structure) lines.push(`      Structure: ${c.structure}`);
  if (c.presentation_method) lines.push(`      Presentation: ${c.presentation_method}`);
  if (c.released != null) lines.push(`      Released: ${c.released ? 'yes' : 'no'}`);
  if (flyLine) lines.push(`      Fly: ${flyLine}`);
  if (c.caught_on_fly) lines.push(`      Caught on rig: ${c.caught_on_fly}`);
  const condLine = formatConditionsSnapshotCompact(snap);
  if (condLine) lines.push(`      ${condLine}`);
  const cn = clipLongNote(c.note);
  if (cn) lines.push(`      Catch note: ${cn}`);
  lines.push(...formatCommunityTripContextLines(c));
  if (c.latitude != null && c.longitude != null) {
    lines.push(`      Pin: ${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`);
  }
  lines.push(`      id ${c.id}`);
  return lines.join('\n');
}

function formatCatchDetailsPersonal(
  c: CatchRow,
  trip: OfflineTripSummary | undefined,
  snaps: ConditionsSnapshotRow[],
): string {
  const snap = snapshotById(snaps, c.conditions_snapshot_id);
  const flyLine = formatFlyFullDisplay(c.fly_pattern, c.fly_size, c.fly_color);
  const lines: string[] = [];
  lines.push(`  • Catch ${formatLocaleDateTime(c.timestamp)}`);
  lines.push(`      Species: ${c.species?.trim() || 'Unknown'} · ×${Math.max(1, c.quantity)}`);
  if (c.size_inches != null) lines.push(`      Fish size: ${c.size_inches}"`);
  {
    const w = formatCatchWeightLabel(c.weight_lb, c.weight_oz);
    if (w) lines.push(`      Weight: ${w}`);
  }
  if (c.depth_ft != null) lines.push(`      Depth: ${c.depth_ft} ft`);
  if (c.structure) lines.push(`      Structure: ${c.structure}`);
  if (c.presentation_method) lines.push(`      Presentation: ${c.presentation_method}`);
  if (c.released != null) lines.push(`      Released: ${c.released ? 'yes' : 'no'}`);
  if (flyLine) lines.push(`      Fly: ${flyLine}`);
  if (c.caught_on_fly) lines.push(`      Caught on rig: ${c.caught_on_fly}`);
  const condLine = formatConditionsSnapshotCompact(snap);
  if (condLine) lines.push(`      ${condLine}`);
  const cn = clipLongNote(c.note);
  if (cn) lines.push(`      Catch note: ${cn}`);
  lines.push(...formatPersonalTripLines(trip));
  if (c.latitude != null && c.longitude != null) {
    lines.push(`      Pin: ${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`);
  }
  lines.push(`      Trip id ${c.trip_id} · Catch id ${c.id}`);
  return lines.join('\n');
}

export function formatOfflineDownloadSummary(w: DownloadedWaterway): string {
  const lines: string[] = [];
  lines.push(`Storage key: ${w.locationId}`);
  lines.push(`Map pack: ${w.mapPackName ?? '(none)'}`);
  lines.push('');
  lines.push(`Downloaded: ${w.downloadedAt}`);
  lines.push(`Last refreshed: ${w.lastRefreshedAt}`);
  lines.push('');
  if (w.downloadBbox) {
    lines.push('Download bounding box:');
    lines.push(`  NE  ${w.downloadBbox.ne.lat.toFixed(5)}, ${w.downloadBbox.ne.lng.toFixed(5)}`);
    lines.push(`  SW  ${w.downloadBbox.sw.lat.toFixed(5)}, ${w.downloadBbox.sw.lng.toFixed(5)}`);
  } else {
    lines.push('Download bounding box: (not stored — legacy entry)');
  }
  lines.push('');
  lines.push(`Catalog locations (${w.locations.length}):`);
  const maxLoc = 25;
  for (let i = 0; i < Math.min(w.locations.length, maxLoc); i++) {
    const loc = w.locations[i];
    lines.push(`  • ${loc.name ?? '(unnamed)'}  (${loc.id})`);
  }
  if (w.locations.length > maxLoc) {
    lines.push(`  … +${w.locations.length - maxLoc} more`);
  }
  lines.push('');
  lines.push('— Summary —');
  lines.push(`Condition entries: ${Object.keys(w.conditions).length}`);
  lines.push(`Conditions snapshots: ${w.conditionsSnapshots.length}`);
  lines.push('');

  const personal = w.personalCatches ?? [];
  const trips = w.tripSummariesById ?? {};
  lines.push(`YOUR CATCHES IN THIS AREA (${personal.length})`);
  lines.push('(Saved inside the download box when you refreshed or downloaded.)');
  lines.push('');
  if (personal.length === 0) {
    lines.push('  (none in this bundle — none of your catches had pins in the box, or data is still loading.)');
  } else {
    const sorted = [...personal].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const show = sorted.slice(0, OFFLINE_DETAIL_MAX_CATCH_LINES);
    for (const c of show) {
      lines.push(formatCatchDetailsPersonal(c, trips[c.trip_id], w.conditionsSnapshots ?? []));
      lines.push('');
    }
    if (personal.length > OFFLINE_DETAIL_MAX_CATCH_LINES) {
      lines.push(`  … +${personal.length - OFFLINE_DETAIL_MAX_CATCH_LINES} more not shown`);
    }
  }

  lines.push('');
  const community = w.communityCatches ?? [];
  lines.push(`COMMUNITY CATCHES IN THIS AREA (${community.length})`);
  lines.push('(Anonymized; same geographic box.)');
  lines.push('');
  if (community.length === 0) {
    lines.push(
      '  (none — often means no community pins in the box, or the app could not load them. Try Refresh when online.)',
    );
  } else {
    const sortedC = [...community].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const showC = sortedC.slice(0, OFFLINE_DETAIL_MAX_CATCH_LINES);
    for (const c of showC) {
      lines.push(formatCatchDetailsCommunity(c, w.conditionsSnapshots ?? []));
      lines.push('');
    }
    if (community.length > OFFLINE_DETAIL_MAX_CATCH_LINES) {
      lines.push(`  … +${community.length - OFFLINE_DETAIL_MAX_CATCH_LINES} more not shown`);
    }
  }

  return lines.join('\n');
}
