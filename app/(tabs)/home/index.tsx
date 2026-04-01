import { BorderRadius, Colors, FontSize, Spacing } from '@/src/constants/theme';
import { getTopFishingSpots, type SpotSuggestion } from '@/src/services/ai';
import { fetchAllLocationConditions, getDriftGuideScore } from '@/src/services/conditions';
import { haversineDistance } from '@/src/services/locationService';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { useTripStore } from '@/src/stores/tripStore';
import { Location, LocationConditions, Trip } from '@/src/types';
import { formatFishCount } from '@/src/utils/formatters';
import { profileDisplayName } from '@/src/utils/profileDisplay';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';
import { formatFishingElapsedLabel, getLiveFishingElapsedMs } from '@/src/utils/tripTiming';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import * as ExpoLocation from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Max how many geotagged waters we send to the hot-spot model (smaller = closer-only).
 * Final UI still shows at most 3, sorted by distance.
 */
const MAX_HOME_HOTSPOT_POOL = 8;
/** Prefer at least this many candidates before tightening radius (else expand tiers). */
const MIN_HOME_HOTSPOT_POOL = 3;
/**
 * Start with the tightest radius and only widen if there are not enough waters.
 * Values in km (~28 / 50 / 75 / 110 mi).
 */
const HOME_HOTSPOT_RADIUS_TIERS_KM = [45, 80, 120, 180] as const;

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * One line under the hero. Intentionally does not repeat `suggestion.reason`—that copy
 * lives on Today's Angle cards so we don't show the same paragraph twice.
 */
function getHomeTagline(
  hotSpotLoading: boolean,
  firstHot: HotSpotData | undefined,
): string {
  if (hotSpotLoading) return 'Checking conditions for your waters…';
  if (firstHot) {
    return `${firstHot.location.name} is updated—tap below for the full picture and get out there.`;
  }
  return "Plan where you're going next—then we'll surface conditions and your trip tools.";
}

/** Distance from user for display; null if unknown. */
function distanceKmForLocation(
  loc: Location,
  userCoords: { latitude: number; longitude: number } | null,
): number | null {
  if (!userCoords) return null;
  const lat = loc.latitude ?? null;
  const lng = loc.longitude ?? null;
  if (lat == null || lng == null) return null;
  return haversineDistance(userCoords.latitude, userCoords.longitude, lat, lng);
}

function formatDistanceLabel(km: number | null): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  const mi = km * 0.621371;
  if (mi < 0.25) return 'Nearby';
  if (mi < 10) return `${Math.round(mi * 10) / 10} mi away`;
  return `${Math.round(mi)} mi away`;
}

/**
 * Prefer locations near the user: strict distance tiers, then nearest-N cap for the model.
 * Falls back to all top-level waters when we have no GPS fix or no coordinates on file.
 */
function selectLocationsForHomeHotSpots(
  topLevel: Location[],
  userCoords: { latitude: number; longitude: number } | null,
): Location[] {
  const withCoords = topLevel.filter(
    (l) => l.latitude != null && l.longitude != null,
  ) as (Location & { latitude: number; longitude: number })[];
  if (!userCoords || withCoords.length === 0) {
    return topLevel;
  }
  const distKm = (l: (typeof withCoords)[number]) =>
    haversineDistance(userCoords.latitude, userCoords.longitude, l.latitude, l.longitude);

  const sorted = [...withCoords].sort((a, b) => distKm(a) - distKm(b));

  for (const maxKm of HOME_HOTSPOT_RADIUS_TIERS_KM) {
    const inBand = sorted.filter((l) => distKm(l) <= maxKm);
    if (inBand.length >= MIN_HOME_HOTSPOT_POOL) {
      return inBand.slice(0, MAX_HOME_HOTSPOT_POOL);
    }
  }
  return sorted.slice(0, MAX_HOME_HOTSPOT_POOL);
}

type HotSpotData = {
  suggestion: SpotSuggestion;
  location: Location;
  conditions: import('@/src/types').LocationConditions;
  /** km from user when location permission + coords available */
  distanceKm: number | null;
};

