import { useState, useCallback, Fragment } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ScrollView,
  ActivityIndicator,
  Modal,
  TouchableOpacity,
  Platform,
  Dimensions,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/src/stores/authStore';
import { useTripStore } from '@/src/stores/tripStore';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import {
  getDownloadedWaterways,
  removeDownloadedWaterway,
  refreshWaterway,
  type DownloadedWaterway,
} from '@/src/services/waterwayCache';
import {
  fetchProfileStats,
  ProfileStats,
} from '@/src/services/profileStats';
import type { CatchRow, CommunityCatchRow, ConditionsSnapshotRow } from '@/src/types';
import type { OfflineTripSummary } from '@/src/services/sync';
import { subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const RANGES = [
  { label: '1 month', short: '1M', months: 1 },
  { label: '3 months', short: '3M', months: 3 },
  { label: '6 months', short: '6M', months: 6 },
  { label: '1 year', short: '1Y', months: 12 },
  { label: 'All time', short: 'All', months: 60 },
] as const;

const CHART_VISIBLE_MONTHS = 6;
const CHART_HEIGHT = 150;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function offlineWaterwayLabel(w: DownloadedWaterway): string {
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

/** Full fly label: pattern, hook size, color — no truncation of pattern text. */
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

function formatOfflineDownloadSummary(w: DownloadedWaterway): string {
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

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, profile, signOut } = useAuthStore();
  const { pendingSyncTrips, retryPendingSyncs, isSyncingPending } = useTripStore();
  const [rangeIdx, setRangeIdx] = useState(1);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [downloadedWaterways, setDownloadedWaterways] = useState<DownloadedWaterway[]>([]);
  const [refreshingWaterwayId, setRefreshingWaterwayId] = useState<string | null>(null);
  const [offlineDetailWaterway, setOfflineDetailWaterway] = useState<DownloadedWaterway | null>(null);

  const loadStats = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const now = new Date();
    const end = endOfMonth(now);
    const start = startOfMonth(subMonths(now, RANGES[rangeIdx].months - 1));
    const result = await fetchProfileStats(user.id, start, end);
    setStats(result);
    setLoading(false);
  }, [user, rangeIdx]);

  const reloadOffline = useCallback(async () => {
    setDownloadedWaterways(await getDownloadedWaterways());
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStats();
      void reloadOffline();
    }, [loadStats, reloadOffline]),
  );

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleRemoveWaterway = (locationId: string) => {
    Alert.alert('Remove', 'Remove this waterway from offline storage?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await removeDownloadedWaterway(locationId);
        await reloadOffline();
      } },
    ]);
  };

  const handleRefreshWaterway = async (locationId: string) => {
    setRefreshingWaterwayId(locationId);
    try {
      await refreshWaterway(locationId, user?.id ?? null);
      await reloadOffline();
    } finally {
      setRefreshingWaterwayId(null);
    }
  };

  const handleRetrySync = async () => {
    const prevCount = pendingSyncTrips.length;
    await retryPendingSyncs();
    const newCount = useTripStore.getState().pendingSyncTrips.length;
    if (newCount < prevCount) {
      Alert.alert('Trip synced', prevCount - newCount === 1 ? '1 trip synced to the cloud.' : `${prevCount - newCount} trips synced.`);
    } else if (prevCount > 0) {
      Alert.alert('Sync failed', 'Could not sync. Check your connection and try again.');
    }
  };

  const maxFish = stats
    ? Math.max(...stats.fishPerMonth.map(m => m.count), 1)
    : 1;

  const chartVisibleWidth =
    SCREEN_WIDTH - Spacing.lg * 2 - Spacing.lg * 2;
  const monthCount = stats?.fishPerMonth.length ?? 0;
  const barWidth =
    monthCount <= CHART_VISIBLE_MONTHS
      ? monthCount > 0
        ? chartVisibleWidth / monthCount
        : chartVisibleWidth / CHART_VISIBLE_MONTHS
      : chartVisibleWidth / CHART_VISIBLE_MONTHS;
  const chartContentWidth =
    monthCount > 0 ? monthCount * barWidth : chartVisibleWidth;

  return (
    <Fragment>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: Spacing.xl + insets.top }]}
    >
      <View style={styles.section}>
        <View style={styles.card}>
          <View style={styles.profileCardRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(profile?.display_name || 'A').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileCardRight}>
              <Text style={styles.name}>{profile?.display_name || 'Angler'}</Text>
              <Text style={styles.email} numberOfLines={1}>{user?.email}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Pressable
          style={styles.flyBoxButton}
          onPress={() => router.push('/fly-box')}
        >
          <Text style={styles.flyBoxButtonText}>Fly Box</Text>
          <Text style={styles.flyBoxButtonSubtext}>Manage your fly inventory</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Offline data</Text>
          <Text style={styles.pendingSyncText}>
            Conditions, catches in the downloaded square, trip locations, and the paired Mapbox basemap
            tiles — refreshed when you are online. Remove a region here to delete its map pack too.
          </Text>
          {downloadedWaterways.length === 0 ? (
            <Text style={styles.emptyText}>Nothing downloaded yet</Text>
          ) : (
            downloadedWaterways.map((w) => {
              const name = offlineWaterwayLabel(w);
              const isRefreshing = refreshingWaterwayId === w.locationId;
              return (
                <View key={w.locationId} style={styles.waterwayRow}>
                  <Text style={styles.waterwayName} numberOfLines={1}>{name}</Text>
                  <View style={styles.waterwayActions}>
                    <Pressable
                      style={styles.cacheDataBtn}
                      onPress={() => setOfflineDetailWaterway(w)}
                      accessibilityRole="button"
                      accessibilityLabel="View cached offline data"
                    >
                      <MaterialCommunityIcons
                        name="database-outline"
                        size={22}
                        color={Colors.primary}
                      />
                    </Pressable>
                    <Pressable
                      style={styles.refreshWaterwayBtn}
                      onPress={() => handleRefreshWaterway(w.locationId)}
                      disabled={isRefreshing}
                    >
                      {isRefreshing ? (
                        <ActivityIndicator size="small" color={Colors.primary} />
                      ) : (
                        <Text style={styles.refreshWaterwayBtnText}>Refresh</Text>
                      )}
                    </Pressable>
                    <Pressable
                      style={styles.removeWaterwayBtn}
                      onPress={() => handleRemoveWaterway(w.locationId)}
                    >
                      <Text style={styles.removeWaterwayBtnText}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
          <Pressable
            style={styles.addWaterwayButton}
            onPress={() => router.push('/trip/download-waterway')}
          >
            <Text style={styles.addWaterwayButtonText}>
              {downloadedWaterways.length === 0 ? 'Download for offline' : 'Add region'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.sectionTitle}>Your Report</Text>
          <Pressable
            style={styles.dropdown}
            onPress={() => setRangePickerOpen(true)}
          >
            <Text style={styles.dropdownText}>
              {RANGES[rangeIdx].label}
            </Text>
            <Text style={styles.dropdownChevron}>▾</Text>
          </Pressable>
        </View>

        <Modal
          visible={rangePickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setRangePickerOpen(false)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setRangePickerOpen(false)}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Date range</Text>
              {RANGES.map((r, i) => (
                <TouchableOpacity
                  key={r.short}
                  style={[
                    styles.modalOption,
                    rangeIdx === i && styles.modalOptionActive,
                  ]}
                  onPress={() => {
                    setRangeIdx(i);
                    setRangePickerOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.modalOptionText,
                      rangeIdx === i && styles.modalOptionTextActive,
                    ]}
                  >
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

        {loading ? (
          <ActivityIndicator
            size="large"
            color={Colors.primary}
            style={{ marginVertical: Spacing.xxl }}
          />
        ) : stats ? (
          <View style={styles.statsGrid}>
            <View style={styles.statsRow}>
              <StatCard label="Trips" value={stats.tripCount} />
              <StatCard label="Fish Caught" value={stats.totalFish} />
            </View>
            <View style={styles.statsRow}>
              <StatCard label="Catches" value={stats.totalCatches} />
              <StatCard label="Species" value={stats.speciesCount} />
            </View>
          </View>
        ) : null}
        </View>
      </View>

      {!loading && stats ? (
        <>
          <View style={styles.section}>
            <View style={[styles.card, styles.chartCard]}>
              <Text style={styles.sectionTitle}>Fish Per Month</Text>
            {stats.fishPerMonth.length === 0 ? (
              <Text style={styles.emptyText}>No data for this period</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={true}
                style={styles.chartScrollContainer}
                contentContainerStyle={{ width: chartContentWidth }}
              >
                {stats.fishPerMonth.map((m, i) => {
                  const h =
                    maxFish > 0
                      ? (m.count / maxFish) * CHART_HEIGHT
                      : 0;
                  return (
                    <View key={i} style={[styles.barCol, { width: barWidth }]}>
                      {m.count > 0 && (
                        <Text style={styles.barVal}>{m.count}</Text>
                      )}
                      <View
                        style={[
                          styles.bar,
                          {
                            height: Math.max(h, m.count > 0 ? 4 : 2),
                          },
                          m.count === 0 && styles.barEmpty,
                        ]}
                      />
                      <Text style={styles.barLbl}>{m.month}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Flies</Text>
              {stats.favoriteFly || stats.bestFly ? (
                <View style={styles.fliesCol}>
                  <View style={styles.flyBlock}>
                    <Text style={styles.flyBlockLabel}>Favorite</Text>
                    {stats.favoriteFly ? (
                      <>
                        <Text style={styles.flyName} numberOfLines={1}>
                          {stats.favoriteFly.name}
                        </Text>
                        <Text style={styles.flyMeta}>
                          {stats.favoriteFly.uses}{' '}
                          {stats.favoriteFly.uses === 1 ? 'use' : 'uses'}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.flyMeta}>—</Text>
                    )}
                  </View>
                  <View style={styles.flyBlock}>
                    <Text style={styles.flyBlockLabel}>Best</Text>
                    {stats.bestFly ? (
                      <>
                        <Text style={styles.flyName} numberOfLines={1}>
                          {stats.bestFly.name}
                        </Text>
                        <Text style={styles.flyMeta}>
                          {stats.bestFly.uses > 0
                            ? (stats.bestFly.fishCaught / stats.bestFly.uses).toFixed(1)
                            : '0'}{' '}
                          fish/use
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.flyMeta}>—</Text>
                    )}
                  </View>
                </View>
              ) : (
                <Text style={styles.emptyText}>No fly data yet</Text>
              )}
            </View>
          </View>
        </>
      ) : null}

      {pendingSyncTrips.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Offline sync</Text>
            <Text style={styles.pendingSyncText}>
              {pendingSyncTrips.length} trip{pendingSyncTrips.length !== 1 ? 's' : ''} saved on device waiting to sync.
            </Text>
            <Pressable
              style={[styles.retrySyncButton, isSyncingPending && styles.retrySyncButtonDisabled]}
              onPress={handleRetrySync}
              disabled={isSyncingPending}
            >
              {isSyncingPending ? (
                <ActivityIndicator size="small" color={Colors.textInverse} />
              ) : (
                <Text style={styles.retrySyncButtonText}>Retry sync</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Pressable
            style={styles.signOutRow}
            onPress={handleSignOut}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </Pressable>
          <Text style={styles.version}>DriftGuide v1.0.0</Text>
        </View>
      </View>
    </ScrollView>

    <Modal
      visible={offlineDetailWaterway != null}
      transparent
      animationType="fade"
      onRequestClose={() => setOfflineDetailWaterway(null)}
    >
      <View style={styles.offlineDetailRoot}>
        <Pressable
          style={styles.offlineDetailBackdropHit}
          onPress={() => setOfflineDetailWaterway(null)}
          accessibilityLabel="Dismiss"
        />
        <View style={styles.offlineDetailForeground} pointerEvents="box-none">
          <View style={styles.offlineDetailCard}>
            <Text style={styles.offlineDetailTitle}>Cached offline data</Text>
            <Text style={styles.offlineDetailSubtitle} numberOfLines={1}>
              {offlineDetailWaterway ? offlineWaterwayLabel(offlineDetailWaterway) : ''}
            </Text>
            <ScrollView
              style={[styles.offlineDetailScroll, { maxHeight: Math.min(560, SCREEN_HEIGHT * 0.58) }]}
              contentContainerStyle={styles.offlineDetailScrollContent}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {offlineDetailWaterway ? (
                <Text style={styles.offlineDetailBody} selectable>
                  {formatOfflineDownloadSummary(offlineDetailWaterway)}
                </Text>
              ) : null}
            </ScrollView>
            <Pressable
              style={styles.offlineDetailClose}
              onPress={() => setOfflineDetailWaterway(null)}
            >
              <Text style={styles.offlineDetailCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
    </Fragment>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  profileCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  profileCardRight: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.textInverse,
  },
  name: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  email: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    maxWidth: '100%',
  },
  flyBoxButton: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  flyBoxButtonText: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  flyBoxButtonSubtext: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  section: {
    marginTop: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dropdownText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
  },
  dropdownChevron: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  modalOption: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  modalOptionActive: {
    backgroundColor: `${Colors.primary}18`,
  },
  modalOptionText: {
    fontSize: FontSize.md,
    color: Colors.text,
  },
  modalOptionTextActive: {
    fontWeight: '600',
    color: Colors.primary,
  },
  statsGrid: {
    gap: Spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
  },
  statValue: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
  },
  statLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  chartCard: {
    minHeight: CHART_HEIGHT + 60,
  },
  chartScrollContainer: {},
  barCol: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: CHART_HEIGHT + 32,
  },
  barVal: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.primary,
    marginBottom: 2,
  },
  bar: {
    width: '55%',
    backgroundColor: Colors.primary,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  barEmpty: {
    backgroundColor: Colors.borderLight,
  },
  barLbl: {
    fontSize: 9,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  emptyText: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  fliesCol: {
    gap: Spacing.sm,
  },
  flyBlock: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
  },
  flyBlockLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  flyName: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  flyMeta: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  pendingSyncText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  retrySyncButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
  },
  retrySyncButtonDisabled: {
    opacity: 0.7,
  },
  retrySyncButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textInverse,
  },
  waterwayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  waterwayName: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  waterwayActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  cacheDataBtn: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshWaterwayBtn: { paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm, minWidth: 56, alignItems: 'center' },
  refreshWaterwayBtnText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  removeWaterwayBtn: { paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm },
  removeWaterwayBtnText: { fontSize: FontSize.sm, color: Colors.error, fontWeight: '600' },
  addWaterwayButton: {
    marginTop: Spacing.md,
    backgroundColor: Colors.background,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  addWaterwayButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.primary,
  },
  offlineDetailRoot: {
    flex: 1,
  },
  /** Full-screen; sibling sits above so ScrollView is not a child of Pressable. */
  offlineDetailBackdropHit: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  offlineDetailForeground: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    padding: Spacing.lg,
    zIndex: 1,
  },
  offlineDetailCard: {
    maxHeight: '85%' as const,
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  offlineDetailTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  offlineDetailSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  offlineDetailScroll: {},
  offlineDetailScrollContent: { paddingBottom: Spacing.sm },
  offlineDetailBody: {
    fontSize: FontSize.sm,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined }),
    color: Colors.text,
    lineHeight: 20,
  },
  offlineDetailClose: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  offlineDetailCloseText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.primary,
  },
  signOutRow: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  signOutText: {
    fontSize: FontSize.md,
    color: Colors.error,
    fontWeight: '600',
  },
  version: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
});
