import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ShareToFeedDraft } from '@/src/components/feed/ShareToFeedModal';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { fetchPhotosForTripIds } from '@/src/services/photoService';
import { fetchTripEvents, fetchTripsFromCloud } from '@/src/services/sync';
import { useAuthStore } from '@/src/stores/authStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { CatchData, Photo, Trip, TripEvent } from '@/src/types';
import { buildAlbumPhotoUrlsByCatchId, resolveCatchDisplayPhotoUrls } from '@/src/utils/catchPhotos';
import { formatTripDate } from '@/src/utils/formatters';

export type TripPickMode = 'catch' | 'trip';

type Props = {
  visible: boolean;
  mode: TripPickMode;
  onClose: () => void;
  /** Returns a draft to hand to the ShareToFeedModal composer. */
  onPicked: (draft: ShareToFeedDraft) => void;
};

const isHttp = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);

/** Resolve the fly pattern in effect for a catch (from its active_fly_event_id). */
function resolveFlyName(events: TripEvent[], data: CatchData): string | null {
  const id = data.active_fly_event_id;
  if (!id) return null;
  const ev = events.find((e) => e.id === id && e.event_type === 'fly_change');
  const d = (ev?.data ?? {}) as { pattern?: string };
  const p = typeof d.pattern === 'string' ? d.pattern.trim() : '';
  return p || null;
}

export function TripCatchPickerModal({ visible, mode, onClose, onPicked }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const myId = useAuthStore((s) => s.user?.id ?? null);

  const [trips, setTrips] = useState<Trip[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [selected, setSelected] = useState<Trip | null>(null);
  const [events, setEvents] = useState<TripEvent[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Load the user's completed trips when opened.
  useEffect(() => {
    if (!visible || !myId) return;
    setSelected(null);
    setLoadingTrips(true);
    void fetchTripsFromCloud(myId).then((rows) => {
      setTrips(rows.filter((t) => t.status === 'completed'));
      setLoadingTrips(false);
    });
  }, [visible, myId]);

  const photoForCatch = useCallback(
    (eventId: string, data: CatchData): string | null => {
      if (isHttp(data.photo_url)) return data.photo_url;
      const ph = photos.find((p) => p.catch_id === eventId && isHttp(p.url));
      return ph?.url ?? null;
    },
    [photos],
  );

  const openTrip = useCallback(
    async (trip: Trip) => {
      if (mode === 'trip') {
        setLoadingDetail(true);
        // Full trip photo set: album rows + catch photos that live only in event JSON.
        const [evs, ph] = await Promise.all([
          fetchTripEvents(trip.id),
          fetchPhotosForTripIds(myId ?? '', [trip.id]),
        ]);
        setLoadingDetail(false);
        const albumMap = buildAlbumPhotoUrlsByCatchId(ph);
        const seen = new Set<string>();
        const media: string[] = [];
        const push = (u: string | null | undefined) => {
          const t = u?.trim();
          if (!t || seen.has(t) || !isHttp(t)) return;
          seen.add(t);
          media.push(t);
        };
        for (const p of ph) push(p.url);
        for (const e of evs) {
          if (e.event_type !== 'catch') continue;
          for (const u of resolveCatchDisplayPhotoUrls(e.id, e.data as CatchData, albumMap)) push(u);
        }
        onPicked({
          kind: 'trip',
          tripId: trip.id,
          tripTitle: trip.location?.name ?? 'Fishing trip',
          tripSubtitle: `${formatTripDate(trip.start_time)} · ${trip.total_fish ?? 0} fish`,
          media,
        });
        return;
      }
      // catch mode → drill into the trip's catches
      setSelected(trip);
      setLoadingDetail(true);
      const [evs, ph] = await Promise.all([
        fetchTripEvents(trip.id),
        fetchPhotosForTripIds(myId ?? '', [trip.id]),
      ]);
      setEvents(evs);
      setPhotos(ph);
      setLoadingDetail(false);
    },
    [mode, myId, onPicked],
  );

  const catches = useMemo(
    () => events.filter((e) => e.event_type === 'catch'),
    [events],
  );

  const pickCatch = useCallback(
    (e: TripEvent) => {
      const d = (e.data ?? {}) as CatchData;
      const photo = photoForCatch(e.id, d);
      onPicked({
        kind: 'catch',
        tripId: e.trip_id,
        catchEventId: e.id,
        species: d.species ?? null,
        sizeInches: d.size_inches ?? null,
        flyName: resolveFlyName(events, d),
        depthFt: d.depth_ft ?? null,
        presentation: d.presentation_method ?? null,
        // Candidate location — only shared if the author opts in via the composer toggle.
        locationName: selected?.location?.name ?? null,
        media: photo ? [photo] : [],
      });
    },
    [events, photoForCatch, onPicked, selected],
  );

  const title = selected ? 'Pick a catch' : mode === 'trip' ? 'Share a trip' : 'Pick a trip';

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onClose}
      style={[styles.backdrop, { display: visible ? 'flex' : 'none' }]}
    >
      <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.sheet}>
        <View style={styles.headerRow}>
          {selected ? (
            <Pressable onPress={() => setSelected(null)} hitSlop={8}>
              <MaterialIcons name="arrow-back" size={22} color={colors.text} />
            </Pressable>
          ) : (
            <View style={{ width: 22 }} />
          )}
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <MaterialIcons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        {loadingTrips || loadingDetail ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : selected ? (
          <FlatList
            data={catches}
            keyExtractor={(e) => e.id}
            contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.lg }}
            ListEmptyComponent={<Text style={styles.empty}>No catches logged on this trip.</Text>}
            renderItem={({ item }) => {
              const d = (item.data ?? {}) as CatchData;
              const photo = photoForCatch(item.id, d);
              const size = d.size_inches != null ? `${Number(d.size_inches)}"` : null;
              return (
                <Pressable style={styles.row} onPress={() => pickCatch(item)}>
                  {photo ? (
                    <Image source={{ uri: photo }} style={styles.thumb} contentFit="cover" />
                  ) : (
                    <View style={[styles.thumb, styles.thumbEmpty]}>
                      <MaterialIcons name="set-meal" size={20} color={colors.textTertiary} />
                    </View>
                  )}
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle}>{d.species || 'Fish'}</Text>
                    {size ? <Text style={styles.rowMeta}>{size}</Text> : null}
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={colors.textTertiary} />
                </Pressable>
              );
            }}
          />
        ) : (
          <FlatList
            data={trips}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.lg }}
            ListEmptyComponent={
              <Text style={styles.empty}>No completed trips yet. Log a trip first.</Text>
            }
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => void openTrip(item)}>
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <MaterialIcons name="map" size={20} color={colors.textTertiary} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.location?.name ?? 'Fishing trip'}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {formatTripDate(item.start_time)} · {item.total_fish ?? 0} fish
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={colors.textTertiary} />
              </Pressable>
            )}
          />
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', zIndex: 100 },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      maxHeight: '85%',
      minHeight: '55%',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    center: { padding: Spacing.xl, alignItems: 'center' },
    empty: { textAlign: 'center', color: colors.textSecondary, fontSize: FontSize.sm, padding: Spacing.xl },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    thumb: { width: 48, height: 48, borderRadius: BorderRadius.sm, backgroundColor: colors.background },
    thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
    rowInfo: { flex: 1 },
    rowTitle: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    rowMeta: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 1 },
  });
}