function HotSpotCardBody({
  hotSpotData,
  distanceLabel,
}: {
  hotSpotData: HotSpotData;
  distanceLabel?: string | null;
}) {
  const score = getDriftGuideScore(hotSpotData.conditions);
  return (
    <>
      <View style={styles.hotSpotHeader}>
        <View style={styles.hotSpotTitleBlock}>
          <Text style={styles.hotSpotName} numberOfLines={2}>
            {hotSpotData.location.name}
          </Text>
          {distanceLabel ? (
            <Text style={styles.hotSpotDistance}>{distanceLabel}</Text>
          ) : null}
        </View>
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
        <Text style={styles.hotSpotReason} numberOfLines={3}>
          {hotSpotData.suggestion.reason}
        </Text>
      ) : null}
    </>
  );
}

function HotSpotCard({
  hotSpotData,
  onPress,
}: {
  hotSpotData: HotSpotData;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.hotSpotCard}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Opens spot report and conditions"
    >
      <HotSpotCardBody
        hotSpotData={hotSpotData}
        distanceLabel={formatDistanceLabel(hotSpotData.distanceKm)}
      />
    </Pressable>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    activeTrip,
    isTripPaused,
    fishCount,
    currentFly,
    endTrip,
    plannedTrips,
    plannedTripsLoading,
    fetchPlannedTrips,
    startPlannedTrip,
    deletePlannedTrip,
  } = useTripStore();
  const fullHome = !activeTrip || isTripPaused;
  const { profile, user } = useAuthStore();
  const { locations, fetchLocations } = useLocationStore();
  const [elapsed, setElapsed] = useState('0m');
  const [refreshing, setRefreshing] = useState(false);
  const [hotSpotList, setHotSpotList] = useState<HotSpotData[]>([]);
  const [hotSpotsExpanded, setHotSpotsExpanded] = useState(false);
  const [hotSpotLoading, setHotSpotLoading] = useState(false);
  const [hotSpotRefreshKey, setHotSpotRefreshKey] = useState(0);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    if (!activeTrip) return;
    const tick = () => {
      const s = useTripStore.getState();
      const ms = getLiveFishingElapsedMs(
        s.fishingElapsedMs,
        s.fishingSegmentStartedAt,
        s.isTripPaused,
        s.activeTrip?.start_time ?? null,
      );
      setElapsed(formatFishingElapsedLabel(ms));
    };
    if (isTripPaused) {
      tick();
      return;
    }
    const interval = setInterval(tick, 1000);
    tick();
    return () => clearInterval(interval);
  }, [activeTrip, isTripPaused]);

  useEffect(() => {
    if (user && fullHome) {
      fetchPlannedTrips(user.id);
    }
  }, [user, fullHome, fetchPlannedTrips]);

  useEffect(() => {
    if (!fullHome) return;
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
  }, [fullHome]);

  useEffect(() => {
    if (!fullHome) return;
    if (locations.length === 0) {
      fetchLocations();
      return;
    }
    const topLevel = activeLocationsOnly(locations).filter((l) => !l.parent_location_id);
    if (topLevel.length === 0) {
      setHotSpotList([]);
      setHotSpotLoading(false);
      return;
    }
    const spotsToUse = selectLocationsForHomeHotSpots(topLevel, userCoords);
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
        const seenIds = new Set<string>();
        const suggestionName = (s: SpotSuggestion) => s.locationName.toLowerCase().trim();
        const primaryPart = (s: SpotSuggestion) => suggestionName(s).split(/[\s]*[-–—][\s]*/)[0]?.trim() ?? suggestionName(s);
        for (const suggestion of suggestions.slice(0, 6)) {
          const loc = spotsToUse.find(
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
          if (!loc || seenIds.has(loc.id)) continue;
          const conditions =
            conditionsMap.get(loc.id) ??
            (loc.parent_location_id ? conditionsMap.get(loc.parent_location_id) : undefined);
          const conditionsToUse =
            conditions ??
            (conditionsMap.size > 0 ? Array.from(conditionsMap.values())[0] : undefined);
          if (conditionsToUse) {
            seenIds.add(loc.id);
            list.push({
              suggestion,
              location: loc,
              conditions: conditionsToUse,
              distanceKm: distanceKmForLocation(loc, userCoords),
            });
          }
        }
        list.sort((a, b) => {
          const ad = a.distanceKm;
          const bd = b.distanceKm;
          if (ad == null && bd == null) return 0;
          if (ad == null) return 1;
          if (bd == null) return -1;
          return ad - bd;
        });
        let top = list.slice(0, 3);
        if (top.length === 0 && spotsToUse.length > 0) {
          const fallback: HotSpotData[] = [];
          for (const loc of spotsToUse) {
            const conditions =
              conditionsMap.get(loc.id) ??
              (loc.parent_location_id ? conditionsMap.get(loc.parent_location_id) : undefined);
            if (!conditions) continue;
            fallback.push({
              suggestion: {
                locationName: loc.name,
                reason: '',
                confidence: 0.5,
              },
              location: loc,
              conditions,
              distanceKm: distanceKmForLocation(loc, userCoords),
            });
          }
          fallback.sort((a, b) => {
            const ad = a.distanceKm;
            const bd = b.distanceKm;
            if (ad == null && bd == null) return 0;
            if (ad == null) return 1;
            if (bd == null) return -1;
            return ad - bd;
          });
          top = fallback.slice(0, 3);
        }
        setHotSpotList(top);
        setHotSpotLoading(false);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [fullHome, locations, fetchLocations, hotSpotRefreshKey, userCoords?.latitude, userCoords?.longitude]);

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
    if (user?.id && fullHome) fetchPlannedTrips(user.id);
    if (fullHome) setHotSpotRefreshKey((k) => k + 1);
    setRefreshing(false);
  }, [user?.id, fullHome, fetchPlannedTrips]);

  const handleResumeTrip = useCallback(() => {
    const s = useTripStore.getState();
    if (!s.activeTrip?.id || !s.isTripPaused) return;
    const tripId = s.activeTrip.id;
    void s.resumeTrip();
    router.push(`/trip/${tripId}`);
  }, [router]);

  const handleEndTripFromHome = useCallback(() => {
    if (!activeTrip) return;
    Alert.alert('End Trip', `End this trip with ${formatFishCount(fishCount)}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End Trip',
        style: 'destructive',
        onPress: async () => {
          const { synced } = await endTrip();
          if (!synced) {
            Alert.alert(
              'Saved on device',
              "Trip will sync when you're back online or when you open the app with connection.",
              [{ text: 'OK' }],
            );
          }
          router.replace(`/trip/${activeTrip.id}/survey`);
        },
      },
    ]);
  }, [activeTrip, fishCount, endTrip, router]);

  if (activeTrip && !isTripPaused) {
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
              <Text style={styles.statLabel}>Fishing time</Text>
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
        <Text style={styles.heroEyebrow}>{"Let's fish"}</Text>
        <Text style={styles.greeting}>
          {getTimeGreeting()}
          {profile ? `, ${profileDisplayName(profile)}` : ''}
        </Text>
        <Text style={styles.subtitle}>{getHomeTagline(hotSpotLoading, hotSpotList[0])}</Text>
      </View>

      {activeTrip && isTripPaused && (
        <View style={styles.pausedTripBanner}>
          <Text style={styles.pausedTripLabel}>Trip paused</Text>
          <Text style={styles.pausedTripTitle} numberOfLines={1}>
            {activeTrip.location?.name || 'Fishing Trip'}
          </Text>
          <Text style={styles.pausedTripSub}>Resume or end when you’re back on the water.</Text>
          <View style={styles.pausedTripStats}>
            <View style={styles.pausedStat}>
              <Text style={styles.pausedStatValue}>{elapsed}</Text>
              <Text style={styles.pausedStatLabel}>Fishing time</Text>
            </View>
            <View style={styles.pausedStat}>
              <Text style={styles.pausedStatValue}>{fishCount}</Text>
              <Text style={styles.pausedStatLabel}>Fish</Text>
            </View>
          </View>
          <View style={styles.pausedTripActions}>
            <Pressable style={styles.resumeTripBtn} onPress={handleResumeTrip}>
              <MaterialCommunityIcons name="play" size={22} color={Colors.textInverse} />
              <Text style={styles.resumeTripBtnText}>Resume</Text>
            </Pressable>
            <Pressable style={styles.endTripFromHomeBtn} onPress={handleEndTripFromHome}>
              <Text style={styles.endTripFromHomeBtnText}>End trip</Text>
            </Pressable>
          </View>
        </View>
      )}

      {plannedTrips.length > 0 && (
        <View style={styles.plannedSection}>
          <Text style={styles.sectionTitle}>Up next</Text>
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

      <View style={styles.todaysAngleSection}>
        <Text style={styles.todaysAngleSectionTitle}>{"Today's angle"}</Text>
        {hotSpotLoading ? (
          <View style={[styles.hotSpotCard, styles.todaysAngleLoading]}>
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.lg }} />
          </View>
        ) : hotSpotList[0] ? (
          <>
            <View style={styles.hotSpotCardWrap}>
              <HotSpotCard
                hotSpotData={hotSpotList[0]}
                onPress={() => router.push(`/spot/${hotSpotList[0].location.id}`)}
              />
            </View>
            {hotSpotsExpanded &&
              hotSpotList.slice(1).map((hotSpot) => (
                <View key={hotSpot.location.id} style={styles.hotSpotCardWrap}>
                  <HotSpotCard
                    hotSpotData={hotSpot}
                    onPress={() => router.push(`/spot/${hotSpot.location.id}`)}
                  />
                </View>
              ))}
            {hotSpotList.length > 1 && !hotSpotsExpanded ? (
              <Pressable style={styles.seeMoreHotSpots} onPress={() => setHotSpotsExpanded(true)}>
                <Text style={styles.seeMoreHotSpotsText}>More waters to consider</Text>
                <Ionicons name="chevron-down" size={18} color={Colors.primary} />
              </Pressable>
            ) : null}
            {hotSpotsExpanded && hotSpotList.length > 1 ? (
              <Pressable style={styles.seeMoreHotSpots} onPress={() => setHotSpotsExpanded(false)}>
                <Text style={styles.seeMoreHotSpotsText}>Show fewer</Text>
                <Ionicons name="chevron-up" size={18} color={Colors.primary} />
              </Pressable>
            ) : null}
          </>
        ) : (
          <View style={[styles.hotSpotCard, styles.todaysAngleEmptyCard]}>
            <Text style={styles.todaysAngleEmptyText}>
              {
                "When you have waters in the app, we'll highlight where conditions look strongest so you can pick where to fish."
              }
            </Text>
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
  heroEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: Spacing.sm,
  },
  greeting: {
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  todaysAngleSection: {
    marginBottom: Spacing.lg,
  },
  todaysAngleSectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.md,
  },
  todaysAngleLoading: {
    alignItems: 'center',
  },
  todaysAngleEmptyCard: {
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.sm,
  },
  todaysAngleEmptyText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  hotSpotCardWrap: {
    marginBottom: Spacing.md,
  },
  hotSpotCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
    paddingRight: Spacing.lg,
    paddingLeft: Spacing.lg + Spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: Colors.accent,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  hotSpotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  hotSpotTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  hotSpotName: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  hotSpotDistance: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primaryLight,
    marginTop: Spacing.xs,
  },
  hotSpotStarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingTop: 2,
    flexShrink: 0,
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
    lineHeight: 20,
  },
  seeMoreHotSpots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    marginTop: Spacing.xs,
  },
  seeMoreHotSpotsText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
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
  pausedTripBanner: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  pausedTripLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.warning,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pausedTripTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
    marginTop: Spacing.xs,
  },
  pausedTripSub: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  pausedTripStats: {
    flexDirection: 'row',
    gap: Spacing.lg,
    marginBottom: Spacing.md,
  },
  pausedStat: {},
  pausedStatValue: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  pausedStatLabel: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  pausedTripActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  resumeTripBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
  },
  resumeTripBtnText: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  endTripFromHomeBtn: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  endTripFromHomeBtnText: {
    color: Colors.error,
    fontSize: FontSize.md,
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
