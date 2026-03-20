import { View, Text, StyleSheet, Pressable, FlatList, Alert, ActivityIndicator, ScrollView, Dimensions, RefreshControl, Image as RNImage } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripStore } from '@/src/stores/tripStore';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { formatTripDuration } from '@/src/utils/formatters';
import { useEffect, useState, useCallback } from 'react';
import { Trip, Photo, Location } from '@/src/types';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import * as ExpoLocation from 'expo-location';
import { getTopFishingSpots, type SpotSuggestion } from '@/src/services/ai';
import { fetchAllLocationConditions, getDriftGuideScore } from '@/src/services/conditions';
import { fetchPhotos } from '@/src/services/photoService';
import { haversineDistance } from '@/src/services/locationService';

const ALBUM_GRID_GAP = Spacing.sm;
/** Max distance (km) for Hot Spot—only recommend spots within ~80 miles. */
const HOT_SPOT_RADIUS_KM = 130;
const ALBUM_COLS = 3;
// Scroll padding (xl*2) + tile padding (sm*2) + gaps so 3 thumbs fit on one row
const ALBUM_SIZE =
  (Dimensions.get('window').width - Spacing.xl * 2 - Spacing.sm * 2 - ALBUM_GRID_GAP * (ALBUM_COLS - 1)) /
  ALBUM_COLS;

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

type HotSpotData = {
  suggestion: SpotSuggestion;
  location: Location;
  conditions: import('@/src/types').LocationConditions;
};

