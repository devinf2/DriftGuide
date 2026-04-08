import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  Dimensions,
  Linking,
  Switch,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import {
  getTripEndpointInitialCoords,
  patchTripEndpointCoords,
  type TripEndpointKind,
} from '@/src/components/journal/TripEndpointPinModal';
import { TripPhotoVisibilityDropdown } from '@/src/components/TripPhotoVisibilityDropdown';
import { effectiveTripPhotoVisibility } from '@/src/constants/tripPhotoVisibility';
import { fetchTripEvents, fetchTripsFromCloud, syncTripToCloud } from '@/src/services/sync';
import { fetchPhotos } from '@/src/services/photoService';
import {
  Trip,
  TripEvent,
  TripPhotoVisibility,
  CatchData,
  AIQueryData,
  WaterFlowData,
  NextFlyRecommendation,
  EventConditionsSnapshot,
  Photo,
} from '@/src/types';
import { getCatchHeroPhotoUrl } from '@/src/utils/catchPhotos';
import { formatTripDate, formatTripDuration, formatEventTime, formatFlowRate, formatTemperature } from '@/src/utils/formatters';
import { getTripEventDescription } from '@/src/utils/journalTimeline';
import { inferActiveFishingMsFromPauseResumeEvents } from '@/src/utils/tripTiming';
import { useAuthStore } from '@/src/stores/authStore';
import { useFriendsStore } from '@/src/stores/friendsStore';
import { useTripStore } from '@/src/stores/tripStore';
import { getFlowStatus, FLOW_STATUS_LABELS, FLOW_STATUS_COLORS } from '@/src/services/waterFlow';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { JournalTripRouteMapView, buildJournalWaypoints } from '@/src/components/map/JournalTripRouteMapView';
import { ConditionsTab } from '@/src/components/trip-tabs/ConditionsTab';
import { SharedTripPhotosSection } from '@/src/components/trip/SharedTripPhotosSection';
import { SharedTripTimelineSection } from '@/src/components/trip/SharedTripTimelineSection';
import { TripSessionPeopleSheet } from '@/src/components/trip/TripSessionPeopleSheet';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { tripMapDefaultCenterCoordinate } from '@/src/utils/mapViewport';
import { tripStartEndDisplayCoords } from '@/src/utils/tripStartEndFromEvents';
import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import { isTripPinned, reconcileTripPhotoCache, togglePinTrip } from '@/src/services/tripPhotoOfflineCache';

type TabKey = 'fishing' | 'photos' | 'conditions' | 'map';

type TripPinPlacementState = {
  kind: TripEndpointKind;
  lat: number;
  lng: number;
  focusKey: number;
};

/** After `router.replace` (e.g. survey → summary), there may be no stack entry — `back()` throws in dev. */
function exitTripSummary(router: ReturnType<typeof useRouter>) {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/journal');
  }
}

