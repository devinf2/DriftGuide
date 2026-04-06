import GuideChat from '@/src/components/GuideChat';
import { FishHomeHatchSection } from '@/src/components/home/FishHomeHatchSection';
import { FishHomeIntro } from '@/src/components/home/FishHomeIntro';
import { FishHomePlannedSection } from '@/src/components/home/FishHomePlannedSection';
import { FishHomeSpotsSection } from '@/src/components/home/FishHomeSpotsSection';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useGuideChatContext } from '@/src/hooks/useGuideChatContext';
import { useHomeHatchBriefing } from '@/src/hooks/useHomeHatchBriefing';
import { useHomeHotSpots } from '@/src/hooks/useHomeHotSpots';
import { useAuthStore } from '@/src/stores/authStore';
import { usePlanTripHomeSuggestionsStore } from '@/src/stores/planTripHomeSuggestionsStore';
import { useTripStore } from '@/src/stores/tripStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { Trip } from '@/src/types';
import { formatFishCount } from '@/src/utils/formatters';
import { profileFirstName } from '@/src/utils/profileDisplay';
import { formatFishingElapsedLabel, getLiveFishingElapsedMs } from '@/src/utils/tripTiming';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function createHomeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    chatFlex: {
      flex: 1,
      minHeight: 0,
    },
    pausedWrap: {
      flexShrink: 0,
    },
    activeTripWrapper: {
      flex: 1,
      padding: Spacing.xl,
    },
    pausedTripCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      marginBottom: Spacing.sm,
    },
    pausedTripHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    pausedTripMain: {
      flex: 1,
      minWidth: 0,
    },
    pausedTripTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    pausedTripLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.warning,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      flexShrink: 0,
    },
    pausedTripSummary: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
      flexShrink: 1,
      minWidth: 0,
      textAlign: 'right',
    },
    pausedTripTitle: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginTop: 4,
    },
    pausedTripActions: {
      flexDirection: 'row',
      gap: Spacing.sm,
      alignItems: 'center',
      marginTop: Spacing.sm,
    },
    resumeTripBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.sm,
    },
    resumeTripBtnText: {
      color: colors.textInverse,
      fontSize: FontSize.sm,
      fontWeight: '700',
    },
    endTripFromHomeBtn: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.error,
    },
    endTripFromHomeBtnText: {
      color: colors.error,
      fontSize: FontSize.sm,
      fontWeight: '600',
    },
    activeTripCard: {
      backgroundColor: colors.primary,
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
      color: colors.textInverse,
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
      color: colors.textInverse,
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
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createHomeStyles(colors), [colors]);
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
  const [elapsed, setElapsed] = useState('0m');
  const [refreshing, setRefreshing] = useState(false);
  const [briefingRefreshKey, setBriefingRefreshKey] = useState(0);

  const getContext = useGuideChatContext();
  const { hotSpotList, hotSpotLoading, watersForRegionalBriefing, userCoords } = useHomeHotSpots(
    fullHome,
    briefingRefreshKey,
  );
  const setFromHomeHotSpots = usePlanTripHomeSuggestionsStore((s) => s.setFromHomeHotSpots);

  useEffect(() => {
    if (fullHome) setFromHomeHotSpots(hotSpotList);
  }, [fullHome, hotSpotList, setFromHomeHotSpots]);
  const { hatchRows, hatchLoading } = useHomeHatchBriefing(
    fullHome,
    hotSpotLoading,
    watersForRegionalBriefing,
    briefingRefreshKey,
    userCoords?.latitude,
    userCoords?.longitude,
  );

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

  const handleStartPlannedTrip = useCallback(
    async (tripId: string) => {
      const result = await startPlannedTrip(tripId);
      if (result) {
        router.push(`/trip/${result}`);
      }
    },
    [startPlannedTrip, router],
  );

  const handleDeletePlannedTrip = useCallback(
    (trip: Trip) => {
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
    },
    [deletePlannedTrip],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user?.id && fullHome) fetchPlannedTrips(user.id);
    if (fullHome) setBriefingRefreshKey((k) => k + 1);
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

  const openSpot = useCallback(
    (locationId: string) => {
      router.push(`/spot/${locationId}`);
    },
    [router],
  );

  if (activeTrip && !isTripPaused) {
    return (
      <View style={[styles.container, { paddingTop: effectiveTop }]}>
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
    <View style={styles.container}>
      {activeTrip && isTripPaused && (
        <View style={[styles.pausedWrap, { paddingTop: effectiveTop + Spacing.sm, paddingHorizontal: Spacing.xl }]}>
          <View style={styles.pausedTripCard}>
            <Pressable
              style={styles.pausedTripHeader}
              onPress={() => router.push(`/trip/${activeTrip.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Paused trip, ${activeTrip.location?.name || 'Fishing Trip'}`}
              accessibilityHint="Opens trip dashboard"
            >
              <View style={styles.pausedTripMain}>
                <View style={styles.pausedTripTopRow}>
                  <Text style={styles.pausedTripLabel}>Trip paused</Text>
                  <Text style={styles.pausedTripSummary} numberOfLines={1}>
                    {elapsed} · {fishCount === 1 ? '1 fish' : `${fishCount} fish`}
                  </Text>
                </View>
                <Text style={styles.pausedTripTitle} numberOfLines={1}>
                  {activeTrip.location?.name || 'Fishing Trip'}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textTertiary} />
            </Pressable>
            <View style={styles.pausedTripActions}>
              <Pressable style={styles.resumeTripBtn} onPress={handleResumeTrip}>
                <MaterialCommunityIcons name="play" size={20} color={colors.textInverse} />
                <Text style={styles.resumeTripBtnText}>Resume</Text>
              </Pressable>
              <Pressable style={styles.endTripFromHomeBtn} onPress={handleEndTripFromHome}>
                <Text style={styles.endTripFromHomeBtnText}>End trip</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      <View style={styles.chatFlex}>
        <GuideChat
          getContext={getContext}
          variant="full"
          contentTopPadding={activeTrip && isTripPaused ? 0 : insets.top}
          refreshControl={
            fullHome ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            ) : undefined
          }
          listHeaderComponent={
            fullHome ? (
              <View>
                <FishHomeIntro
                  userFirstName={profileFirstName(profile)}
                  briefingLoading={hotSpotLoading}
                  rankedWatersCount={hotSpotList.length}
                />
                <FishHomePlannedSection
                  plannedTrips={plannedTrips}
                  plannedTripsLoading={plannedTripsLoading}
                  onStartTrip={handleStartPlannedTrip}
                  onDeleteTrip={handleDeletePlannedTrip}
                />
                <FishHomeHatchSection loading={hatchLoading} rows={hatchRows} />
                <FishHomeSpotsSection
                  hotSpotLoading={hotSpotLoading}
                  hotSpotList={hotSpotList}
                  onOpenSpot={openSpot}
                />
              </View>
            ) : undefined
          }
        />
      </View>
    </View>
  );
}
