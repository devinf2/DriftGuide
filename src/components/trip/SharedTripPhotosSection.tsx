import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { fetchPhotosVisibleForTripIds } from '@/src/services/photoService';
import { fetchProfile } from '@/src/services/friendsService';
import { listSessionMembers, listTripsInSession } from '@/src/services/sharedSessionService';
import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import type { Photo, Trip } from '@/src/types';

type PhotosMode = 'group' | string;

function sortPhotosNewestFirst(photos: Photo[]): Photo[] {
  return [...photos].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/** Include local-only rows for this trip so Group updates before sync completes. */
function mergeMyTripPhotosIntoGroup(remote: Photo[], local: Photo[], myTripId: string): Photo[] {
  const byId = new Map<string, Photo>();
  for (const p of remote) {
    byId.set(p.id, p);
  }
  for (const p of local) {
    if (p.trip_id !== myTripId) continue;
    if (!byId.has(p.id)) byId.set(p.id, p);
  }
  return sortPhotosNewestFirst([...byId.values()]);
}

function photoCountForTrip(photos: Photo[], childTripId: string): number {
  return photos.filter((p) => p.trip_id === childTripId).length;
}

export interface SharedTripPhotosSectionProps {
  trip: Trip;
  viewerUserId: string;
  isConnected: boolean;
  /** This trip's album for the viewing user (same as non-shared Photos tab). */
  myTripPhotos: Photo[];
  myPhotosLoading: boolean;
  onPhotoPress: (photo: Photo) => void;
  /** When set, shows Add control and trailing add tile (active trip). */
  onAddPhoto?: () => void;
  uploading?: boolean;
  groupPollMs?: number;
}

const DEFAULT_PHOTO_SIZE =
  (Dimensions.get('window').width - Spacing.lg * 2 - Spacing.sm * 2) / 3;

export function SharedTripPhotosSection({
  trip,
  viewerUserId,
  isConnected,
  myTripPhotos,
  myPhotosLoading,
  onPhotoPress,
  onAddPhoto,
  uploading = false,
  groupPollMs = 15000,
}: SharedTripPhotosSectionProps) {
  const { colors } = useAppTheme();
  const sessionId = trip.shared_session_id ?? null;

  const [members, setMembers] = useState<
    { user_id: string; display_name: string }[]
  >([]);
  const [sessionChildTrips, setSessionChildTrips] = useState<Trip[]>([]);
  const [photosMode, setPhotosMode] = useState<PhotosMode>(() => trip.id);
  const [groupPhotosRemote, setGroupPhotosRemote] = useState<Photo[]>([]);
  const [peerPhotos, setPeerPhotos] = useState<Photo[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);

  const loadMembers = useCallback(async () => {
    if (!sessionId || !isConnected) {
      setMembers([]);
      return;
    }
    const raw = await listSessionMembers(sessionId);
    const enriched: { user_id: string; display_name: string }[] = [];
    for (const m of raw) {
      const p = await fetchProfile(m.user_id);
      enriched.push({
        user_id: m.user_id,
        display_name: p?.display_name?.trim() || 'Angler',
      });
    }
    setMembers(enriched);
  }, [sessionId, viewerUserId, isConnected]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const sessionTripTabOptions = useMemo(() => {
    const rows = sessionChildTrips
      .slice()
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    return rows.map((t) => {
      const m = members.find((x) => x.user_id === t.user_id);
      const name = m?.display_name?.trim() || 'Angler';
      const label = t.id === trip.id ? 'You' : name;
      return {
        tripId: t.id,
        userId: t.user_id,
        label,
      };
    });
  }, [sessionChildTrips, trip.id, members]);

  const sessionTripIds = useMemo(() => sessionTripTabOptions.map((p) => p.tripId), [sessionTripTabOptions]);

  const myTripPhotosOnly = useMemo(
    () => myTripPhotos.filter((p) => p.trip_id === trip.id),
    [myTripPhotos, trip.id],
  );

  useEffect(() => {
    if (typeof __DEV__ === 'undefined' || !__DEV__) return;
    const youTabSpinner =
      myPhotosLoading && photosMode === trip.id && myTripPhotosOnly.length === 0;
    if (youTabSpinner) {
      console.log('[TripPhotos] SharedSection You-tab blocking spinner', {
        tripId: trip.id,
        myTripPhotosOnlyLen: myTripPhotosOnly.length,
      });
    }
  }, [myPhotosLoading, photosMode, trip.id, myTripPhotosOnly.length]);

  const loadGroup = useCallback(async () => {
    if (!sessionId || !isConnected) {
      setGroupPhotosRemote([]);
      setSessionChildTrips([]);
      return;
    }
    setLoadingRemote(true);
    try {
      const trips = await listTripsInSession(sessionId);
      setSessionChildTrips(trips);
      const ids = trips.map((t) => t.id);
      const merged = await fetchPhotosVisibleForTripIds(ids);
      setGroupPhotosRemote(merged);
    } catch {
      setGroupPhotosRemote([]);
    } finally {
      setLoadingRemote(false);
    }
  }, [sessionId, isConnected]);

  const loadPeer = useCallback(
    async (peerTripId: string) => {
      if (!sessionId || !isConnected) return;
      setLoadingRemote(true);
      try {
        const photos = await fetchPhotosVisibleForTripIds([peerTripId]);
        setPeerPhotos(photos);
      } catch {
        setPeerPhotos([]);
      } finally {
        setLoadingRemote(false);
      }
    },
    [sessionId, isConnected],
  );

  useEffect(() => {
    if (!sessionId || !isConnected) return;
    void loadGroup();
  }, [sessionId, isConnected, loadGroup]);

  useEffect(() => {
    if (!sessionId || !isConnected) return;
    const t = setInterval(() => void loadGroup(), groupPollMs);
    return () => clearInterval(t);
  }, [sessionId, isConnected, loadGroup, groupPollMs]);

  useEffect(() => {
    if (!sessionId || !isConnected) return;
    if (photosMode !== 'group' && photosMode !== trip.id && sessionTripIds.includes(photosMode)) {
      void loadPeer(photosMode);
    }
  }, [sessionId, isConnected, photosMode, loadPeer, sessionTripIds, trip.id]);

  useEffect(() => {
    if (!sessionId) return;
    if (photosMode === 'group') return;
    if (sessionTripIds.length === 0) return;
    if (!sessionTripIds.includes(photosMode)) {
      setPhotosMode(sessionTripIds.includes(trip.id) ? trip.id : 'group');
    }
  }, [sessionId, photosMode, sessionTripIds, trip.id]);

  const groupPhotosMerged = useMemo(
    () => mergeMyTripPhotosIntoGroup(groupPhotosRemote, myTripPhotos, trip.id),
    [groupPhotosRemote, myTripPhotos, trip.id],
  );

  if (!sessionId) {
    return null;
  }

  const offlineBlock = !isConnected && (photosMode === 'group' || photosMode !== trip.id);
  const peerLabel =
    photosMode !== 'group' && photosMode !== trip.id
      ? sessionTripTabOptions.find((p) => p.tripId === photosMode)?.label ?? 'your friend'
      : '';

  const displayPhotos: Photo[] =
    photosMode === 'group'
      ? groupPhotosMerged
      : photosMode === trip.id
        ? myTripPhotosOnly
        : peerPhotos;

  const chipStyle = (active: boolean) => ({
    borderColor: active ? colors.primary : colors.border,
    backgroundColor: active ? colors.surfaceElevated : colors.surface,
  });
  const chipText = (active: boolean) => ({
    fontSize: FontSize.xs,
    fontWeight: '600' as const,
    color: active ? colors.primary : colors.textSecondary,
  });

  const groupCount = groupPhotosMerged.length;
  const myTripPhotoCount = myTripPhotosOnly.length;
  const peerCountFromGroup = (childTripId: string) => photoCountForTrip(groupPhotosMerged, childTripId);

  const badgeShell = (active: boolean) => ({
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    backgroundColor: active ? `${colors.primary}33` : colors.borderLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  });
  const badgeLabel = (active: boolean) => ({
    fontSize: 10,
    fontWeight: '700' as const,
    color: active ? colors.primary : colors.textSecondary,
  });

  const thumbSize = DEFAULT_PHOTO_SIZE;
  const showAddTile = Boolean(onAddPhoto) && photosMode === trip.id;

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
      >
        <Pressable
          style={({ pressed }) => [styles.chip, chipStyle(photosMode === 'group'), pressed && { opacity: 0.85 }]}
          onPress={() => setPhotosMode('group')}
        >
          <View style={styles.chipRowInner}>
            <Text style={chipText(photosMode === 'group')}>Group</Text>
            <View style={badgeShell(photosMode === 'group')}>
              <Text style={badgeLabel(photosMode === 'group')}>{groupCount}</Text>
            </View>
          </View>
        </Pressable>
        {sessionTripTabOptions.map((p) => {
          const active = photosMode === p.tripId;
          const n = p.tripId === trip.id ? myTripPhotoCount : peerCountFromGroup(p.tripId);
          return (
            <Pressable
              key={p.tripId}
              style={({ pressed }) => [styles.chip, chipStyle(active), pressed && { opacity: 0.85 }]}
              onPress={() => setPhotosMode(p.tripId)}
            >
              <View style={styles.chipRowInner}>
                <Text style={[chipText(active), styles.chipLabelFlex]} numberOfLines={1}>
                  {p.label}
                </Text>
                <View style={badgeShell(active)}>
                  <Text style={badgeLabel(active)}>{n}</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView style={styles.mainScroll} contentContainerStyle={styles.mainContent}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.text }]}>Trip photos</Text>
          {onAddPhoto ? (
            <Pressable
              style={styles.addBtn}
              onPress={onAddPhoto}
              disabled={uploading || photosMode !== trip.id}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <MaterialIcons name="add-a-photo" size={18} color={colors.primary} />
                  <Text style={[styles.addBtnText, { color: colors.primary }]}>Add</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>

        {onAddPhoto && photosMode !== trip.id ? (
          <Text style={[styles.addHint, { color: colors.textSecondary }]}>
            Add photos from your trip tab (You).
          </Text>
        ) : null}

        {offlineBlock ? (
          <View style={[styles.offlineBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.offlineTitle, { color: colors.text }]}>{"You're offline"}</Text>
            <Text style={[styles.offlineBody, { color: colors.textSecondary }]}>
              {photosMode === 'group'
                ? 'Group photos need a connection. Your trip tab may still show photos saved on this device.'
                : `You'll see ${peerLabel}'s photos after you're back online.`}
            </Text>
          </View>
        ) : null}

        {!offlineBlock && photosMode === 'group' && loadingRemote && groupPhotosMerged.length === 0 ? (
          <View style={styles.placeholder}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        {!offlineBlock && photosMode !== trip.id && photosMode !== 'group' && loadingRemote && peerPhotos.length === 0 ? (
          <View style={styles.placeholder}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        {!offlineBlock &&
        myPhotosLoading &&
        photosMode === trip.id &&
        myTripPhotosOnly.length === 0 ? (
          <View style={styles.placeholder}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        {!offlineBlock &&
        !(myPhotosLoading && photosMode === trip.id && myTripPhotosOnly.length === 0) &&
        displayPhotos.length === 0 ? (
          onAddPhoto && photosMode === trip.id ? (
            <Pressable
              style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={onAddPhoto}
            >
              <MaterialIcons name="photo-library" size={48} color={colors.textTertiary} />
              <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>No photos yet</Text>
              <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>Add photos from this trip</Text>
            </Pressable>
          ) : (
            <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <MaterialIcons name="photo-library" size={48} color={colors.textTertiary} />
              <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
                {photosMode === 'group' ? 'No group photos yet' : 'No photos for this angler'}
              </Text>
            </View>
          )
        ) : null}

        {!offlineBlock &&
        !(myPhotosLoading && photosMode === trip.id && myTripPhotosOnly.length === 0) &&
        displayPhotos.length > 0 ? (
          <View style={styles.grid}>
            {displayPhotos.map((photo) => (
              <Pressable key={photo.id} onPress={() => onPhotoPress(photo)}>
                <OfflineTripPhotoImage
                  remoteUri={photo.url}
                  style={{
                    width: thumbSize,
                    height: thumbSize,
                    borderRadius: BorderRadius.md,
                    backgroundColor: colors.borderLight,
                  }}
                  contentFit="cover"
                />
              </Pressable>
            ))}
            {showAddTile ? (
              <Pressable
                style={[
                  styles.addSlot,
                  {
                    width: thumbSize,
                    height: thumbSize,
                    borderColor: colors.border,
                  },
                ]}
                onPress={onAddPhoto}
                disabled={uploading}
              >
                <MaterialIcons name="add" size={32} color={colors.primary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  chipScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 0,
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  chip: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 200,
  },
  chipRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  chipLabelFlex: {
    flexShrink: 1,
    maxWidth: 148,
  },
  mainScroll: { flex: 1 },
  mainContent: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  addBtnText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  addHint: {
    fontSize: FontSize.sm,
    marginBottom: Spacing.sm,
  },
  offlineBanner: {
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  offlineTitle: { fontSize: FontSize.sm, fontWeight: '700', marginBottom: Spacing.xs },
  offlineBody: { fontSize: FontSize.sm, lineHeight: 20 },
  placeholder: {
    minHeight: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    minHeight: 200,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    marginTop: Spacing.sm,
  },
  emptyHint: {
    fontSize: FontSize.sm,
    marginTop: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  addSlot: {
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