export default function TripSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const { user, profile } = useAuthStore();
  const { deleteTrip } = useTripStore();
  const { isConnected } = useNetworkStatus();
  const { colors: themeColors } = useAppTheme();
  const styles = useMemo(() => createTripSummaryStyles(themeColors), [themeColors]);
  const [journalEditMode, setJournalEditMode] = useState(false);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [events, setEvents] = useState<TripEvent[]>([]);
  const [tripPhotos, setTripPhotos] = useState<Photo[]>([]);
  const [tripPhotosLoading, setTripPhotosLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('fishing');
  const [fullScreenPhoto, setFullScreenPhoto] = useState<{
    url: string;
    location?: string;
    fly?: string;
    date?: string;
    species?: string;
    caption?: string;
  } | null>(null);
  const [tripPinPlacement, setTripPinPlacement] = useState<TripPinPlacementState | null>(null);
  const [tripPinPlacementSaving, setTripPinPlacementSaving] = useState(false);
  /** Map tab: catch pin tapped when there is no photo (full-screen flow uses `fullScreenPhoto`) */
  const [mapCatchDetailEvent, setMapCatchDetailEvent] = useState<TripEvent | null>(null);
  const [keepOfflinePinned, setKeepOfflinePinned] = useState(false);
  const [tripAiSummaryModalVisible, setTripAiSummaryModalVisible] = useState(false);
  const [peopleSheetVisible, setPeopleSheetVisible] = useState(false);
  const [photoVisSaving, setPhotoVisSaving] = useState(false);
  const friendships = useFriendsStore((s) => s.friendships);
  const refreshFriends = useFriendsStore((s) => s.refresh);

  useEffect(() => {
    setJournalEditMode(false);
    setTripPinPlacement(null);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    isTripPinned(id).then((pinned) => {
      if (!cancelled) setKeepOfflinePinned(pinned);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    void refreshFriends(user?.id ?? null);
  }, [user?.id, refreshFriends]);

  useEffect(() => {
    async function load() {
      if (!user || !id) return;
      const trips = await fetchTripsFromCloud(user.id);
      const found = trips.find(t => t.id === id);
      if (found) setTrip(found);

      const tripEvents = await fetchTripEvents(id);
      setEvents(tripEvents);
      setLoading(false);
    }
    load();
  }, [id, user]);

  const handleSessionChanged = useCallback((sid: string | null) => {
    setTrip((prev) => (prev ? { ...prev, shared_session_id: sid } : null));
  }, []);

  const loadTripPhotos = useCallback(async () => {
    if (!user || !id) return;
    setTripPhotosLoading(true);
    try {
      const photos = await fetchPhotos(user.id, { tripId: id });
      setTripPhotos(photos);
    } catch {
      setTripPhotos([]);
    } finally {
      setTripPhotosLoading(false);
    }
  }, [user?.id, id]);

  // Load trip photos when entry loads for the Photos tab
  useEffect(() => {
    if (trip && id) loadTripPhotos();
  }, [trip, id, loadTripPhotos]);

  const handleCatchPhotoPress = useCallback((event: TripEvent) => {
    const data = event.data as CatchData;
    const hero = getCatchHeroPhotoUrl(data);
    if (!hero) return;
    setFullScreenPhoto({
      url: hero,
      location: trip?.location?.name ?? undefined,
      date: formatTripDate(event.timestamp),
      species: data.species ?? undefined,
      caption: data.note ?? undefined,
    });
  }, [trip?.location?.name]);

  const handleMapCatchWaypointPress = useCallback(
    (catchEventId: string) => {
      const ev = events.find((e) => e.id === catchEventId && e.event_type === 'catch');
      if (!ev) return;
      const data = ev.data as CatchData;
      const hero = getCatchHeroPhotoUrl(data);
      if (hero) {
        setFullScreenPhoto({
          url: hero,
          location: trip?.location?.name ?? undefined,
          date: formatTripDate(ev.timestamp),
          species: data.species ?? undefined,
          caption: data.note ?? undefined,
        });
      } else {
        setMapCatchDetailEvent(ev);
      }
    },
    [events, trip?.location?.name],
  );

  const persistTripPins = useCallback(
    async (nextTrip: Trip, nextEvents: TripEvent[]): Promise<boolean> => {
      if (!isConnected) {
        Alert.alert('Offline', 'Connect to the internet to save changes.');
        return false;
      }
      if (!user || !id) return false;
      setTrip(nextTrip);
      setEvents(nextEvents);
      const ok = await syncTripToCloud(nextTrip, nextEvents);
      if (!ok) {
        Alert.alert('Could not save', 'Try again.');
        const trips = await fetchTripsFromCloud(user.id);
        const found = trips.find((t) => t.id === id);
        if (found) setTrip(found);
        const ev = await fetchTripEvents(id);
        setEvents(ev);
        return false;
      }
      return true;
    },
    [isConnected, user, id],
  );

  const openTripPinPlacement = useCallback(
    (kind: TripEndpointKind) => {
      if (!trip) return;
      const init = getTripEndpointInitialCoords(trip, kind);
      const fallback = tripMapDefaultCenterCoordinate(trip);
      const lat = init.lat ?? fallback[1];
      const lng = init.lon ?? fallback[0];
      setTripPinPlacement({ kind, lat, lng, focusKey: Date.now() });
      setActiveTab('map');
    },
    [trip],
  );

  const handleTripPinPlacementMove = useCallback((lat: number, lng: number) => {
    setTripPinPlacement((prev) => (prev ? { ...prev, lat, lng } : prev));
  }, []);

  const cancelTripPinPlacement = useCallback(() => {
    setTripPinPlacement(null);
  }, []);

  const saveTripPinPlacement = useCallback(async () => {
    if (!trip || !tripPinPlacement) return;
    if (!isConnected) {
      Alert.alert('Offline', 'Connect to the internet to save changes.');
      return;
    }
    const { lat, lng, kind } = tripPinPlacement;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      Alert.alert('Set a location', 'Pan the map to choose a point.');
      return;
    }
    setTripPinPlacementSaving(true);
    try {
      const { trip: nextTrip, events: nextEvents } = patchTripEndpointCoords(trip, events, kind, lat, lng);
      const ok = await persistTripPins(nextTrip, nextEvents);
      if (ok) setTripPinPlacement(null);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setTripPinPlacementSaving(false);
    }
  }, [trip, tripPinPlacement, isConnected, events, persistTripPins]);

  const selectTab = useCallback((key: TabKey) => {
    if (key !== 'map') setTripPinPlacement(null);
    setActiveTab(key);
  }, []);

  const handleTripPhotoPress = useCallback((photo: Photo) => {
    setFullScreenPhoto({
      url: photo.url,
      location: trip?.location?.name ?? undefined,
      fly: [photo.fly_pattern, photo.fly_size ? `#${photo.fly_size}` : null, photo.fly_color].filter(Boolean).join(' ') || undefined,
      date: (photo.captured_at || photo.created_at) ? formatTripDate(photo.captured_at || photo.created_at!) : undefined,
      species: photo.species ?? undefined,
      caption: photo.caption ?? undefined,
    });
  }, [trip?.location?.name]);

  const handleKeepOfflineChange = useCallback(
    async (next: boolean) => {
      if (!id || !user) return;
      const current = await isTripPinned(id);
      if (next === current) return;
      try {
        await togglePinTrip(id);
        setKeepOfflinePinned(next);
        if (isConnected) {
          await reconcileTripPhotoCache(user.id);
        }
      } catch (e) {
        Alert.alert('Could not update', (e as Error).message);
      }
    },
    [id, user, isConnected],
  );

  const effectivePhotoVisibility = useMemo(
    () => (trip ? effectiveTripPhotoVisibility(trip, profile) : 'private'),
    [trip, profile],
  );

  const tripDurationLabel = useMemo(() => {
    if (!trip) return '';
    let ms: number | null | undefined = trip.active_fishing_ms;
    if ((ms == null || ms === 0) && events.length > 0) {
      const inferred = inferActiveFishingMsFromPauseResumeEvents(
        trip.start_time,
        trip.end_time,
        events,
      );
      if (inferred != null) ms = inferred;
    }
    return formatTripDuration(trip.start_time, trip.end_time, {
      imported: trip.imported,
      activeFishingMs: ms ?? undefined,
    });
  }, [trip, events]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={themeColors.primary} />
          <Text style={styles.loadingText}>Loading trip...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!trip) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Trip not found</Text>
          <Pressable style={styles.backButton} onPress={() => exitTripSummary(router)}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const handleDeleteTrip = () => {
    if (!id) return;
    const photoCount = tripPhotos.length;
    const photoWarning = photoCount > 0
      ? `\n\n${photoCount} photo${photoCount === 1 ? '' : 's'} associated with this trip will be permanently deleted.`
      : '';
    Alert.alert(
      'Delete Trip',
      `Remove this trip from your journal? This cannot be undone.${photoWarning}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteTrip(id);
              exitTripSummary(router);
            } catch {
              Alert.alert('Error', 'Could not delete trip. Try again.');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Full-screen photo view — same as photo library */}
      <Modal
        visible={fullScreenPhoto != null}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => setFullScreenPhoto(null)}
      >
        <View style={[styles.fullScreenPhotoWrap, { paddingTop: effectiveTop, paddingBottom: insets.bottom }]}>
          <Pressable
            style={[styles.fullScreenPhotoClose, { top: insets.top + Spacing.sm }]}
            onPress={() => setFullScreenPhoto(null)}
          >
            <MaterialCommunityIcons name="close" size={28} color={themeColors.textInverse} />
          </Pressable>
          {fullScreenPhoto && (
            <ScrollView
              style={styles.fullScreenPhotoScroll}
              contentContainerStyle={[styles.fullScreenPhotoScrollContent, { paddingBottom: insets.bottom + Spacing.xl }]}
              showsVerticalScrollIndicator={false}
            >
              <OfflineTripPhotoImage
                remoteUri={fullScreenPhoto.url}
                style={[styles.fullScreenPhotoImage, { width: Dimensions.get('window').width, height: Math.round(Dimensions.get('window').height * 0.55) }]}
                contentFit="contain"
              />
              <View style={styles.fullScreenPhotoInfo}>
                {fullScreenPhoto.location ? (
                  <Text style={styles.fullScreenPhotoInfoRow}>
                    <MaterialCommunityIcons name="map-marker" size={16} color={themeColors.textInverse} /> {fullScreenPhoto.location}
                  </Text>
                ) : null}
                {fullScreenPhoto.fly ? (
                  <Text style={styles.fullScreenPhotoInfoRow}>
                    <MaterialCommunityIcons name="hook" size={16} color={themeColors.textInverse} /> {fullScreenPhoto.fly}
                  </Text>
                ) : null}
                {fullScreenPhoto.date ? (
                  <Text style={styles.fullScreenPhotoInfoRow}>
                    <MaterialIcons name="calendar-today" size={16} color={themeColors.textInverse} /> {fullScreenPhoto.date}
                  </Text>
                ) : null}
                {fullScreenPhoto.species ? (
                  <Text style={styles.fullScreenPhotoInfoRow}>
                    <MaterialCommunityIcons name="fish" size={16} color={themeColors.textInverse} /> {fullScreenPhoto.species}
                  </Text>
                ) : null}
                {fullScreenPhoto.caption ? (
                  <Text style={styles.fullScreenPhotoCaption}>{fullScreenPhoto.caption}</Text>
                ) : null}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Map tab: catch without photo */}
      <Modal
        visible={mapCatchDetailEvent != null}
        transparent
        animationType="slide"
        onRequestClose={() => setMapCatchDetailEvent(null)}
      >
        <View style={styles.mapCatchModalRoot}>
          <Pressable style={styles.mapCatchModalDim} onPress={() => setMapCatchDetailEvent(null)} />
          {mapCatchDetailEvent ? (
            <View style={[styles.mapCatchModalSheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
              <View style={styles.mapCatchModalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mapCatchModalTitle}>
                    {(mapCatchDetailEvent.data as CatchData).species?.trim() || 'Catch'}
                  </Text>
                  <Text style={styles.mapCatchModalSubtitle}>
                    {formatTripDate(mapCatchDetailEvent.timestamp)}
                  </Text>
                </View>
                <Pressable onPress={() => setMapCatchDetailEvent(null)} hitSlop={12}>
                  <MaterialIcons name="close" size={22} color={themeColors.textSecondary} />
                </Pressable>
              </View>
              {(() => {
                const d = mapCatchDetailEvent.data as CatchData;
                return (
                  <>
                    {d.size_inches != null ? (
                      <Text style={styles.mapCatchModalRow}>
                        <MaterialCommunityIcons name="ruler" size={16} color={themeColors.textSecondary} /> {d.size_inches}
                        {'"'}{' '}
                        {d.quantity != null && d.quantity > 1 ? `· ×${d.quantity}` : ''}
                      </Text>
                    ) : d.quantity != null && d.quantity > 1 ? (
                      <Text style={styles.mapCatchModalRow}>
                        <MaterialCommunityIcons name="fish" size={16} color={themeColors.textSecondary} /> ×{d.quantity}
                      </Text>
                    ) : null}
                    {d.released ? (
                      <Text style={styles.mapCatchModalRow}>
                        <MaterialCommunityIcons name="water" size={16} color={themeColors.textSecondary} /> Released
                      </Text>
                    ) : null}
                    {d.note?.trim() ? (
                      <Text style={styles.mapCatchModalNote}>{d.note.trim()}</Text>
                    ) : null}
                  </>
                );
              })()}
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal
        visible={tripAiSummaryModalVisible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={() => setTripAiSummaryModalVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: themeColors.background }} edges={['top', 'bottom']}>
          <View style={styles.summaryAiModalHeader}>
            <Text style={styles.summaryAiModalTitle}>Trip guide</Text>
            <Pressable onPress={() => setTripAiSummaryModalVisible(false)} hitSlop={12}>
              <Text style={styles.summaryAiModalDone}>Done</Text>
            </Pressable>
          </View>
          <AIGuideTab trip={trip} events={events} summaryStyles={styles} palette={themeColors} />
        </SafeAreaView>
      </Modal>

      {/* Header */}
      <View style={[styles.header, { paddingTop: effectiveTop + Spacing.md }]}>
        <Pressable onPress={() => exitTripSummary(router)}>
          <MaterialIcons name="arrow-back" size={22} color={themeColors.textInverse} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Summary
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setPeopleSheetVisible(true)}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
            hitSlop={8}
            accessibilityLabel="Fishing group"
          >
            <MaterialIcons name="group" size={22} color={themeColors.textInverse} />
          </Pressable>
          <Pressable
            onPress={() => setJournalEditMode((v) => !v)}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
            hitSlop={8}
          >
            <MaterialIcons
              name={journalEditMode ? 'check' : 'edit'}
              size={22}
              color={themeColors.textInverse}
            />
          </Pressable>
          <Pressable
            onPress={handleDeleteTrip}
            disabled={deleting}
            style={({ pressed }) => [{ opacity: (pressed || deleting) ? 0.6 : 1 }]}
            hitSlop={8}
          >
            <MaterialIcons name="delete-outline" size={22} color={themeColors.textInverse} />
          </Pressable>
        </View>
      </View>

      <View style={styles.topBarRow}>
        <View style={styles.offlineLeft}>
          <Text style={styles.keepOfflineLabel} numberOfLines={1}>
            Save offline
          </Text>
          <Switch
            value={keepOfflinePinned}
            onValueChange={handleKeepOfflineChange}
            trackColor={{ false: themeColors.textSecondary, true: themeColors.primaryLight }}
            thumbColor={themeColors.textInverse}
            ios_backgroundColor={themeColors.textSecondary}
            style={styles.keepOfflineSwitch}
          />
        </View>
        <TripPhotoVisibilityDropdown
          colorTokens={themeColors}
          label="Visibility"
          value={effectivePhotoVisibility}
          onChange={(v: TripPhotoVisibility) => {
            void (async () => {
              if (!trip || !user) return;
              if (!isConnected) {
                Alert.alert('Offline', 'Connect to the internet to update this.');
                return;
              }
              setPhotoVisSaving(true);
              const updated: Trip = { ...trip, trip_photo_visibility: v };
              setTrip(updated);
              const ok = await syncTripToCloud(updated, events);
              setPhotoVisSaving(false);
              if (!ok) {
                Alert.alert('Could not save', 'Try again when you have a stable connection.');
                const trips = await fetchTripsFromCloud(user.id);
                const found = trips.find((t) => t.id === id);
                if (found) setTrip(found);
              }
            })();
          }}
          disabled={!user || !isConnected}
          saving={photoVisSaving}
        />
      </View>

      {/* Date & Location */}
      <View style={styles.dateLocationRow}>
        <Text style={styles.dateLocationName} numberOfLines={1}>
          {trip.location?.name || 'Unknown Location'}
        </Text>
        <Text style={styles.dateLocationDate}>{formatTripDate(trip.start_time)}</Text>
      </View>

      {/* Stats Card */}
      <View style={styles.statsCard}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{trip.total_fish}</Text>
          <Text style={styles.statLabel}>Fish</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {tripDurationLabel}
          </Text>
          <Text style={styles.statLabel}>Duration</Text>
        </View>
      </View>

      {/* Tab Bar — aligned with active trip: Fishing, Photos, Conditions, Map (trip guide is a modal) */}
      <View style={styles.tabBar}>
        {([
          { key: 'fishing' as TabKey, label: 'Fishing' },
          { key: 'photos' as TabKey, label: 'Photos' },
          { key: 'conditions' as TabKey, label: 'Conditions' },
          { key: 'map' as TabKey, label: 'Map' },
        ]).map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => selectTab(tab.key)}
          >
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Tab Content */}
      {activeTab === 'fishing' && user && trip && (
        <SharedTripTimelineSection
          trip={trip}
          userId={user.id}
          isConnected={isConnected}
          events={events}
          editMode={journalEditMode}
          onEventsChange={setEvents}
          onTripPatch={(patch) => setTrip((t) => (t ? { ...t, ...patch } : null))}
          onCatchPhotoPress={handleCatchPhotoPress}
          onRequestEditTripPin={openTripPinPlacement}
        />
      )}
      {activeTab === 'photos' && trip && (
        trip.shared_session_id && user ? (
          <SharedTripPhotosSection
            trip={trip}
            viewerUserId={user.id}
            isConnected={isConnected}
            myTripPhotos={tripPhotos}
            myPhotosLoading={tripPhotosLoading}
            onPhotoPress={handleTripPhotoPress}
          />
        ) : (
          <SummaryPhotosTab
            tripPhotos={tripPhotos}
            loading={tripPhotosLoading}
            onPhotoPress={handleTripPhotoPress}
            summaryStyles={styles}
            palette={themeColors}
          />
        )
      )}
      {activeTab === 'conditions' && (
        <ConditionsTab
          weatherData={trip.weather_cache ?? null}
          waterFlowData={(trip.water_flow_cache as WaterFlowData | null) ?? null}
          location={trip.location}
          note="Conditions at time of trip"
          showHourly={false}
          emptyMessage="No conditions data recorded"
        >
          {(() => {
            const baselineCfs = (trip.location?.metadata as Record<string, unknown> | null)?.baseline_flow_cfs as number | undefined;
            const eventsWithConditions = events.filter(e => e.conditions_snapshot);
            if (eventsWithConditions.length === 0) return null;
            return (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Conditions Timeline</Text>
                <Text style={styles.emptyHint}>Conditions captured at each event</Text>
                {eventsWithConditions.map((event) => {
                  const snap = event.conditions_snapshot as EventConditionsSnapshot;
                  const snapWeather = snap.weather;
                  const snapWater = snap.waterFlow;
                  const snapFlowStatus = snapWater ? getFlowStatus(snapWater.flow_cfs, baselineCfs) : null;
                  return (
                    <View key={event.id} style={styles.snapshotCard}>
                      <View style={styles.snapshotHeader}>
                        <Text style={styles.snapshotTime}>{formatEventTime(event.timestamp)}</Text>
                        <Text style={styles.snapshotEventType}>{getTripEventDescription(event)}</Text>
                      </View>
                      <View style={styles.snapshotGrid}>
                        {snapWeather && (
                          <>
                            <View style={styles.snapshotGridItem}>
                              <MaterialIcons name="thermostat" size={14} color={themeColors.textTertiary} />
                              <Text style={styles.snapshotGridValue}>{snapWeather.temperature_f}°F</Text>
                            </View>
                            <View style={styles.snapshotGridItem}>
                              <MaterialIcons name="air" size={14} color={themeColors.textTertiary} />
                              <Text style={styles.snapshotGridValue}>{snapWeather.wind_speed_mph} mph</Text>
                            </View>
                          </>
                        )}
                        {snapWater && (
                          <>
                            <View style={styles.snapshotGridItem}>
                              <MaterialIcons name="waves" size={14} color={themeColors.water} />
                              <Text style={styles.snapshotGridValue}>{formatFlowRate(snapWater.flow_cfs)}</Text>
                            </View>
                            {snapWater.water_temp_f !== null && (
                              <View style={styles.snapshotGridItem}>
                                <MaterialIcons name="opacity" size={14} color={themeColors.water} />
                                <Text style={styles.snapshotGridValue}>{formatTemperature(snapWater.water_temp_f)}</Text>
                              </View>
                            )}
                            {snapFlowStatus && snapFlowStatus.status !== 'unknown' && (
                              <View style={styles.snapshotGridItem}>
                                <MaterialIcons name="speed" size={14} color={FLOW_STATUS_COLORS[snapFlowStatus.status].border} />
                                <Text style={[styles.snapshotGridValue, { color: FLOW_STATUS_COLORS[snapFlowStatus.status].border }]}>
                                  {FLOW_STATUS_LABELS[snapFlowStatus.status]}
                                </Text>
                              </View>
                            )}
                          </>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })()}
        </ConditionsTab>
      )}
      {activeTab === 'map' && (
        <SummaryMapTab
          trip={trip}
          events={events}
          editMode={journalEditMode}
          tripPinPlacement={tripPinPlacement}
          onRequestEditTripPin={openTripPinPlacement}
          onPlacementMove={handleTripPinPlacementMove}
          onCancelPlacement={cancelTripPinPlacement}
          onSavePlacement={() => void saveTripPinPlacement()}
          placementSaving={tripPinPlacementSaving}
          onCatchWaypointPress={handleMapCatchWaypointPress}
          summaryStyles={styles}
          palette={themeColors}
        />
      )}

      <Pressable
        style={[styles.summaryAiFab, { bottom: Spacing.lg + insets.bottom }]}
        onPress={() => setTripAiSummaryModalVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Open trip guide"
      >
        <MaterialIcons name="chat" size={26} color={themeColors.textInverse} />
      </Pressable>

      {user && trip && id ? (
        <TripSessionPeopleSheet
          visible={peopleSheetVisible}
          onClose={() => setPeopleSheetVisible(false)}
          tripId={id}
          userId={user.id}
          sharedSessionId={trip.shared_session_id ?? null}
          acceptedFriendships={friendships}
          onSessionChanged={handleSessionChanged}
        />
      ) : null}
    </SafeAreaView>
  );
}

/* ─── AI Guide Tab (read-only) ─── */

function AIGuideTab({
  trip,
  events,
  summaryStyles,
  palette,
}: {
  trip: Trip;
  events: TripEvent[];
  summaryStyles: ReturnType<typeof createTripSummaryStyles>;
  palette: ThemeColors;
}) {
  const aiRecommendation = trip.ai_recommendation_cache as NextFlyRecommendation | null;
  const aiQueries = events.filter(e => e.event_type === 'ai_query');
  const hasAIData = aiRecommendation || aiQueries.length > 0;

  return (
    <ScrollView style={summaryStyles.tabContent} contentContainerStyle={summaryStyles.tabContentInner}>
      {!hasAIData && (
        <View style={summaryStyles.emptyCard}>
          <MaterialIcons name="smart-toy" size={32} color={palette.textTertiary} />
          <Text style={summaryStyles.emptyCardText}>No AI data for this trip</Text>
          <Text style={summaryStyles.emptyHint}>AI recommendations and queries are saved when used during a trip.</Text>
        </View>
      )}

      {aiRecommendation && aiRecommendation.pattern && (
        <View style={summaryStyles.aiRecCard}>
          <View style={summaryStyles.aiRecCardHeader}>
            <MaterialIcons name="auto-awesome" size={16} color={palette.accent} />
            <Text style={summaryStyles.aiRecCardLabel}>AI Fly Recommendation</Text>
          </View>
          <Text style={summaryStyles.aiRecFly}>
            {aiRecommendation.pattern}
            {aiRecommendation.size ? ` #${aiRecommendation.size}` : ''}
          </Text>
          {aiRecommendation.color && (
            <Text style={summaryStyles.aiRecColor}>{aiRecommendation.color}</Text>
          )}
          {aiRecommendation.reason && (
            <Text style={summaryStyles.aiRecReason}>{aiRecommendation.reason}</Text>
          )}
          {aiRecommendation.confidence > 0 && (
            <View style={summaryStyles.confidenceBadge}>
              <Text style={summaryStyles.confidenceText}>
                {Math.round(aiRecommendation.confidence * 100)}% confidence
              </Text>
            </View>
          )}
        </View>
      )}

      {aiQueries.length > 0 && (
        <View style={summaryStyles.section}>
          <Text style={summaryStyles.sectionTitle}>AI Conversations</Text>
          {aiQueries.map((event) => {
            const data = event.data as AIQueryData;
            return (
              <View key={event.id} style={summaryStyles.aiQAItem}>
                <View style={summaryStyles.aiQuestion}>
                  <MaterialIcons name="person" size={14} color={palette.primary} />
                  <Text style={summaryStyles.aiQuestionText}>{data.question}</Text>
                </View>
                {data.response && (
                  <View style={summaryStyles.aiAnswer}>
                    <MaterialIcons name="smart-toy" size={14} color={palette.accent} />
                    <Text style={summaryStyles.aiAnswerText}>{data.response}</Text>
                  </View>
                )}
                {data.webSources && data.webSources.length > 0 ? (
                  <View style={summaryStyles.aiSourcesWrap}>
                    <Text style={summaryStyles.aiSourcesLabel}>Web sources</Text>
                    {data.webSources.slice(0, 10).map((s, i) => (
                      <Pressable key={`${s.url}-${i}`} onPress={() => void Linking.openURL(s.url)}>
                        <Text style={summaryStyles.aiSourceLink} numberOfLines={2}>
                          {s.title || s.url}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Text style={summaryStyles.aiQATime}>{formatEventTime(event.timestamp)}</Text>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

/* ─── Photos Tab (read-only, same info as trip Photos tab) ─── */

const SUMMARY_PHOTO_SIZE = 100;

function SummaryPhotosTab({
  tripPhotos,
  loading,
  onPhotoPress,
  summaryStyles,
  palette,
}: {
  tripPhotos: Photo[];
  loading: boolean;
  onPhotoPress?: (photo: Photo) => void;
  summaryStyles: ReturnType<typeof createTripSummaryStyles>;
  palette: ThemeColors;
}) {
  return (
    <ScrollView style={summaryStyles.summaryPhotosScroll} contentContainerStyle={summaryStyles.summaryPhotosContent}>
      <View style={summaryStyles.summaryPhotosHeader}>
        <Text style={summaryStyles.summaryPhotosTitle}>Trip photos</Text>
      </View>
      {loading ? (
        <View style={summaryStyles.summaryPhotosPlaceholder}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : tripPhotos.length === 0 ? (
        <View style={summaryStyles.summaryPhotosEmpty}>
          <MaterialIcons name="photo-library" size={40} color={palette.textTertiary} />
          <Text style={summaryStyles.summaryPhotosEmptyText}>No photos for this trip</Text>
        </View>
      ) : (
        <View style={summaryStyles.summaryPhotosGrid}>
          {tripPhotos.map((photo) => (
            <Pressable key={photo.id} onPress={() => onPhotoPress?.(photo)}>
              <OfflineTripPhotoImage remoteUri={photo.url} style={summaryStyles.summaryPhotoThumb} contentFit="cover" />
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

/* ─── Map Tab (read-only: route + pins; line snaps to nearby trails when possible) ─── */

const TRIP_ROUTE_LEGEND_INFO =
  'The teal line follows Mapbox walking paths near your track (trails and river corridors when available). If no path matches, a straight line connects your points.';

function SummaryMapTab({
  trip,
  events,
  editMode,
  tripPinPlacement,
  onRequestEditTripPin,
  onPlacementMove,
  onCancelPlacement,
  onSavePlacement,
  placementSaving,
  onCatchWaypointPress,
  summaryStyles,
  palette,
}: {
  trip: Trip;
  events: TripEvent[];
  editMode: boolean;
  tripPinPlacement: TripPinPlacementState | null;
  onRequestEditTripPin: (kind: TripEndpointKind) => void;
  onPlacementMove: (lat: number, lng: number) => void;
  onCancelPlacement: () => void;
  onSavePlacement: () => void;
  placementSaving: boolean;
  onCatchWaypointPress: (catchEventId: string) => void;
  summaryStyles: ReturnType<typeof createTripSummaryStyles>;
  palette: ThemeColors;
}) {
  const insets = useSafeAreaInsets();
  const waypoints = useMemo(() => buildJournalWaypoints(trip, events), [trip, events]);
  const hasMapData = waypoints.length > 0;

  const coordSummary = useMemo(() => tripStartEndDisplayCoords(trip, events), [trip, events]);

  const showMap = hasMapData || editMode || tripPinPlacement != null;

  if (!showMap) {
    return (
      <ScrollView style={summaryStyles.tabContent} contentContainerStyle={summaryStyles.tabContentInner}>
        <View style={summaryStyles.summaryMapEmpty}>
          <MaterialIcons name="map" size={40} color={palette.textTertiary} />
          <Text style={summaryStyles.summaryMapEmptyText}>No map data saved for this trip</Text>
          <Text style={summaryStyles.emptyHint}>
            Start and end GPS and catch locations appear here when recorded during the trip.
          </Text>
        </View>
      </ScrollView>
    );
  }

  const placing = tripPinPlacement != null;

  return (
    <View style={summaryStyles.summaryMapTabRoot}>
      <View style={summaryStyles.summaryMapMapWrap}>
        <JournalTripRouteMapView
          trip={trip}
          events={events}
          containerStyle={summaryStyles.summaryMapNative}
          onCatchWaypointPress={onCatchWaypointPress}
          placementKind={placing ? tripPinPlacement.kind : null}
          placementLatitude={placing ? tripPinPlacement.lat : undefined}
          placementLongitude={placing ? tripPinPlacement.lng : undefined}
          placementFocusKey={placing ? tripPinPlacement.focusKey : undefined}
          onPlacementCoordinateChange={placing ? onPlacementMove : undefined}
        />
        {placing ? (
          <View
            style={[
              summaryStyles.summaryMapPlacementBar,
              { paddingBottom: Math.max(insets.bottom, Spacing.sm) },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              style={summaryStyles.summaryMapPlacementBtnGhost}
              onPress={onCancelPlacement}
              disabled={placementSaving}
            >
              <Text style={summaryStyles.summaryMapPlacementBtnGhostText}>Cancel</Text>
            </Pressable>
            <Text style={summaryStyles.summaryMapPlacementTitle} numberOfLines={1}>
              {tripPinPlacement.kind === 'start' ? 'Place start' : 'Place end'}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={[
                summaryStyles.summaryMapPlacementBtnPrimary,
                placementSaving && summaryStyles.summaryMapPlacementBtnDisabled,
              ]}
              onPress={onSavePlacement}
              disabled={placementSaving}
            >
              {placementSaving ? (
                <ActivityIndicator color={palette.textInverse} size="small" />
              ) : (
                <Text style={summaryStyles.summaryMapPlacementBtnPrimaryText}>Save</Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
      <ScrollView
        style={summaryStyles.summaryMapLegendScroll}
        contentContainerStyle={summaryStyles.summaryMapLegendContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={summaryStyles.summaryMapLegendTitleRow}>
          <Text style={summaryStyles.summaryMapLegendTitle} numberOfLines={1}>
            Trip Route
          </Text>
          <Pressable
            onPress={() => Alert.alert('Trip Route', TRIP_ROUTE_LEGEND_INFO)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="How the trip route line is drawn"
          >
            <MaterialIcons name="info-outline" size={22} color={palette.textTertiary} />
          </Pressable>
        </View>
        {editMode ? (
          <View style={summaryStyles.summaryMapEditPins}>
            <Text style={summaryStyles.summaryMapEditPinsHint}>Adjust start and end pins for this trip.</Text>
            <View style={summaryStyles.summaryMapEditPinsRow}>
              <Pressable style={summaryStyles.summaryMapEditPinBtn} onPress={() => onRequestEditTripPin('start')}>
                <MaterialIcons name="place" size={18} color={palette.primary} />
                <Text style={summaryStyles.summaryMapEditPinBtnText}>Start pin</Text>
              </Pressable>
              <Pressable style={summaryStyles.summaryMapEditPinBtn} onPress={() => onRequestEditTripPin('end')}>
                <MaterialIcons name="flag" size={18} color={palette.secondary} />
                <Text style={summaryStyles.summaryMapEditPinBtnText}>End pin</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {coordSummary.startLat != null && coordSummary.startLon != null && (
          <View style={summaryStyles.summaryMapRow}>
            <MaterialIcons name="place" size={18} color={palette.primary} />
            <Text style={summaryStyles.summaryMapLabel}>Start</Text>
            <Text style={summaryStyles.summaryMapCoords}>
              {coordSummary.startLat.toFixed(5)}, {coordSummary.startLon.toFixed(5)}
            </Text>
          </View>
        )}
        {coordSummary.endLat != null && coordSummary.endLon != null && (
          <View style={summaryStyles.summaryMapRow}>
            <MaterialIcons name="flag" size={18} color={palette.secondary} />
            <Text style={summaryStyles.summaryMapLabel}>End</Text>
            <Text style={summaryStyles.summaryMapCoords}>
              {coordSummary.endLat.toFixed(5)}, {coordSummary.endLon.toFixed(5)}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/* ─── Styles ─── */

function createTripSummaryStyles(c: ThemeColors) {
  return StyleSheet.create({
  summaryAiFab: {
    position: 'absolute',
    right: Spacing.md,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 4,
    zIndex: 20,
  },
  summaryAiModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    backgroundColor: c.surface,
  },
  summaryAiModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: c.text,
  },
  summaryAiModalDone: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: c.primary,
  },
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  loadingText: {
    fontSize: FontSize.lg,
    color: c.textSecondary,
  },
  backButton: {
    backgroundColor: c.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  backButtonText: {
    color: c.textInverse,
    fontWeight: '600',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: c.primary,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  headerTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: c.textInverse,
  },

  dateLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  dateLocationName: {
    flex: 1,
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: c.text,
    marginRight: Spacing.sm,
  },
  dateLocationDate: {
    fontSize: FontSize.sm,
    color: c.textSecondary,
  },

  statsCard: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.lg,
    gap: Spacing.lg,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: c.primary,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: c.textSecondary,
    marginTop: 2,
  },

  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    paddingVertical: 6,
    paddingLeft: Spacing.xs,
    paddingRight: Spacing.sm,
    gap: Spacing.sm,
    backgroundColor: c.surface,
    borderRadius: BorderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  offlineLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  keepOfflineLabel: {
    flexShrink: 1,
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: c.textSecondary,
  },
  keepOfflineSwitch: {
    transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }],
  },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: c.primary,
  },
  tabLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: c.textTertiary,
  },
  tabLabelActive: {
    color: c.primary,
  },

  tabContent: {
    flex: 1,
  },
  tabContentInner: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },

  summaryMapTabRoot: {
    flex: 1,
    minHeight: 320,
  },
  summaryMapMapWrap: {
    flex: 1,
    minHeight: 280,
    position: 'relative',
  },
  summaryMapNative: {
    flex: 1,
    minHeight: 280,
  },
  summaryMapPlacementBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    backgroundColor: 'rgba(30, 41, 59, 0.94)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  summaryMapPlacementTitle: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: c.textInverse,
    textAlign: 'center',
  },
  summaryMapPlacementBtnGhost: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    minWidth: 72,
  },
  summaryMapPlacementBtnGhostText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  summaryMapPlacementBtnPrimary: {
    minWidth: 72,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryMapPlacementBtnDisabled: {
    opacity: 0.7,
  },
  summaryMapPlacementBtnPrimaryText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: c.textInverse,
  },
  summaryMapLegendScroll: {
    maxHeight: 200,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
    backgroundColor: c.background,
  },
  summaryMapLegendContent: {
    padding: Spacing.lg,
    gap: Spacing.sm,
    paddingBottom: Spacing.xl,
  },
  summaryMapLegendTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
  },
  summaryMapLegendTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: c.text,
  },

  // Summary Photos tab
  summaryPhotosScroll: {
    flex: 1,
  },
  summaryPhotosContent: {
    padding: Spacing.lg,
  },
  summaryPhotosHeader: {
    marginBottom: Spacing.md,
  },
  summaryPhotosTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: c.text,
  },
  summaryPhotosPlaceholder: {
    padding: Spacing.xl,
    alignItems: 'center',
  },
  summaryPhotosEmpty: {
    alignItems: 'center',
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  summaryPhotosEmptyText: {
    fontSize: FontSize.sm,
    color: c.textSecondary,
  },
  summaryPhotosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  summaryPhotoThumb: {
    width: SUMMARY_PHOTO_SIZE,
    height: SUMMARY_PHOTO_SIZE,
    borderRadius: BorderRadius.md,
    backgroundColor: c.borderLight,
  },

  // Summary Map tab
  summaryMapEmpty: {
    alignItems: 'center',
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  summaryMapEmptyText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: c.textSecondary,
  },
  summaryMapCard: {
    backgroundColor: c.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  summaryMapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  summaryMapLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: c.text,
    minWidth: 40,
  },
  summaryMapCoords: {
    fontSize: FontSize.xs,
    color: c.textSecondary,
  },
  summaryMapEditPins: {
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  summaryMapEditPinsHint: {
    fontSize: FontSize.sm,
    color: c.textSecondary,
  },
  summaryMapEditPinsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  summaryMapEditPinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  summaryMapEditPinBtnText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: c.text,
  },

  // Conditions summary
  summaryCard: {
    backgroundColor: c.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: c.accent,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  summaryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  summaryCardTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: c.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryCardText: {
    fontSize: FontSize.md,
    color: c.text,
    lineHeight: 24,
  },
  conditionsNote: {
    fontSize: FontSize.xs,
    color: c.textTertiary,
    fontStyle: 'italic',
    marginTop: Spacing.sm,
  },

  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: c.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  fullScreenPhotoWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  fullScreenPhotoClose: {
    position: 'absolute',
    right: Spacing.lg,
    zIndex: 10,
    padding: Spacing.sm,
  },
  fullScreenPhotoScroll: {
    flex: 1,
  },
  fullScreenPhotoScrollContent: {
    flexGrow: 1,
  },
  fullScreenPhotoImage: {
    marginTop: Spacing.sm,
  },
  fullScreenPhotoInfo: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.xs,
  },
  fullScreenPhotoInfoRow: {
    fontSize: FontSize.md,
    color: c.textInverse,
    marginBottom: Spacing.xs,
  },
  fullScreenPhotoCaption: {
    fontSize: FontSize.sm,
    color: c.textTertiary,
    marginTop: Spacing.xs,
  },

  mapCatchModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  mapCatchModalDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  mapCatchModalSheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    maxHeight: '55%',
  },
  mapCatchModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  mapCatchModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: c.text,
  },
  mapCatchModalSubtitle: {
    fontSize: FontSize.sm,
    color: c.textSecondary,
    marginTop: 4,
  },
  mapCatchModalRow: {
    fontSize: FontSize.md,
    color: c.text,
    marginBottom: Spacing.sm,
  },
  mapCatchModalNote: {
    fontSize: FontSize.md,
    color: c.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: 22,
  },

  conditionCard: {
    backgroundColor: c.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  conditionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  conditionCardTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: c.text,
  },
  conditionMainStat: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  conditionMainValue: {
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    color: c.primary,
  },
  conditionMainLabel: {
    fontSize: FontSize.md,
    color: c.textSecondary,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  conditionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  conditionGridItem: {
    width: '47%',
    backgroundColor: c.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  conditionGridLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: c.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  conditionGridValue: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: c.text,
    marginTop: 4,
  },
  moonPhaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 4,
  },

  statusBadge: {
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1.5,
  },
  statusBadgeLabel: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: c.text,
  },
  statusBadgeDesc: {
    fontSize: FontSize.sm,
    color: c.textSecondary,
    marginTop: 4,
    lineHeight: 20,
  },

  emptyCard: {
    backgroundColor: c.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
    borderStyle: 'dashed',
    gap: Spacing.sm,
  },
  emptyCardText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: c.textSecondary,
  },
  emptyHint: {
    fontSize: FontSize.sm,
    color: c.textTertiary,
    textAlign: 'center',
  },

  aiRecCard: {
    backgroundColor: c.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: c.accent,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  aiRecCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  aiRecCardLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: c.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aiRecFly: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: c.text,
  },
  aiRecColor: {
    fontSize: FontSize.sm,
    color: c.textSecondary,
    marginTop: 2,
  },
  aiRecReason: {
    fontSize: FontSize.md,
    color: c.textSecondary,
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  confidenceBadge: {
    alignSelf: 'flex-start',
    backgroundColor: c.background,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs,
    marginTop: Spacing.sm,
  },
  confidenceText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: c.textSecondary,
  },

  aiQAItem: {
    backgroundColor: c.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  aiQuestion: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  aiQuestionText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: c.text,
    flex: 1,
  },
  aiAnswer: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  aiAnswerText: {
    fontSize: FontSize.sm,
    color: c.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
  aiSourcesWrap: {
    marginTop: Spacing.xs,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
    gap: Spacing.xs,
  },
  aiSourcesLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: c.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aiSourceLink: {
    fontSize: FontSize.sm,
    color: c.primary,
    textDecorationLine: 'underline',
  },
  aiQATime: {
    fontSize: FontSize.xs,
    color: c.textTertiary,
    textAlign: 'right',
  },

  snapshotCard: {
    backgroundColor: c.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: c.water,
    gap: Spacing.sm,
  },
  snapshotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  snapshotTime: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: c.primary,
  },
  snapshotEventType: {
    fontSize: FontSize.sm,
    color: c.textSecondary,
    flex: 1,
  },
  snapshotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  snapshotGridItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: c.background,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  snapshotGridValue: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: c.text,
  },
  });
}