function HotSpotCard({
  hotSpotData,
  onPress,
}: {
  hotSpotData: HotSpotData;
  onPress: () => void;
}) {
  const score = getDriftGuideScore(hotSpotData.conditions);
  return (
    <Pressable style={styles.hotSpotCard} onPress={onPress}>
      <View style={styles.hotSpotHeader}>
        <Text style={styles.hotSpotName} numberOfLines={1}>
          {hotSpotData.location.name}
        </Text>
        <View style={styles.hotSpotStarsRow}>
          {[0, 1, 2, 3, 4].map((i) => {
            const fullStars = Math.floor(score.stars);
            const partial = score.stars - fullStars;
            const isFull = i < fullStars;
            const isPartial = i === fullStars && partial > 0.05;
            if (isFull) {
              return <Ionicons key={i} name="star" size={18} color={Colors.primary} />;
            }
            if (isPartial) {
              return (
                <View key={i} style={styles.starPartialWrap}>
                  <Ionicons name="star-outline" size={18} color={Colors.primary} style={styles.starOutlineBg} />
                  <View style={[styles.starPartialFill, { width: 18 * partial }]}>
                    <Ionicons name="star" size={18} color={Colors.primary} />
                  </View>
                </View>
              );
            }
            return <Ionicons key={i} name="star-outline" size={18} color={Colors.textTertiary} />;
          })}
          {score.showFire && (
            <Ionicons name="flame" size={18} color={Colors.warning} style={styles.fireIcon} />
          )}
        </View>
      </View>
      {hotSpotData.suggestion.reason ? (
        <Text style={styles.hotSpotReason} numberOfLines={2}>
          {hotSpotData.suggestion.reason}
        </Text>
      ) : null}
      <Text style={styles.hotSpotTapHint}>Tap for report & conditions</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    activeTrip,
    fishCount,
    currentFly,
    nextFlyRecommendation,
    plannedTrips,
    plannedTripsLoading,
    fetchPlannedTrips,
    startPlannedTrip,
    deletePlannedTrip,
  } = useTripStore();
  const { profile, user } = useAuthStore();
  const { locations, fetchLocations } = useLocationStore();
  const [elapsed, setElapsed] = useState('0m');
  const [albumPhotos, setAlbumPhotos] = useState<Photo[]>([]);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hotSpotList, setHotSpotList] = useState<HotSpotData[]>([]);
  const [hotSpotsExpanded, setHotSpotsExpanded] = useState(false);
  const [hotSpotLoading, setHotSpotLoading] = useState(false);
  const [hotSpotRefreshKey, setHotSpotRefreshKey] = useState(0);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    if (!activeTrip) return;
    const interval = setInterval(() => {
      setElapsed(formatTripDuration(activeTrip.start_time, null));
    }, 1000);
    setElapsed(formatTripDuration(activeTrip.start_time, null));
    return () => clearInterval(interval);
  }, [activeTrip]);

  useEffect(() => {
    if (user && !activeTrip) {
      fetchPlannedTrips(user.id);
    }
  }, [user, activeTrip]);

  useEffect(() => {
    if (activeTrip) return;
    let cancelled = false;
    ExpoLocation.requestForegroundPermissionsAsync().then(({ status }) => {
      if (cancelled || status !== 'granted') return;
      return ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      }).then((loc) => {
        if (!cancelled) setUserCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeTrip]);

  useEffect(() => {
    if (activeTrip) return;
    if (locations.length === 0) {
      fetchLocations();
      return;
    }
    const topLevel = locations.filter((l) => !l.parent_location_id);
    if (topLevel.length === 0) {
      setHotSpotList([]);
      setHotSpotLoading(false);
      return;
    }
    const candidates =
      userCoords &&
      topLevel.filter((loc) => {
        const lat = loc.latitude ?? null;
        const lng = loc.longitude ?? null;
        if (lat == null || lng == null) return false;
        return haversineDistance(userCoords.latitude, userCoords.longitude, lat, lng) <= HOT_SPOT_RADIUS_KM;
      });
    // When user is far from all spots, still show hot spots from all top-level locations
    const spotsToUse = (candidates && candidates.length > 0 ? candidates : topLevel) as typeof topLevel;
    if (spotsToUse.length === 0) {
      setHotSpotList([]);
      setHotSpotLoading(false);
      return;
    }
    let cancelled = false;
    setHotSpotLoading(true);
    fetchAllLocationConditions(spotsToUse).then((conditionsMap) => {
      if (cancelled) return;
      getTopFishingSpots(spotsToUse, conditionsMap).then((suggestions) => {
        if (cancelled) return;
        const list: HotSpotData[] = [];
        const suggestionName = (s: SpotSuggestion) => s.locationName.toLowerCase().trim();
        const primaryPart = (s: SpotSuggestion) => suggestionName(s).split(/[\s]*[-–—][\s]*/)[0]?.trim() ?? suggestionName(s);
        for (const suggestion of suggestions.slice(0, 3)) {
          const loc = locations.find(
            (l) => {
              const ln = l.name.toLowerCase();
              const sn = suggestionName(suggestion);
              const pp = primaryPart(suggestion);
              return ln === sn ||
                sn.includes(ln) ||
                ln.includes(pp) ||
                pp.includes(ln);
            },
          );
          if (!loc) continue;
          const conditions =
            conditionsMap.get(loc.id) ??
            (loc.parent_location_id ? conditionsMap.get(loc.parent_location_id) : undefined);
          const conditionsToUse =
            conditions ??
            (conditionsMap.size > 0 ? Array.from(conditionsMap.values())[0] : undefined);
          if (conditionsToUse) list.push({ suggestion, location: loc, conditions: conditionsToUse });
        }
        setHotSpotList(list);
        setHotSpotLoading(false);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activeTrip, locations, fetchLocations, hotSpotRefreshKey, userCoords?.latitude, userCoords?.longitude]);

  const loadAlbumPhotos = useCallback(async () => {
    if (!user?.id) return;
    setAlbumLoading(true);
    try {
      const photos = await fetchPhotos(user.id);
      setAlbumPhotos(photos);
    } catch (e) {
      setAlbumPhotos([]);
      const msg = e instanceof Error ? e.message : String(e);
      const hint = msg.includes('does not exist') || msg.includes('relation')
        ? ' Run Supabase migration 008_single_photos_table.sql to create the photos table.'
        : '';
      Alert.alert('Could not load album', msg + hint);
    } finally {
      setAlbumLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user && !activeTrip) loadAlbumPhotos();
  }, [user, activeTrip, loadAlbumPhotos]);

  // Refetch album whenever this tab is focused (e.g. after adding a photo or switching back)
  useFocusEffect(
    useCallback(() => {
      if (user?.id && !activeTrip) loadAlbumPhotos();
    }, [user?.id, activeTrip, loadAlbumPhotos])
  );

  const handleStartPlannedTrip = useCallback(async (tripId: string) => {
    const result = await startPlannedTrip(tripId);
    if (result) {
      router.push(`/trip/${result}`);
    }
  }, [startPlannedTrip, router]);

  const handleDeletePlannedTrip = useCallback((trip: Trip) => {
    Alert.alert(
      'Delete Plan',
      `Remove "${trip.location?.name || 'this trip'}" from your plans?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deletePlannedTrip(trip.id),
        },
      ],
    );
  }, [deletePlannedTrip]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAlbumPhotos();
    if (user?.id && !activeTrip) fetchPlannedTrips(user.id);
    if (!activeTrip) setHotSpotRefreshKey((k) => k + 1);
    setRefreshing(false);
  }, [loadAlbumPhotos, user?.id, activeTrip, fetchPlannedTrips]);

  if (activeTrip) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.activeTripWrapper}>
        <Pressable
          style={styles.activeTripCard}
          onPress={() => router.push(`/trip/${activeTrip.id}`)}
        >
          <Text style={styles.activeTripLabel}>Active Trip</Text>
          <Text style={styles.activeTripLocation}>
            {activeTrip.location?.name || 'Fishing Trip'}
          </Text>
          <View style={styles.activeTripStats}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{elapsed}</Text>
              <Text style={styles.statLabel}>Duration</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{fishCount}</Text>
              <Text style={styles.statLabel}>Fish</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{currentFly?.pattern || '\u2014'}</Text>
              <Text style={styles.statLabel}>Current Fly</Text>
            </View>
          </View>
          <Text style={styles.tapHint}>Tap to open trip dashboard</Text>
        </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingTop: Spacing.xl + insets.top }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />
      }
    >
      <View style={styles.hero}>
        <Text style={styles.greeting}>
          {getTimeGreeting()}{profile?.display_name ? `, ${profile.display_name}` : ''}
        </Text>
        <Text style={styles.subtitle}>Ready to hit the water?</Text>
      </View>

      <Pressable
        style={styles.startButton}
        onPress={() => router.push('/trip/new')}
      >
        <MaterialCommunityIcons name="fish" size={28} color={Colors.textInverse} />
        <Text style={styles.startButtonText}>Plan a Trip</Text>
      </Pressable>

      <View style={styles.hotSpotSection}>
        <Text style={styles.sectionTitle}>Hot Spot</Text>
        {hotSpotLoading ? (
          <View style={styles.hotSpotCard}>
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.lg }} />
          </View>
        ) : (
          <>
            {hotSpotList.slice(0, hotSpotsExpanded ? 3 : 1).map((hotSpot) => (
              <View key={hotSpot.location.id} style={styles.hotSpotCardWrap}>
                <HotSpotCard
                  hotSpotData={hotSpot}
                  onPress={() => router.push(`/spot/${hotSpot.location.id}`)}
                />
              </View>
            ))}
            {hotSpotList.length > 1 && !hotSpotsExpanded && (
              <Pressable
                style={styles.seeMoreHotSpots}
                onPress={() => setHotSpotsExpanded(true)}
              >
                <Text style={styles.seeMoreHotSpotsText}>See more ({hotSpotList.length - 1} more)</Text>
                <Ionicons name="chevron-down" size={18} color={Colors.primary} />
              </Pressable>
            )}
            {hotSpotsExpanded && hotSpotList.length > 1 && (
              <Pressable
                style={styles.seeMoreHotSpots}
                onPress={() => setHotSpotsExpanded(false)}
              >
                <Text style={styles.seeMoreHotSpotsText}>See less</Text>
                <Ionicons name="chevron-up" size={18} color={Colors.primary} />
              </Pressable>
            )}
          </>
        )}
      </View>

      {plannedTrips.length > 0 && (
        <View style={styles.plannedSection}>
          <Text style={styles.sectionTitle}>Your Planned Trips</Text>
          {plannedTripsLoading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.md }} />
          ) : (
            <FlatList
              data={plannedTrips}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.plannedCard}>
                  <View style={styles.plannedInfo}>
                    <Text style={styles.plannedName}>
                      {item.location?.name || 'Unknown Location'}
                    </Text>
                    <Text style={styles.plannedMeta}>
                      {item.planned_date
                        ? format(new Date(item.planned_date), 'EEE, MMM d \u00B7 h:mm a')
                        : 'Planned'}
                    </Text>
                  </View>
                  <View style={styles.plannedActions}>
                    <Pressable
                      style={styles.startTripBtn}
                      onPress={() => handleStartPlannedTrip(item.id)}
                    >
                      <Text style={styles.startTripBtnText}>Start</Text>
                    </Pressable>
                    <Pressable
                      style={styles.deleteTripBtn}
                      onPress={() => handleDeletePlannedTrip(item)}
                    >
                      <Text style={styles.deleteTripBtnText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            />
          )}
        </View>
      )}

      <View style={styles.albumTile}>
        <View style={styles.albumTileHeader}>
          <Text style={styles.albumTileTitle}>Photo Album</Text>
          <Pressable
            style={styles.albumViewAllButton}
            onPress={() => router.push('/home/photos')}
          >
            <Text style={styles.albumViewAllText}>View all</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.primary} />
          </Pressable>
        </View>
        {albumLoading ? (
          <View style={styles.albumGridPlaceholder}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : albumPhotos.length === 0 ? (
          <Pressable style={styles.albumEmptyTile} onPress={() => router.push('/home/photos')}>
            <MaterialCommunityIcons name="image-plus" size={40} color={Colors.textTertiary} />
            <Text style={styles.albumEmptyText}>View all to add photos</Text>
          </Pressable>
        ) : (
          <View style={styles.albumGrid}>
            {albumPhotos.slice(0, 3).map((photo) => (
              <Pressable
                key={photo.id}
                style={styles.albumThumb}
                onPress={() => router.push('/home/photos')}
              >
                <RNImage
                  source={{ uri: photo.url }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  activeTripWrapper: {
    flex: 1,
    padding: Spacing.xl,
  },
  hero: {
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  greeting: {
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
    fontSize: FontSize.lg,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  startButtonText: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textInverse,
  },
  hotSpotSection: {
    marginBottom: Spacing.lg,
  },
  hotSpotCardWrap: {
    marginBottom: Spacing.sm,
  },
  hotSpotCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: Colors.accent,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  hotSpotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  hotSpotName: {
    flex: 1,
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  hotSpotStarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  starPartialWrap: {
    width: 18,
    height: 18,
    position: 'relative',
  },
  starOutlineBg: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  starPartialFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
  },
  fireIcon: {
    marginLeft: Spacing.xs,
  },
  hotSpotReason: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
  hotSpotTapHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.xs,
  },
  seeMoreHotSpots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  seeMoreHotSpotsText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
  },
  albumTile: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  albumTileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  albumTileTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  albumViewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  albumViewAllText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
  },
  albumEmptyTile: {
    minHeight: ALBUM_SIZE,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  albumGridPlaceholder: {
    minHeight: ALBUM_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  albumEmptyText: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
  },
  albumGrid: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: ALBUM_GRID_GAP,
  },
  albumThumb: {
    width: ALBUM_SIZE,
    height: ALBUM_SIZE,
    minWidth: ALBUM_SIZE,
    minHeight: ALBUM_SIZE,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  plannedSection: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  plannedCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  plannedInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  plannedName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  plannedMeta: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  plannedActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  startTripBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  startTripBtnText: {
    color: Colors.textInverse,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  deleteTripBtn: {
    backgroundColor: Colors.borderLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  deleteTripBtnText: {
    color: Colors.error,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  activeTripCard: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
  },
  activeTripLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  activeTripLocation: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.textInverse,
    marginTop: Spacing.xs,
  },
  activeTripStats: {
    flexDirection: 'row',
    marginTop: Spacing.lg,
    gap: Spacing.lg,
  },
  stat: {
    flex: 1,
  },
  statValue: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.textInverse,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  tapHint: {
    fontSize: FontSize.sm,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
});
