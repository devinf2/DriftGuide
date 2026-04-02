import { FishHomeHatchSection } from '@/src/components/home/FishHomeHatchSection';
import { FishHomeIntro } from '@/src/components/home/FishHomeIntro';
import { FishHomePlannedSection } from '@/src/components/home/FishHomePlannedSection';
import { FishHomeSpotsSection } from '@/src/components/home/FishHomeSpotsSection';
import GuideChat from '@/src/components/GuideChat';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useGuideChatContext } from '@/src/hooks/useGuideChatContext';
import { useHomeHatchBriefing } from '@/src/hooks/useHomeHatchBriefing';
import { useHomeHotSpots } from '@/src/hooks/useHomeHotSpots';
import { useAuthStore } from '@/src/stores/authStore';
import { usePlanTripHomeSuggestionsStore } from '@/src/stores/planTripHomeSuggestionsStore';
import { useTripStore } from '@/src/stores/tripStore';
import { Trip } from '@/src/types';
import { formatFishCount } from '@/src/utils/formatters';
import { profileFirstName } from '@/src/utils/profileDisplay';
import { formatFishingElapsedLabel, getLiveFishingElapsedMs } from '@/src/utils/tripTiming';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
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
    pausedTripBanner: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    pausedTripLabel: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.warning,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    pausedTripTitle: {
      fontSize: FontSize.xl,
      fontWeight: '700',
      color: colors.text,
      marginTop: Spacing.xs,
    },
    pausedTripSub: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
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
      color: colors.text,
    },
    pausedStatLabel: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
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
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
    },
    resumeTripBtnText: {
      color: colors.textInverse,
      fontSize: FontSize.md,
      fontWeight: '700',
    },
    endTripFromHomeBtn: {
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.error,
    },
    endTripFromHomeBtnText: {
      color: colors.error,
      fontSize: FontSize.md,
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
  const { hotSpotList, hotSpotLoading, watersForRegionalBriefing } = useHomeHotSpots(fullHome, briefingRefreshKey);
  const setFromHomeHotSpots = usePlanTripHomeSuggestionsStore((s) => s.setFromHomeHotSpots);

  useEffect(() => {
    if (fullHome) setFromHomeHotSpots(hotSpotList);
  }, [fullHome, hotSpotList, setFromHomeHotSpots]);
  const { hatchRows, hatchLoading } = useHomeHatchBriefing(
    fullHome,
    hotSpotLoading,
    watersForRegionalBriefing,
    briefingRefreshKey,
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
    <View style={styles.container}>
      {activeTrip && isTripPaused && (
        <View style={[styles.pausedWrap, { paddingTop: insets.top + Spacing.md, paddingHorizontal: Spacing.xl }]}>
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
                <MaterialCommunityIcons name="play" size={22} color={colors.textInverse} />
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
                <FishHomeIntro userFirstName={profileFirstName(profile)} />
                <FishHomeHatchSection loading={hatchLoading} rows={hatchRows} />
                <FishHomeSpotsSection
                  hotSpotLoading={hotSpotLoading}
                  hotSpotList={hotSpotList}
                  onOpenSpot={openSpot}
                />
                <FishHomePlannedSection
                  plannedTrips={plannedTrips}
                  plannedTripsLoading={plannedTripsLoading}
                  onStartTrip={handleStartPlannedTrip}
                  onDeleteTrip={handleDeletePlannedTrip}
                />
              </View>
            ) : undefined
          }
        />
      </View>
    </View>
  );
}
