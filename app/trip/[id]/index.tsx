import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable, ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { LabeledEndpointMapPin } from '@/src/components/map/LabeledEndpointMapPin';
import { CatchDetailsModal, type CatchDetailsSubmitAdd } from '@/src/components/catch/CatchDetailsModal';
import { ChangeFlyPickerModal, splitFlyChangeData } from '@/src/components/fly/ChangeFlyPickerModal';
import { TripMapboxMapView, type TripMapboxMapRef } from '@/src/components/map/TripMapboxMapView';
import { ConditionsTab } from '@/src/components/trip-tabs/ConditionsTab';
import { USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { SAMPLE_OFFLINE_BOUNDING_BOX } from '@/src/constants/offlineSampleRegion';
import { downloadSampleOfflineRegion } from '@/src/services/mapboxOfflineRegion';
import {
  cachedPinFromCatchEvent,
  enqueuePendingCatch,
  getCachedCatchPins,
  mergeCachedCatchesFromRows,
  mergeCachedPins,
  removePendingCatchByEventId,
  type CachedCatchPin,
} from '@/src/services/mapCatchLocalStore';
import { prefetchCatchesForBounds } from '@/src/services/mapCatchPrefetch';
import { fetchCatchesInBounds, upsertCatchEventToCloud } from '@/src/services/sync';
import { isPointInBoundingBox, type BoundingBox } from '@/src/types/boundingBox';
import { COMMON_FLIES_BY_NAME, FLY_COLORS, FLY_NAMES, FLY_SIZES, COMMON_SPECIES as SPECIES_OPTIONS } from '@/src/constants/fishingTypes';
import { BorderRadius, Colors, FontSize, Spacing } from '@/src/constants/theme';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { askAI, getSeason, getSpotFishingSummary, getSpotHowToFish, getTimeOfDay } from '@/src/services/ai';
import { enrichContextWithLocationCatchData } from '@/src/services/guideCatchContext';
import { buildConditionsFromWeatherAndFlow } from '@/src/services/conditions';
import { fetchFlies, getFliesFromCache } from '@/src/services/flyService';
import { buildPendingFromAddPhotoOptions, savePendingPhoto } from '@/src/services/pendingPhotoStorage';
import { addPhoto, fetchPhotos, PhotoQueuedOfflineError } from '@/src/services/photoService';
import { useLocationStore } from '@/src/stores/locationStore';
import { useTripStore } from '@/src/stores/tripStore';
import {
  AIQueryData,
  CatchData,
  Fly,
  FlyChangeData,
  NoteData,
  Photo,
  PresentationMethod,
  Structure,
  Trip,
  TripEvent,
} from '@/src/types';
import { formatEventTime, formatFishCount, formatTripDate } from '@/src/utils/formatters';
import {
  findActiveFlyEventIdBefore,
  sortEventsByTime,
  timestampBetween,
  upsertEventSorted,
} from '@/src/utils/journalTimeline';
import { formatFishingElapsedLabel, getLiveFishingElapsedMs } from '@/src/utils/tripTiming';
import { catalogLocationMarkersInViewport } from '@/src/utils/mapCatalogMarkers';
import { tripMapDefaultCenterCoordinate, tripMapDefaultZoom } from '@/src/utils/mapViewport';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ExpoLocation from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { v4 as uuidv4 } from 'uuid';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type TabKey = 'fish' | 'photos' | 'conditions' | 'ai' | 'map';

export default function TripDashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isConnected } = useNetworkStatus();
  const {
    activeTrip, events, fishCount, currentFly, currentFly2, nextFlyRecommendation,
    weatherData, waterFlowData, conditionsLoading, recommendationLoading,
    addCatch, removeCatch, changeFly, updateFlyChangeEvent, addNote, addBite, addFishOn, addAIQuery, endTrip,
    resumeTrip, isTripPaused,
    fetchConditions, refreshSmartRecommendation, replaceActiveTripEvents,
  } = useTripStore();

  const locations = useLocationStore((s) => s.locations);
  const fetchLocations = useLocationStore((s) => s.fetchLocations);
  const userProxRefForAI = useRef<[number, number] | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>('fish');
  const [elapsed, setElapsed] = useState('0m');
  const [showFlyPicker, setShowFlyPicker] = useState(false);
  const [flyPickerEditEvent, setFlyPickerEditEvent] = useState<TripEvent | null>(null);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState('');

  /** `add` opens new-catch flow; a catch event opens the same details editor for in-trip edits */
  const [catchUIMode, setCatchUIMode] = useState<'add' | TripEvent | null>(null);

  const [tripPhotos, setTripPhotos] = useState<Photo[]>([]);
  const [tripPhotosLoading, setTripPhotosLoading] = useState(false);
  const [tripPhotoUploading, setTripPhotoUploading] = useState(false);
  const [tripPhotoUri, setTripPhotoUri] = useState<string | null>(null);
  const [tripPhotoCaption, setTripPhotoCaption] = useState('');
  const [tripPhotoSpecies, setTripPhotoSpecies] = useState('');
  /** Full-screen photo view (timeline or Photos tab) — same UX as photo library */
  const [fullScreenPhoto, setFullScreenPhoto] = useState<{
    url: string;
    location?: string;
    fly?: string;
    date?: string;
    species?: string;
    caption?: string;
  } | null>(null);

  const [aiMessages, setAiMessages] = useState<{ id: string; role: 'user' | 'ai'; text: string }[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiScrollRef = useRef<ScrollView>(null);

  const [userFlies, setUserFlies] = useState<Fly[]>([]);
  const conditionsFetched = useRef(false);
  const [mapLocation, setMapLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [mapLocationLoading, setMapLocationLoading] = useState(false);
  const [mapLocationError, setMapLocationError] = useState<string | null>(null);
  const [strategyTopFlies, setStrategyTopFlies] = useState<string[]>([]);
  const [strategyBestTime, setStrategyBestTime] = useState<string | null>(null);
  const [strategyHowToFish, setStrategyHowToFish] = useState<string | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);

  /** Fly names for picker: from Fly Box when available, else default list */
  const flyPickerNames = userFlies.length > 0
    ? [...new Set(userFlies.map(f => f.name))].sort()
    : FLY_NAMES;

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
    if (activeTrip && !conditionsFetched.current) {
      conditionsFetched.current = true;
      fetchConditions().then(() => {
        refreshSmartRecommendation();
      });
    }
  }, [activeTrip]);

  useEffect(() => {
    if (!activeTrip?.user_id) return;
    if (isConnected) {
      fetchFlies(activeTrip.user_id).then(setUserFlies).catch(() => setUserFlies([]));
    } else {
      getFliesFromCache(activeTrip.user_id).then(setUserFlies);
    }
  }, [activeTrip?.user_id, isConnected]);

  useEffect(() => {
    if (locations.length === 0) void fetchLocations();
  }, [locations.length, fetchLocations]);

  useEffect(() => {
    (async () => {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      try {
        const loc = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        userProxRefForAI.current = [loc.coords.longitude, loc.coords.latitude];
      } catch {
        userProxRefForAI.current = null;
      }
    })();
  }, []);

  const loadTripPhotos = useCallback(async () => {
    if (!activeTrip?.id || !activeTrip?.user_id) return;
    setTripPhotosLoading(true);
    try {
      const photos = await fetchPhotos(activeTrip.user_id, { tripId: activeTrip.id });
      setTripPhotos(photos);
    } catch {
      setTripPhotos([]);
    } finally {
      setTripPhotosLoading(false);
    }
  }, [activeTrip?.id, activeTrip?.user_id]);

  useEffect(() => {
    if (activeTrip && activeTab === 'photos') loadTripPhotos();
  }, [activeTrip, activeTab, loadTripPhotos]);

  useEffect(() => {
    if (activeTab !== 'ai' || !activeTrip?.location) return;
    const loc = activeTrip.location;
    const conditions = buildConditionsFromWeatherAndFlow(weatherData, waterFlowData, loc.id)
      ?? {
        locationId: loc.id,
        sky: { condition: 'Clear', label: 'Clear', rating: 'good' as const },
        wind: { speed_mph: 0, rating: 'good' as const },
        temperature: { temp_f: 60, rating: 'good' as const },
        water: { clarity: 'unknown' as const, flow_cfs: null, rating: 'fair' as const },
        fetchedAt: new Date().toISOString(),
      };
    let cancelled = false;
    setStrategyLoading(true);
    setStrategyTopFlies([]);
    setStrategyBestTime(null);
    setStrategyHowToFish(null);
    Promise.all([
      getSpotFishingSummary(loc.name, conditions),
      getSpotHowToFish(loc.name, conditions),
    ]).then(([summary, howToFish]) => {
      if (!cancelled) {
        setStrategyTopFlies(summary.topFlies);
        setStrategyBestTime(summary.bestTime);
        setStrategyHowToFish(howToFish);
        setStrategyLoading(false);
      }
    }).catch(() => { if (!cancelled) setStrategyLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, activeTrip?.id, activeTrip?.location?.id, activeTrip?.location?.name, weatherData, waterFlowData]);

  const handlePickTripPhoto = useCallback(async () => {
    if (!activeTrip?.id) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to add trip photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setTripPhotoCaption('');
    setTripPhotoSpecies('');
    setTripPhotoUri(result.assets[0].uri);
  }, [activeTrip?.id]);

  const handleSaveTripPhoto = useCallback(async () => {
    if (!activeTrip?.id || !tripPhotoUri) return;
    setTripPhotoUploading(true);
    try {
      await addPhoto(
        {
          userId: activeTrip.user_id,
          tripId: activeTrip.id,
          uri: tripPhotoUri,
          caption: tripPhotoCaption.trim() || undefined,
          species: tripPhotoSpecies.trim() || undefined,
          fly_pattern: currentFly?.pattern ?? undefined,
          fly_size: currentFly?.size ?? undefined,
          fly_color: currentFly?.color ?? undefined,
          fly_id: currentFly?.fly_id ?? undefined,
          captured_at: new Date().toISOString(),
        },
        { isOnline: isConnected },
      );
      setTripPhotoUri(null);
      await loadTripPhotos();
    } catch (e) {
      if (e instanceof PhotoQueuedOfflineError) {
        Alert.alert('Saved on device', 'Photo will upload when you\'re back online.');
        setTripPhotoUri(null);
      } else {
        Alert.alert('Upload failed', (e as Error).message);
      }
    } finally {
      setTripPhotoUploading(false);
    }
  }, [activeTrip?.id, activeTrip?.user_id, tripPhotoUri, tripPhotoCaption, tripPhotoSpecies, currentFly, loadTripPhotos, isConnected]);

  const handleCancelTripPhoto = useCallback(() => {
    setTripPhotoUri(null);
    setTripPhotoCaption('');
    setTripPhotoSpecies('');
  }, []);

  const handleCatchPhotoPress = useCallback((event: TripEvent) => {
    const data = event.data as CatchData;
    if (!data?.photo_url) return;
    setFullScreenPhoto({
      url: data.photo_url,
      location: activeTrip?.location?.name ?? undefined,
      date: formatTripDate(event.timestamp),
      species: data.species ?? undefined,
      caption: data.note ?? undefined,
    });
  }, [activeTrip?.location?.name]);

  const handleTripPhotoPress = useCallback((photo: Photo) => {
    setFullScreenPhoto({
      url: photo.url,
      location: activeTrip?.location?.name ?? undefined,
      fly: [photo.fly_pattern, photo.fly_size ? `#${photo.fly_size}` : null, photo.fly_color].filter(Boolean).join(' ') || undefined,
      date: (photo.captured_at || photo.created_at) ? formatTripDate(photo.captured_at || photo.created_at!) : undefined,
      species: photo.species ?? undefined,
      caption: photo.caption ?? undefined,
    });
  }, [activeTrip?.location?.name]);

  /** Presentation for current fly: from user fly box or COMMON_FLIES. */
  const getPresentationForCurrentFly = useCallback((): PresentationMethod | null => {
    if (!currentFly?.pattern) return null;
    const match = userFlies.find(
      (f) =>
        f.name === currentFly!.pattern &&
        (f.size ?? null) === (currentFly!.size ?? null) &&
        (f.color ?? null) === (currentFly!.color ?? null)
    );
    const pres = match?.presentation ?? COMMON_FLIES_BY_NAME[currentFly.pattern]?.presentation ?? null;
    if (!pres) return null;
    return pres === 'emerger' ? 'other' : (pres as PresentationMethod);
  }, [currentFly, userFlies]);

  /** Presentation for a fly by name/size/color (e.g. catch modal primary fly). */
  const getPresentationForFly = useCallback(
    (name: string, size: number | null, color: string | null): PresentationMethod | null => {
      if (!name?.trim()) return null;
      const match = userFlies.find(
        (f) =>
          f.name === name.trim() &&
          (f.size ?? null) === (size ?? null) &&
          (f.color ?? null) === (color ?? null)
      );
      const pres = match?.presentation ?? COMMON_FLIES_BY_NAME[name.trim()]?.presentation ?? null;
      if (!pres) return null;
      return pres === 'emerger' ? 'other' : (pres as PresentationMethod);
    },
    [userFlies]
  );

  const handleFishPlus = useCallback(() => {
    if (isTripPaused) return;
    setCatchUIMode('add');
  }, [isTripPaused]);

  const handleEditCatch = useCallback((ev: TripEvent) => {
    if (isTripPaused) return;
    setCatchUIMode(ev);
  }, [isTripPaused]);

  const handleCatchSubmitAdd = useCallback(
    async (payload: CatchDetailsSubmitAdd) => {
      if (!activeTrip?.id || !activeTrip?.user_id) return;
      const { primary, dropper, catchFields, latitude, longitude, photoUri } = payload;
      const flyChanged =
        currentFly?.pattern !== primary.pattern ||
        (currentFly?.size ?? null) !== primary.size ||
        (currentFly?.color ?? null) !== primary.color ||
        (currentFly2?.pattern ?? null) !== (dropper?.pattern ?? null) ||
        (currentFly2?.size ?? null) !== (dropper?.size ?? null) ||
        (currentFly2?.color ?? null) !== (dropper?.color ?? null);
      if (flyChanged) {
        changeFly(primary, dropper ?? null);
      }
      const species = catchFields.species ?? null;
      const photoOptions =
        photoUri
          ? {
              userId: activeTrip.user_id,
              tripId: activeTrip.id,
              uri: photoUri,
              caption: catchFields.note?.trim() || undefined,
              species: species ?? undefined,
              fly_pattern: primary.pattern,
              fly_size: primary.size ?? undefined,
              fly_color: primary.color ?? undefined,
              fly_id: primary.fly_id ?? undefined,
              captured_at: new Date().toISOString(),
            }
          : null;

      let photoUrl: string | null = null;
      if (photoOptions && isConnected) {
        try {
          const photo = await addPhoto(photoOptions, { isOnline: true });
          photoUrl = photo.url;
        } catch (e) {
          Alert.alert('Upload failed', (e as Error).message);
          throw e;
        }
      }

      const eventId = addCatch(
        {
          ...catchFields,
          photo_url: photoUrl ?? undefined,
        },
        latitude,
        longitude,
      );

      if (photoOptions && !photoUrl && eventId) {
        try {
          await savePendingPhoto({
            ...buildPendingFromAddPhotoOptions(photoOptions, 'catch', eventId),
          });
        } catch {
          // non-blocking
        }
      }
    },
    [addCatch, changeFly, activeTrip?.id, activeTrip?.user_id, currentFly, currentFly2, isConnected],
  );

  const handleCatchSubmitEdit = useCallback(
    async (nextEvents: TripEvent[]) => {
      replaceActiveTripEvents(nextEvents);
    },
    [replaceActiveTripEvents],
  );

  const handleEndTrip = () => {
    Alert.alert('End Trip', `End this trip with ${formatFishCount(fishCount)}?`, [
      { text: 'Keep Fishing', style: 'cancel' },
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
          router.replace(`/trip/${id}/survey`);
        },
      },
    ]);
  };

  const handlePauseTrip = () => {
    Alert.alert(
      'Pause trip',
      'The fishing timer stops and you can use Home and other tabs. Resume when you are back on the water.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pause',
          onPress: () => {
            const s = useTripStore.getState();
            if (!s.activeTrip || s.isTripPaused) return;
            void s.pauseTrip();
            router.replace('/home');
          },
        },
      ],
    );
  };

  const handleResumeTrip = async () => {
    await resumeTrip();
  };

  const handleAddNote = () => {
    if (noteText.trim()) {
      addNote(noteText.trim());
      setNoteText('');
      setShowNoteInput(false);
    }
  };

  const openFlyPicker = useCallback(() => {
    setFlyPickerEditEvent(null);
    setShowFlyPicker(true);
  }, []);

  const handleEditFlyChange = useCallback(
    (ev: TripEvent) => {
      if (isTripPaused) return;
      setFlyPickerEditEvent(ev);
      setShowFlyPicker(true);
    },
    [isTripPaused],
  );

  const flyPickerSeeds = useMemo(() => {
    if (flyPickerEditEvent?.event_type === 'fly_change') {
      return splitFlyChangeData(flyPickerEditEvent.data as FlyChangeData);
    }
    return { primary: currentFly, dropper: currentFly2 };
  }, [flyPickerEditEvent, currentFly, currentFly2]);

  const handleFlyPickerConfirm = useCallback(
    (primary: FlyChangeData, dropper: FlyChangeData | null) => {
      if (flyPickerEditEvent) {
        updateFlyChangeEvent(flyPickerEditEvent.id, primary, dropper);
      } else {
        changeFly(primary, dropper);
      }
      setShowFlyPicker(false);
      setFlyPickerEditEvent(null);
    },
    [flyPickerEditEvent, changeFly, updateFlyChangeEvent],
  );

  const closeFlyPicker = useCallback(() => {
    setShowFlyPicker(false);
    setFlyPickerEditEvent(null);
  }, []);

  const handleAskAI = useCallback(async () => {
    const question = aiInput.trim();
    if (!question || aiLoading || isTripPaused) return;

    const userMsg = { id: Date.now().toString(), role: 'user' as const, text: question };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput('');
    setAiLoading(true);

    const now = new Date();
    const primaryStr = currentFly ? `${currentFly.pattern}${currentFly.size ? ` #${currentFly.size}` : ''}${currentFly.color ? ` (${currentFly.color})` : ''}` : null;
    const dropperStr = currentFly2 ? `${currentFly2.pattern}${currentFly2.size ? ` #${currentFly2.size}` : ''}${currentFly2.color ? ` (${currentFly2.color})` : ''}` : null;
    const base = {
      location: activeTrip?.location || null,
      fishingType: activeTrip?.fishing_type || 'fly',
      weather: weatherData,
      waterFlow: waterFlowData,
      currentFly: primaryStr,
      currentFly2: dropperStr,
      fishCount,
      recentEvents: events,
      timeOfDay: getTimeOfDay(now),
      season: getSeason(now),
      userFlies: userFlies.length > 0 ? userFlies : undefined,
    };
    const context = await enrichContextWithLocationCatchData(base, {
      question,
      locations,
      userId: activeTrip?.user_id ?? null,
      userLat: userProxRefForAI.current?.[1] ?? null,
      userLng: userProxRefForAI.current?.[0] ?? null,
      referenceDate: now,
    });
    const response = await askAI(context, question);

    const aiMsg = { id: (Date.now() + 1).toString(), role: 'ai' as const, text: response };
    setAiMessages(prev => [...prev, aiMsg]);
    setAiLoading(false);

    addAIQuery(question, response);

    setTimeout(() => aiScrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [
    aiInput,
    aiLoading,
    isTripPaused,
    activeTrip,
    weatherData,
    waterFlowData,
    currentFly,
    currentFly2,
    fishCount,
    events,
    userFlies,
    locations,
    addAIQuery,
  ]);

  if (!activeTrip) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No active trip</Text>
          <Pressable style={styles.backButton} onPress={() => router.replace('/')}>
            <Text style={styles.backButtonText}>Go Home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <StatusBar style="light" />
      {/* Trip photo details modal: caption, species (trip + fly from context) */}
      <Modal visible={!!tripPhotoUri} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={Keyboard.dismiss}>
          <View style={styles.tripPhotoModal}>
            <Text style={styles.tripPhotoModalTitle}>Photo details</Text>
            <Text style={styles.tripPhotoModalHint}>Trip and current fly will be saved.</Text>
            <Text style={styles.flyFieldLabel}>Caption (optional)</Text>
            <TextInput
              style={styles.tripPhotoModalInput}
              placeholder="Add a caption"
              placeholderTextColor={Colors.textTertiary}
              value={tripPhotoCaption}
              onChangeText={setTripPhotoCaption}
            />
            <Text style={styles.flyFieldLabel}>Species (optional)</Text>
            <TextInput
              style={styles.tripPhotoModalInput}
              placeholder="e.g. Brown Trout"
              placeholderTextColor={Colors.textTertiary}
              value={tripPhotoSpecies}
              onChangeText={setTripPhotoSpecies}
            />
            <View style={styles.tripPhotoModalButtons}>
              <Pressable style={styles.tripPhotoModalCancel} onPress={handleCancelTripPhoto}>
                <Text style={styles.tripPhotoModalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.tripPhotoModalSave, tripPhotoUploading && styles.tripPhotoModalSaveDisabled]}
                onPress={handleSaveTripPhoto}
                disabled={tripPhotoUploading}
              >
                {tripPhotoUploading ? (
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <Text style={styles.tripPhotoModalSaveText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Full-screen photo view — same as photo library: tap thumbnail to open */}
      <Modal
        visible={fullScreenPhoto != null}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => setFullScreenPhoto(null)}
      >
        <View style={[styles.fullScreenPhotoWrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <Pressable
            style={[styles.fullScreenPhotoClose, { top: insets.top + Spacing.sm }]}
            onPress={() => setFullScreenPhoto(null)}
          >
            <MaterialCommunityIcons name="close" size={28} color={Colors.textInverse} />
          </Pressable>
          {fullScreenPhoto && (
            <ScrollView
              style={styles.fullScreenPhotoScroll}
              contentContainerStyle={[styles.fullScreenPhotoScrollContent, { paddingBottom: insets.bottom + Spacing.xl }]}
              showsVerticalScrollIndicator={false}
            >
              <Image
                source={{ uri: fullScreenPhoto.url }}
                style={[styles.fullScreenPhotoImage, { width: Dimensions.get('window').width, height: Math.round(Dimensions.get('window').height * 0.55) }]}
                resizeMode="contain"
              />
              <View style={styles.fullScreenPhotoInfo}>
                {fullScreenPhoto.location ? (
                  <Text style={styles.fullScreenPhotoInfoRow}>
                    <MaterialCommunityIcons name="map-marker" size={16} color={Colors.textInverse} /> {fullScreenPhoto.location}
                  </Text>
                ) : null}
                {fullScreenPhoto.fly ? (
                  <Text style={styles.fullScreenPhotoInfoRow}>
                    <MaterialCommunityIcons name="hook" size={16} color={Colors.textInverse} /> {fullScreenPhoto.fly}
                  </Text>
                ) : null}
                {fullScreenPhoto.date ? (
                  <Text style={styles.fullScreenPhotoInfoRow}>
                    <MaterialIcons name="calendar-today" size={16} color={Colors.textInverse} /> {fullScreenPhoto.date}
                  </Text>
                ) : null}
                {fullScreenPhoto.species ? (
                  <Text style={styles.fullScreenPhotoInfoRow}>
                    <MaterialCommunityIcons name="fish" size={16} color={Colors.textInverse} /> {fullScreenPhoto.species}
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

      {/* Header — extends into top safe area so status bar area is blue */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.md }]}>
        <View>
          <Text style={styles.locationName}>
            {activeTrip.location?.name || 'Fishing Trip'}
          </Text>
          <Text style={[styles.timerText, isTripPaused && styles.timerTextPaused]}>
            {isTripPaused ? `Paused \u00B7 ${elapsed}` : elapsed}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {!isConnected && (
            <View style={styles.offlineBadge}>
              <Text style={styles.offlineBadgeText}>Offline</Text>
            </View>
          )}
          {isTripPaused ? (
            <Pressable style={styles.pauseResumeButton} onPress={handleResumeTrip}>
              <Text style={styles.pauseResumeButtonText}>Resume</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.pauseResumeButton} onPress={handlePauseTrip}>
              <Text style={styles.pauseResumeButtonText}>Pause</Text>
            </Pressable>
          )}
          <Pressable style={styles.endButton} onPress={handleEndTrip}>
            <Text style={styles.endButtonText}>End</Text>
          </Pressable>
        </View>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {([
          { key: 'fish' as TabKey, label: 'Fishing' },
          { key: 'photos' as TabKey, label: 'Photos' },
          { key: 'conditions' as TabKey, label: 'Conditions' },
          { key: 'ai' as TabKey, label: 'AI Guide' },
          { key: 'map' as TabKey, label: 'Map' },
        ]).map((tab) => {
          const color = activeTab === tab.key ? Colors.primary : Colors.textTertiary;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Tab Content */}
      {activeTab === 'fish' && activeTrip && (
        <>
          <FishingTab
            activeTrip={activeTrip}
            replaceActiveTripEvents={replaceActiveTripEvents}
            nextFlyRecommendation={nextFlyRecommendation}
            recommendationLoading={recommendationLoading}
            changeFly={changeFly}
            currentFly={currentFly}
            currentFly2={currentFly2}
            openFlyPicker={openFlyPicker}
            fishCount={fishCount}
            removeCatch={removeCatch}
            onFishPlus={handleFishPlus}
            onEditCatch={handleEditCatch}
            onEditFlyChange={handleEditFlyChange}
            showNoteInput={showNoteInput}
            setShowNoteInput={setShowNoteInput}
            noteText={noteText}
            setNoteText={setNoteText}
            handleAddNote={handleAddNote}
            addBite={addBite}
            addFishOn={addFishOn}
            events={events}
            flyPickerNames={flyPickerNames}
            userFlies={userFlies}
            onCatchPhotoPress={handleCatchPhotoPress}
            tripPaused={isTripPaused}
          />
          <CatchDetailsModal
            visible={catchUIMode != null}
            onClose={() => setCatchUIMode(null)}
            mode={catchUIMode === 'add' || catchUIMode == null ? 'add' : 'edit'}
            trip={activeTrip}
            userId={activeTrip.user_id}
            isConnected={isConnected}
            userFlies={userFlies}
            flyPickerNames={flyPickerNames}
            allEvents={events}
            editingEvent={catchUIMode != null && catchUIMode !== 'add' ? catchUIMode : null}
            seedPrimary={currentFly}
            seedDropper={currentFly2}
            getPresentationForFly={getPresentationForFly}
            onSubmitAdd={handleCatchSubmitAdd}
            onSubmitEdit={handleCatchSubmitEdit}
          />
          <ChangeFlyPickerModal
            visible={showFlyPicker}
            onClose={closeFlyPicker}
            userFlies={userFlies}
            flyPickerNames={flyPickerNames}
            seedKey={flyPickerEditEvent?.id ?? 'rig'}
            initialPrimary={flyPickerSeeds.primary}
            initialDropper={flyPickerSeeds.dropper}
            title={flyPickerEditEvent ? 'Edit fly change' : 'Select Fly'}
            onConfirm={handleFlyPickerConfirm}
          />
        </>
      )}

      {activeTab === 'photos' && (
        <PhotosTab
          tripPhotos={tripPhotos}
          loading={tripPhotosLoading}
          uploading={tripPhotoUploading}
          onAddPhoto={handlePickTripPhoto}
          onPhotoPress={handleTripPhotoPress}
        />
      )}

      {activeTab === 'conditions' && (
        <>
          {!isConnected && (
            <View style={styles.cachedDataBanner}>
              <Text style={styles.cachedDataBannerText}>Offline – using cached data</Text>
            </View>
          )}
          <ConditionsTab
            weatherData={weatherData}
            waterFlowData={waterFlowData}
            conditionsLoading={conditionsLoading}
            onRefresh={fetchConditions}
            location={activeTrip.location}
          />
        </>
      )}

      {activeTab === 'ai' && (
        <>
          {!isConnected && (
            <View style={styles.cachedDataBanner}>
              <Text style={styles.cachedDataBannerText}>Offline – using cached data</Text>
            </View>
          )}
          <AIGuideTab
            strategySlot={
              <>
                <Text style={[styles.strategySectionLabel, styles.strategySectionLabelFirst]}>Best time to fish</Text>
                <View style={styles.strategyCard}>
                  {strategyLoading ? (
                    <ActivityIndicator size="small" color={Colors.primary} style={styles.strategyLoader} />
                  ) : strategyBestTime ? (
                    <Text style={styles.strategyBestTime}>{strategyBestTime}</Text>
                  ) : (
                    <Text style={styles.strategyPlaceholder}>—</Text>
                  )}
                </View>
                <Text style={styles.strategySectionLabel}>Top flies</Text>
                <View style={styles.strategyCard}>
                  {strategyLoading ? (
                    <ActivityIndicator size="small" color={Colors.primary} style={styles.strategyLoader} />
                  ) : strategyTopFlies.length > 0 ? (
                    <View style={styles.strategyFliesColumns}>
                      <View style={styles.strategyFliesColumn}>
                        {strategyTopFlies.map((fly, i) =>
                          i % 2 === 0 ? (
                            <View key={i} style={styles.strategyFlyRow}>
                              <View style={styles.strategyFlyBullet} />
                              <Text style={styles.strategyFlyName} numberOfLines={2}>
                                {fly}
                              </Text>
                            </View>
                          ) : null,
                        )}
                      </View>
                      <View style={styles.strategyFliesColumn}>
                        {strategyTopFlies.map((fly, i) =>
                          i % 2 === 1 ? (
                            <View key={i} style={styles.strategyFlyRow}>
                              <View style={styles.strategyFlyBullet} />
                              <Text style={styles.strategyFlyName} numberOfLines={2}>
                                {fly}
                              </Text>
                            </View>
                          ) : null,
                        )}
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.strategyPlaceholder}>No fly suggestions.</Text>
                  )}
                </View>
                <Text style={styles.strategySectionLabel}>How to fish it</Text>
                <View style={styles.strategyCard}>
                  {strategyLoading ? (
                    <ActivityIndicator size="small" color={Colors.primary} style={styles.strategyLoader} />
                  ) : strategyHowToFish ? (
                    <Text style={styles.strategyHowToFishText}>{strategyHowToFish}</Text>
                  ) : (
                    <Text style={styles.strategyPlaceholder}>—</Text>
                  )}
                </View>
              </>
            }
            messages={aiMessages}
            input={aiInput}
            setInput={setAiInput}
            loading={aiLoading}
            onSend={handleAskAI}
            scrollRef={aiScrollRef}
          />
        </>
      )}

      {activeTab === 'map' && (
        <TripMapTab
          trip={activeTrip}
          events={events}
          userId={activeTrip.user_id}
          isConnected={isConnected}
          mapLocation={mapLocation}
          mapLocationLoading={mapLocationLoading}
          mapLocationError={mapLocationError}
          onSelectCatch={(ev) => setCatchUIMode(ev)}
          onRequestLocation={async () => {
            setMapLocationLoading(true);
            setMapLocationError(null);
            try {
              const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
              if (status !== 'granted') {
                setMapLocationError('Location permission is needed to show your position on the map.');
                setMapLocationLoading(false);
                return;
              }
              const loc = await ExpoLocation.getCurrentPositionAsync({
                accuracy: ExpoLocation.Accuracy.Balanced,
              });
              setMapLocation({
                lat: loc.coords.latitude,
                lon: loc.coords.longitude,
              });
            } catch (e) {
              setMapLocationError('Could not get your location.');
            } finally {
              setMapLocationLoading(false);
            }
          }}
        />
      )}
    </SafeAreaView>
  );
}

/* ─── Fishing Tab ─── */

function FishingTab({
  activeTrip,
  replaceActiveTripEvents,
  nextFlyRecommendation, recommendationLoading, changeFly, currentFly, currentFly2,
  openFlyPicker, fishCount, removeCatch, onFishPlus, onEditCatch, onEditFlyChange,
  showNoteInput, setShowNoteInput, noteText, setNoteText, handleAddNote,
  addBite, addFishOn,
  events,
  flyPickerNames: _flyPickerNames = FLY_NAMES,
  userFlies: _userFlies = [],
  onCatchPhotoPress,
  tripPaused = false,
}: any) {
  const sortedEvents = useMemo(() => sortEventsByTime(events), [events]);
  const [rowActions, setRowActions] = useState<{ event: TripEvent; index: number } | null>(null);
  const [noteModal, setNoteModal] = useState<TripEvent | null>(null);
  const [aiModal, setAiModal] = useState<TripEvent | null>(null);

  const closeRowMenu = useCallback(() => setRowActions(null), []);

  const applyEvents = useCallback(
    (next: TripEvent[]) => {
      replaceActiveTripEvents(next);
    },
    [replaceActiveTripEvents],
  );

  const insertNoteAt = useCallback(
    (index: number, placement: 'above' | 'below') => {
      closeRowMenu();
      const ev = sortedEvents[index];
      if (!ev || !activeTrip) return;
      const prevTs = placement === 'above' ? (index > 0 ? sortedEvents[index - 1].timestamp : null) : ev.timestamp;
      const nextTs =
        placement === 'above' ? ev.timestamp : index < sortedEvents.length - 1 ? sortedEvents[index + 1].timestamp : null;
      const ts =
        placement === 'above'
          ? timestampBetween(prevTs, nextTs, activeTrip)
          : timestampBetween(prevTs, nextTs, activeTrip);

      const newEvent: TripEvent = {
        id: uuidv4(),
        trip_id: activeTrip.id,
        event_type: 'note',
        timestamp: ts,
        data: { text: '' } as NoteData,
        conditions_snapshot: null,
        latitude: null,
        longitude: null,
      };
      const next = upsertEventSorted(events, newEvent);
      applyEvents(next);
      setNoteModal(newEvent);
    },
    [sortedEvents, activeTrip, events, applyEvents, closeRowMenu],
  );

  const insertFishAt = useCallback(
    (index: number, placement: 'above' | 'below') => {
      closeRowMenu();
      const ev = sortedEvents[index];
      if (!ev || !activeTrip) return;
      const prevTs = placement === 'above' ? (index > 0 ? sortedEvents[index - 1].timestamp : null) : ev.timestamp;
      const nextTs =
        placement === 'above' ? ev.timestamp : index < sortedEvents.length - 1 ? sortedEvents[index + 1].timestamp : null;
      const ts =
        placement === 'above'
          ? timestampBetween(prevTs, nextTs, activeTrip)
          : timestampBetween(prevTs, nextTs, activeTrip);

      const activeFly = findActiveFlyEventIdBefore(events, ts);
      const newEvent: TripEvent = {
        id: uuidv4(),
        trip_id: activeTrip.id,
        event_type: 'catch',
        timestamp: ts,
        data: {
          species: null,
          size_inches: null,
          note: null,
          photo_url: null,
          active_fly_event_id: activeFly,
          caught_on_fly: 'primary',
          quantity: 1,
          depth_ft: null,
          presentation_method: null,
          released: null,
          structure: null,
        } as CatchData,
        conditions_snapshot: null,
        latitude: null,
        longitude: null,
      };
      const next = upsertEventSorted(events, newEvent);
      applyEvents(next);
      onEditCatch(newEvent);
    },
    [sortedEvents, activeTrip, events, applyEvents, closeRowMenu, onEditCatch],
  );

  const insertFlyChangeAt = useCallback(
    (index: number, placement: 'above' | 'below') => {
      closeRowMenu();
      const ev = sortedEvents[index];
      if (!ev || !activeTrip) return;
      const prevTs = placement === 'above' ? (index > 0 ? sortedEvents[index - 1].timestamp : null) : ev.timestamp;
      const nextTs =
        placement === 'above' ? ev.timestamp : index < sortedEvents.length - 1 ? sortedEvents[index + 1].timestamp : null;
      const ts =
        placement === 'above'
          ? timestampBetween(prevTs, nextTs, activeTrip)
          : timestampBetween(prevTs, nextTs, activeTrip);

      const newEvent: TripEvent = {
        id: uuidv4(),
        trip_id: activeTrip.id,
        event_type: 'fly_change',
        timestamp: ts,
        data: seedFlyChangeDataForTimestamp(events, ts),
        conditions_snapshot: null,
        latitude: null,
        longitude: null,
      };
      const next = upsertEventSorted(events, newEvent);
      applyEvents(next);
      onEditFlyChange(newEvent);
    },
    [sortedEvents, activeTrip, events, applyEvents, closeRowMenu, onEditFlyChange],
  );

  const confirmDelete = useCallback(
    (event: TripEvent) => {
      closeRowMenu();
      Alert.alert('Remove entry?', 'This removes this row from the trip timeline.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            applyEvents(events.filter((ev: TripEvent) => ev.id !== event.id));
          },
        },
      ]);
    },
    [events, applyEvents, closeRowMenu],
  );

  const rowMenuActions: TripTimelineRowAction[] = useMemo(() => {
    if (!rowActions) return [];
    const { event, index } = rowActions;
    const actions: TripTimelineRowAction[] = [];

    if (event.event_type === 'catch') {
      actions.push({ label: 'Edit fish…', onPress: () => { closeRowMenu(); onEditCatch(event); } });
      actions.push({ label: 'Add note above', onPress: () => void insertNoteAt(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNoteAt(index, 'below') });
      actions.push({ label: 'Add fish above', onPress: () => void insertFishAt(index, 'above') });
      actions.push({ label: 'Add fish below', onPress: () => void insertFishAt(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChangeAt(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChangeAt(index, 'below') });
    } else if (event.event_type === 'note') {
      actions.push({ label: 'Edit note…', onPress: () => { closeRowMenu(); setNoteModal(event); } });
      actions.push({ label: 'Add note above', onPress: () => void insertNoteAt(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNoteAt(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChangeAt(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChangeAt(index, 'below') });
    } else if (event.event_type === 'fly_change') {
      actions.push({ label: 'Edit fly change…', onPress: () => { closeRowMenu(); onEditFlyChange(event); } });
      actions.push({ label: 'Add note above', onPress: () => void insertNoteAt(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNoteAt(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChangeAt(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChangeAt(index, 'below') });
    } else if (event.event_type === 'ai_query') {
      actions.push({ label: 'Edit AI entry…', onPress: () => { closeRowMenu(); setAiModal(event); } });
      actions.push({ label: 'Add note above', onPress: () => void insertNoteAt(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNoteAt(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChangeAt(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChangeAt(index, 'below') });
    } else {
      actions.push({ label: 'Add note above', onPress: () => void insertNoteAt(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNoteAt(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChangeAt(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChangeAt(index, 'below') });
    }

    actions.push({ label: 'Delete', destructive: true, onPress: () => confirmDelete(event) });
    return actions;
  }, [
    rowActions,
    closeRowMenu,
    onEditCatch,
    onEditFlyChange,
    insertNoteAt,
    insertFishAt,
    insertFlyChangeAt,
    confirmDelete,
  ]);

  return (
    <View style={{ flex: 1 }}>
      {tripPaused ? (
        <View style={styles.fishingPausedNotice}>
          <MaterialCommunityIcons name="pause-circle-outline" size={22} color={Colors.textSecondary} />
          <Text style={styles.fishingPausedNoticeText}>
            Trip is paused. Tap Resume in the header to log catches, flies, and notes.
          </Text>
        </View>
      ) : null}
      <View
        style={{ flex: 1, opacity: tripPaused ? 0.38 : 1 }}
        pointerEvents={tripPaused ? 'none' : 'auto'}
      >
      {/* Next Fly Recommendation */}
      {nextFlyRecommendation && (
        <Pressable
          style={styles.nextFlyBanner}
          onPress={() => {
            const primary = {
              pattern: nextFlyRecommendation.pattern,
              size: nextFlyRecommendation.size,
              color: nextFlyRecommendation.color,
              fly_id: nextFlyRecommendation.fly_id ?? undefined,
              fly_color_id: nextFlyRecommendation.fly_color_id ?? undefined,
              fly_size_id: nextFlyRecommendation.fly_size_id ?? undefined,
            };
            const dropper =
              nextFlyRecommendation.pattern2 != null && nextFlyRecommendation.pattern2.trim()
                ? {
                    pattern: nextFlyRecommendation.pattern2,
                    size: nextFlyRecommendation.size2 ?? null,
                    color: nextFlyRecommendation.color2 ?? null,
                    fly_id: nextFlyRecommendation.fly_id2 ?? undefined,
                    fly_color_id: nextFlyRecommendation.fly_color_id2 ?? undefined,
                    fly_size_id: nextFlyRecommendation.fly_size_id2 ?? undefined,
                  }
                : null;
            changeFly(primary, dropper);
          }}
        >
          <View style={styles.nextFlyLeft}>
            <Text style={styles.nextFlyLabel}>
              {recommendationLoading ? 'AI Thinking...' : 'Try Next'}
            </Text>
            <Text style={styles.nextFlyName}>
              {nextFlyRecommendation.pattern2
                ? `${nextFlyRecommendation.pattern} #${nextFlyRecommendation.size} / ${nextFlyRecommendation.pattern2} #${nextFlyRecommendation.size2 ?? ''}`
                : `${nextFlyRecommendation.pattern} #${nextFlyRecommendation.size}`}
            </Text>
            {nextFlyRecommendation.reason ? (
              <Text style={styles.nextFlyReason} numberOfLines={2}>
                {nextFlyRecommendation.reason}
              </Text>
            ) : null}
          </View>
          <Text style={styles.nextFlyTap}>Tap to switch</Text>
        </Pressable>
      )}

      {/* Current Fly (primary + optional dropper) */}
      <Pressable style={styles.currentFlyBar} onPress={openFlyPicker}>
        <Text style={styles.currentFlyLabel}>{currentFly2 ? 'Current rig' : 'Current Fly'}</Text>
        <Text style={styles.currentFlyName}>
          {currentFly
            ? currentFly2
              ? `${currentFly.pattern}${currentFly.size ? ` #${currentFly.size}` : ''} / ${currentFly2.pattern}${currentFly2.size ? ` #${currentFly2.size}` : ''}`
              : `${currentFly.pattern}${currentFly.size ? ` #${currentFly.size}` : ''}`
            : 'Tap to select'}
        </Text>
      </Pressable>

      {/* Fish Counter */}
      <View style={styles.fishCounterSection}>
        <Pressable style={styles.fishMinusButton} onPress={removeCatch}>
          <Text style={styles.fishButtonText}>−</Text>
        </Pressable>
        <View style={styles.fishCountDisplay}>
          <Text style={styles.fishCountNumber}>{fishCount}</Text>
          <Text style={styles.fishCountLabel}>fish</Text>
        </View>
        <Pressable style={styles.fishPlusButton} onPress={onFishPlus}>
          <Text style={styles.fishPlusButtonText}>+</Text>
        </Pressable>
      </View>

      {/* Quick log: Bite / Fish On */}
      <View style={[styles.actionRow, styles.actionRowTight]}>
        <Pressable style={styles.actionButton} onPress={() => addBite?.()}>
          <MaterialCommunityIcons name="fish" size={20} color={Colors.accent} />
          <Text style={styles.actionLabel}>Bite</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => addFishOn?.()}>
          <MaterialIcons name="highlight-off" size={20} color={Colors.textSecondary} />
          <Text style={styles.actionLabel}>Fish On</Text>
        </Pressable>
      </View>
      {/* Change Fly / Add Note */}
      <View style={styles.actionRow}>
        <Pressable style={styles.actionButton} onPress={openFlyPicker}>
          <MaterialCommunityIcons name="hook" size={20} color={Colors.accent} />
          <Text style={styles.actionLabel}>Change Fly</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => setShowNoteInput(!showNoteInput)}>
          <MaterialIcons name="edit-note" size={20} color={Colors.textSecondary} />
          <Text style={styles.actionLabel}>Add Note</Text>
        </Pressable>
      </View>

      {/* Note Input */}
      {showNoteInput && (
        <View style={styles.noteInputRow}>
          <TextInput
            style={styles.noteInput}
            placeholder="Write a note..."
            placeholderTextColor={Colors.textTertiary}
            value={noteText}
            onChangeText={setNoteText}
            onSubmitEditing={handleAddNote}
            returnKeyType="done"
            autoFocus
          />
          <Pressable style={styles.noteSubmit} onPress={handleAddNote}>
            <Text style={styles.noteSubmitText}>Add</Text>
          </Pressable>
        </View>
      )}

      {/* Event Timeline */}
      <ScrollView style={[styles.timeline, { zIndex: 0 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.timelineTitle}>Timeline</Text>
        <Text style={styles.timelineEditHint}>
          Tap ⋮ on a row to edit, add notes, fish, or fly changes above/below, or delete.
        </Text>
        {[...sortedEvents].reverse().map((event: TripEvent, revIdx: number) => {
          const index = sortedEvents.length - 1 - revIdx;
          return (
            <View key={event.id} style={styles.timelineItem}>
              <Text style={styles.timelineTime}>{formatEventTime(event.timestamp)}</Text>
              <View style={styles.timelineContent}>
                <View style={styles.timelineDot}>
                  {event.event_type === 'catch' ? (
                    <MaterialCommunityIcons name="fish" size={14} color={Colors.primary} />
                  ) : event.event_type === 'fly_change' ? (
                    <MaterialCommunityIcons name="hook" size={14} color={Colors.accent} />
                  ) : event.event_type === 'ai_query' ? (
                    <MaterialIcons name="smart-toy" size={14} color={Colors.info} />
                  ) : event.event_type === 'bite' ? (
                    <MaterialCommunityIcons name="fish" size={14} color={Colors.accent} />
                  ) : event.event_type === 'fish_on' ? (
                    <MaterialIcons name="touch-app" size={14} color={Colors.primary} />
                  ) : event.event_type === 'got_off' ? (
                    <MaterialIcons name="highlight-off" size={14} color={Colors.textSecondary} />
                  ) : (
                    <MaterialIcons name="edit-note" size={14} color={Colors.textSecondary} />
                  )}
                </View>
                <View style={styles.timelineTextBlock}>
                  <Text style={styles.timelineText}>
                    {getEventDescription(event)}
                  </Text>
                  {event.event_type === 'catch' ? (
                    <CatchDetailsBlock data={event.data as CatchData} />
                  ) : null}
                  {event.event_type === 'catch' && (event.data as CatchData).photo_url ? (
                    <Pressable onPress={() => onCatchPhotoPress?.(event)}>
                      <Image
                        source={{ uri: (event.data as CatchData).photo_url! }}
                        style={styles.timelineCatchThumb}
                      />
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  style={styles.timelineRowMenuBtn}
                  onPress={() => setRowActions({ event, index })}
                  hitSlop={12}
                  accessibilityLabel="Timeline row actions"
                >
                  <MaterialIcons name="more-vert" size={22} color={Colors.textSecondary} />
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={rowActions != null} transparent animationType="fade" onRequestClose={closeRowMenu}>
        <View style={styles.tripTimelineActionOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeRowMenu} />
          <View style={styles.tripTimelineActionSheet}>
            {rowMenuActions.map((a) => (
              <Pressable
                key={a.label}
                style={styles.tripTimelineActionRow}
                onPress={() => {
                  a.onPress();
                }}
              >
                <Text style={[styles.tripTimelineActionLabel, a.destructive && styles.tripTimelineActionDestructive]}>
                  {a.label}
                </Text>
              </Pressable>
            ))}
            <Pressable style={styles.tripTimelineActionRow} onPress={closeRowMenu}>
              <Text style={styles.tripTimelineActionCancel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <TripTimelineNoteModal
        visible={noteModal != null}
        event={noteModal}
        allEvents={events}
        onClose={() => setNoteModal(null)}
        onApply={applyEvents}
      />
      <TripTimelineAiModal
        visible={aiModal != null}
        event={aiModal}
        allEvents={events}
        onClose={() => setAiModal(null)}
        onApply={applyEvents}
      />
      </View>
    </View>
  );
}

/* ─── Photos Tab ─── */

const PHOTO_SIZE = (Dimensions.get('window').width - Spacing.lg * 2 - Spacing.sm * 2) / 3;

function PhotosTab({
  tripPhotos,
  loading,
  uploading,
  onAddPhoto,
  onPhotoPress,
}: {
  tripPhotos: Photo[];
  loading: boolean;
  uploading: boolean;
  onAddPhoto: () => void;
  onPhotoPress?: (photo: Photo) => void;
}) {
  return (
    <ScrollView style={styles.photosTabScroll} contentContainerStyle={styles.photosTabContent}>
      <View style={styles.photosTabHeader}>
        <Text style={styles.photosTabTitle}>Trip photos</Text>
        <Pressable style={styles.addTripPhotoButton} onPress={onAddPhoto} disabled={uploading}>
          {uploading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <>
              <MaterialIcons name="add-a-photo" size={18} color={Colors.primary} />
              <Text style={styles.addTripPhotoButtonText}>Add</Text>
            </>
          )}
        </Pressable>
      </View>
      {loading ? (
        <View style={styles.photosTabPlaceholder}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : tripPhotos.length === 0 ? (
        <Pressable style={styles.photosTabEmpty} onPress={onAddPhoto}>
          <MaterialIcons name="photo-library" size={48} color={Colors.textTertiary} />
          <Text style={styles.photosTabEmptyText}>No photos yet</Text>
          <Text style={styles.photosTabEmptyHint}>Add photos from this trip</Text>
        </Pressable>
      ) : (
        <View style={styles.photosTabGrid}>
          {tripPhotos.map((photo) => (
            <Pressable key={photo.id} onPress={() => onPhotoPress?.(photo)}>
              <Image source={{ uri: photo.url }} style={styles.tripPhotoThumb} />
            </Pressable>
          ))}
          <Pressable style={styles.tripPhotoAddSlot} onPress={onAddPhoto} disabled={uploading}>
            <MaterialIcons name="add" size={32} color={Colors.primary} />
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

/* ─── Map Tab (Mapbox: terrain + pins) ─── */

type TripMapMarker = {
  id: string;
  lon: number;
  lat: number;
  title: string;
  color: string;
  endpointLabel?: 'Start' | 'End';
  endpointIcon?: 'place' | 'flag';
  catchEventId?: string;
  catchPhotoUrl?: string | null;
};

function buildTripMapMarkers(trip: Trip, tripEvents: TripEvent[]): TripMapMarker[] {
  const markers: TripMapMarker[] = [];

  const startLat = trip.start_latitude ?? null;
  const startLon = trip.start_longitude ?? null;
  if (startLat != null && startLon != null) {
    markers.push({
      id: 'trip-start',
      lon: startLon,
      lat: startLat,
      title: 'Start',
      color: Colors.primary,
      endpointLabel: 'Start',
      endpointIcon: 'place',
    });
  }

  const endLat = trip.end_latitude ?? null;
  const endLon = trip.end_longitude ?? null;
  if (endLat != null && endLon != null) {
    markers.push({
      id: 'trip-end',
      lon: endLon,
      lat: endLat,
      title: 'End',
      color: Colors.secondary,
      endpointLabel: 'End',
      endpointIcon: 'flag',
    });
  }

  for (const e of tripEvents) {
    if (e.event_type !== 'catch') continue;
    if (e.latitude == null || e.longitude == null) continue;
    const catchData = e.data as CatchData;
    const speciesLabel = catchData.species?.trim();
    markers.push({
      id: `catch-${e.id}`,
      lon: e.longitude,
      lat: e.latitude,
      title: speciesLabel ? `Catch · ${speciesLabel}` : 'Catch',
      color: Colors.primaryLight,
      catchEventId: e.id,
      catchPhotoUrl: catchData.photo_url ?? null,
    });
  }

  return markers;
}

function TripMapTab({
  trip,
  events: tripEvents,
  userId,
  isConnected,
  mapLocation,
  mapLocationLoading: _mapLocationLoading,
  mapLocationError,
  onRequestLocation,
  onSelectCatch,
}: {
  trip: Trip;
  events: TripEvent[];
  userId: string;
  isConnected: boolean;
  mapLocation: { lat: number; lon: number } | null;
  mapLocationLoading: boolean;
  mapLocationError: string | null;
  onRequestLocation: () => Promise<void>;
  onSelectCatch: (event: TripEvent) => void;
}) {
  const addCatch = useTripStore((s) => s.addCatch);
  const locations = useLocationStore((s) => s.locations);
  const fetchLocations = useLocationStore((s) => s.fetchLocations);
  const mapRef = useRef<TripMapboxMapRef>(null);
  const [centerCoordinate, setCenterCoordinate] = useState<[number, number]>(() =>
    tripMapDefaultCenterCoordinate(trip),
  );
  const [zoomLevel, setZoomLevel] = useState(() => tripMapDefaultZoom(trip));
  const [cameraKey, setCameraKey] = useState(0);
  /** Viewport for pins / queries: always from native map ref (see syncDataViewportFromMap). */
  const [dataViewport, setDataViewport] = useState<BoundingBox | null>(null);
  const [cachedPins, setCachedPins] = useState<CachedCatchPin[]>([]);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const viewportDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void getCachedCatchPins().then(setCachedPins);
  }, []);

  useEffect(() => {
    if (locations.length === 0) void fetchLocations();
  }, [locations.length, fetchLocations]);

  useEffect(
    () => () => {
      if (viewportDebounceRef.current) clearTimeout(viewportDebounceRef.current);
    },
    [],
  );

  useEffect(() => {
    void onRequestLocation();
  }, [onRequestLocation]);

  useEffect(() => {
    setCenterCoordinate(tripMapDefaultCenterCoordinate(trip));
    setZoomLevel(tripMapDefaultZoom(trip));
    setCameraKey((k) => k + 1);
  }, [
    trip.id,
    trip.start_latitude,
    trip.start_longitude,
    trip.location?.latitude,
    trip.location?.longitude,
  ]);

  const tripCatchIds = useMemo(
    () =>
      new Set(
        tripEvents
          .filter((e) => e.event_type === 'catch' && e.latitude != null && e.longitude != null)
          .map((e) => e.id),
      ),
    [tripEvents],
  );

  const cacheMarkersForViewport = useMemo((): TripMapMarker[] => {
    if (!dataViewport) return [];
    return cachedPins
      .filter((c) => isPointInBoundingBox(c.latitude, c.longitude, dataViewport))
      .filter((c) => !tripCatchIds.has(c.id))
      .map((c) => ({
        id: `catch-cache-${c.id}`,
        lon: c.longitude,
        lat: c.latitude,
        title: c.species?.trim() ? `Catch · ${c.species.trim()}` : 'Saved catch',
        color: Colors.secondary,
        catchEventId: c.id,
        catchPhotoUrl: null as string | null,
      }));
  }, [cachedPins, dataViewport, tripCatchIds]);

  const catalogMarkersForViewport = useMemo(
    () =>
      catalogLocationMarkersInViewport(locations, dataViewport, trip.location_id ?? undefined),
    [locations, dataViewport, trip.location_id],
  );

  const allMarkers = useMemo(() => {
    const tripMarkers = buildTripMapMarkers(trip, tripEvents);
    return [...catalogMarkersForViewport, ...tripMarkers, ...cacheMarkersForViewport];
  }, [trip, tripEvents, catalogMarkersForViewport, cacheMarkersForViewport]);

  const markersForMap = useMemo(() => {
    if (!dataViewport) {
      return allMarkers;
    }
    return allMarkers.filter((m) => isPointInBoundingBox(m.lat, m.lon, dataViewport));
  }, [allMarkers, dataViewport]);

  const mapboxMarkers = useMemo(
    () =>
      markersForMap.map((m) => {
        if (m.catchEventId != null) {
          return {
            id: m.id,
            coordinate: [m.lon, m.lat] as [number, number],
            title: m.title,
            catchPhotoUrl: m.catchPhotoUrl ?? null,
            onPress: () => {
              const ev = tripEvents.find((e) => e.id === m.catchEventId);
              if (ev) onSelectCatch(ev);
            },
          };
        }
        return {
          id: m.id,
          coordinate: [m.lon, m.lat] as [number, number],
          title: m.title,
          children:
            m.endpointLabel != null ? (
              <LabeledEndpointMapPin
                label={m.endpointLabel}
                backgroundColor={m.color}
                icon={m.endpointIcon ?? 'place'}
              />
            ) : (
              <MaterialIcons name="place" size={34} color={m.color} />
            ),
        };
      }),
    [markersForMap, tripEvents, onSelectCatch],
  );

  const syncDataViewportFromMap = useCallback(() => {
    if (viewportDebounceRef.current) clearTimeout(viewportDebounceRef.current);
    viewportDebounceRef.current = setTimeout(() => {
      void (async () => {
        const bbox = await mapRef.current?.getVisibleRegion();
        if (!bbox) return;
        setDataViewport(bbox);
        if (userId && isConnected) {
          const rows = await fetchCatchesInBounds(userId, bbox);
          await mergeCachedCatchesFromRows(rows);
        }
        setCachedPins(await getCachedCatchPins());
      })();
    }, 400);
  }, [userId, isConnected]);

  const handleAddFish = useCallback(async () => {
    try {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location', 'Permission is needed to tag a catch with GPS.');
        return;
      }
      const loc = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Lowest,
      });
      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;
      const clientEventId = uuidv4();
      const id = addCatch({}, lat, lng, clientEventId);
      if (!id) {
        Alert.alert('Trip', 'No active trip to log a catch.');
        return;
      }
      const { activeTrip: at, events: ev } = useTripStore.getState();
      const catchEvent = ev.find((e) => e.id === id && e.event_type === 'catch');
      if (at && catchEvent) {
        const refreshPins = () => void getCachedCatchPins().then(setCachedPins);
        if (isConnected) {
          void upsertCatchEventToCloud(at, catchEvent, ev).then(async (ok) => {
            if (ok) {
              const pin = cachedPinFromCatchEvent(catchEvent);
              if (pin) await mergeCachedPins([pin]);
              await removePendingCatchByEventId(id);
            } else {
              await enqueuePendingCatch({ trip: at, event: catchEvent, allEvents: ev });
            }
            refreshPins();
          });
        } else {
          void enqueuePendingCatch({ trip: at, event: catchEvent, allEvents: ev }).then(refreshPins);
        }
      }
      setCenterCoordinate([lng, lat]);
      setZoomLevel(USER_LOCATION_ZOOM);
      setCameraKey((k) => k + 1);
    } catch {
      Alert.alert('Location', 'Could not read GPS for this catch.');
    }
  }, [addCatch, isConnected]);

  const handleDownloadOffline = useCallback(async () => {
    setOfflineBusy(true);
    try {
      await downloadSampleOfflineRegion();
      if (userId) {
        await prefetchCatchesForBounds(userId, SAMPLE_OFFLINE_BOUNDING_BOX);
        setCachedPins(await getCachedCatchPins());
      }
      Alert.alert('Offline', 'Sample Utah Valley map region download completed.');
    } catch (e) {
      Alert.alert('Offline', (e as Error).message);
    } finally {
      setOfflineBusy(false);
    }
  }, [userId]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.mapTabPlaceholder}>
        <MaterialIcons name="map" size={48} color={Colors.textTertiary} />
        <Text style={styles.mapTabPlaceholderText}>Map is available in the iOS and Android app.</Text>
      </View>
    );
  }

  return (
    <View style={styles.mapTabContainer}>
      {mapLocationError ? (
        <View style={styles.mapTabBanner}>
          <MaterialIcons name="location-off" size={18} color={Colors.warning} />
          <Text style={styles.mapTabBannerText} numberOfLines={2}>
            {mapLocationError}
          </Text>
          <Pressable onPress={() => void onRequestLocation()} hitSlop={8}>
            <Text style={styles.mapTabBannerRetry}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      <TripMapboxMapView
        ref={mapRef}
        containerStyle={styles.mapTabMap}
        centerCoordinate={centerCoordinate}
        zoomLevel={zoomLevel}
        cameraKey={String(cameraKey)}
        markers={mapboxMarkers}
        showUserLocation={mapLocation != null}
        onZoomLevelChange={setZoomLevel}
        onMapIdle={() => {
          void syncDataViewportFromMap();
        }}
      />
      <View style={styles.mapTabFabColumn} pointerEvents="box-none">
        <Pressable
          style={({ pressed }) => [styles.mapTabFishFab, pressed && styles.mapTabFabPressed]}
          onPress={() => void handleAddFish()}
        >
          <MaterialIcons name="add" size={26} color={Colors.textInverse} />
          <Text style={styles.mapTabFishFabLabel}>Fish</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.mapTabOfflineFab,
            offlineBusy && styles.mapTabFabDisabled,
            pressed && !offlineBusy && styles.mapTabFabPressed,
          ]}
          onPress={() => void handleDownloadOffline()}
          disabled={offlineBusy}
        >
          <MaterialIcons name="download" size={22} color={Colors.textInverse} />
          <Text style={styles.mapTabOfflineFabLabel}>{offlineBusy ? '…' : 'Area'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ─── AI Guide Tab ─── */

function AIGuideTab({
  messages, input, setInput, loading, onSend, scrollRef,
  strategySlot,
}: any) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={180}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.aiScrollView}
        contentContainerStyle={styles.aiScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Strategy (Best time, Top flies, How to fish it) */}
        {strategySlot}

        <Text style={styles.aiContextNote}>
          AI uses your trip history, current conditions, and fishing data to give personalized advice.
        </Text>

        {/* Chat Messages */}
        {messages.map((msg: any) => (
          <View
            key={msg.id}
            style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble]}
          >
            <Text style={[styles.bubbleText, msg.role === 'user' ? styles.userBubbleText : styles.aiBubbleText]}>
              {msg.text}
            </Text>
          </View>
        ))}

        {loading && (
          <View style={[styles.bubble, styles.aiBubble]}>
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: 8 }} />
            <Text style={styles.aiBubbleText}>Thinking...</Text>
          </View>
        )}
      </ScrollView>

      {/* Input */}
      <View style={styles.aiInputRow}>
        <TextInput
          style={styles.aiInput}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about this trip..."
          placeholderTextColor={Colors.textTertiary}
          returnKeyType="send"
          onSubmitEditing={onSend}
        />
        <Pressable
          style={[styles.aiSendButton, (!input.trim() || loading) && styles.aiSendButtonDisabled]}
          onPress={onSend}
          disabled={!input.trim() || loading}
        >
          <Text style={styles.aiSendButtonText}>Ask</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ─── Helpers ─── */

function formatLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function CatchDetailsBlock({ data }: { data: CatchData }) {
  const lines: string[] = [];
  if (data.note?.trim()) lines.push(data.note.trim());
  if (data.depth_ft != null) lines.push(`Depth: ${data.depth_ft} ft`);
  if (data.structure) lines.push(`Structure: ${formatLabel(data.structure)}`);
  if (data.presentation_method) lines.push(`Presentation: ${formatLabel(data.presentation_method)}`);
  if (data.released != null) lines.push(`Released: ${data.released ? 'Yes' : 'No'}`);
  if (lines.length === 0) return null;
  return (
    <View style={styles.timelineCatchDetails}>
      {lines.map((line, i) => (
        <Text key={i} style={styles.timelineCatchDetailLine}>{line}</Text>
      ))}
    </View>
  );
}

function getEventDescription(event: TripEvent): string {
  switch (event.event_type) {
    case 'catch': {
      const data = event.data as CatchData;
      const parts: string[] = [];
      if (data.species) parts.push(data.species);
      if (data.size_inches != null) parts.push(`${data.size_inches}"`);
      const qty = data.quantity != null && data.quantity > 1 ? data.quantity : 1;
      const main = parts.length ? `Caught ${parts.join(' · ')}${qty > 1 ? ` (×${qty})` : ''}` : (qty > 1 ? `${qty} fish caught!` : 'Fish caught!');
      return main;
    }
    case 'fly_change': {
      const data = event.data as FlyChangeData;
      const primary = `${data.pattern}${data.size ? ` #${data.size}` : ''}`;
      return data.pattern2
        ? `Changed to ${primary} / ${data.pattern2}${data.size2 ? ` #${data.size2}` : ''}`
        : `Changed to ${primary}`;
    }
    case 'note': {
      const data = event.data as NoteData;
      return data.text;
    }
    case 'ai_query': {
      const data = event.data as AIQueryData;
      return `Asked AI: ${data.question}`;
    }
    case 'bite':
      return 'Bite';
    case 'fish_on':
      return 'Fish On';
    case 'got_off':
      return 'Got off';
    default:
      return 'Event';
  }
}

type TripTimelineRowAction = { label: string; destructive?: boolean; onPress: () => void };

function seedFlyChangeDataForTimestamp(allEvents: TripEvent[], timestampIso: string): FlyChangeData {
  const priorId = findActiveFlyEventIdBefore(allEvents, timestampIso);
  if (!priorId) return { pattern: 'Unknown', size: null, color: null };
  const prior = allEvents.find((e) => e.id === priorId && e.event_type === 'fly_change');
  if (!prior) return { pattern: 'Unknown', size: null, color: null };
  const d = prior.data as FlyChangeData;
  return {
    pattern: d.pattern,
    size: d.size,
    color: d.color,
    fly_id: d.fly_id,
    fly_color_id: d.fly_color_id,
    fly_size_id: d.fly_size_id,
    ...(d.pattern2 != null && String(d.pattern2).trim()
      ? {
          pattern2: d.pattern2,
          size2: d.size2 ?? null,
          color2: d.color2 ?? null,
          fly_id2: d.fly_id2,
          fly_color_id2: d.fly_color_id2,
          fly_size_id2: d.fly_size_id2,
        }
      : {}),
  };
}

function TripTimelineNoteModal({
  visible,
  event,
  allEvents,
  onClose,
  onApply,
}: {
  visible: boolean;
  event: TripEvent | null;
  allEvents: TripEvent[];
  onClose: () => void;
  onApply: (nextEvents: TripEvent[]) => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (event) setText((event.data as NoteData).text ?? '');
  }, [event?.id]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.tripTimelineModalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.tripTimelineModalHeader}>
          <Pressable onPress={onClose}>
            <Text style={styles.tripTimelineModalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.tripTimelineModalTitle}>Note</Text>
          <Pressable
            onPress={() => {
              if (!event) return;
              const next: TripEvent = {
                ...event,
                data: { text: text.trim() || 'Note' } as NoteData,
              };
              onApply(upsertEventSorted(allEvents, next));
              onClose();
            }}
          >
            <Text style={styles.tripTimelineModalSave}>Save</Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.tripTimelineNoteBody}
          value={text}
          onChangeText={setText}
          placeholder="Write a note…"
          placeholderTextColor={Colors.textTertiary}
          multiline
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TripTimelineAiModal({
  visible,
  event,
  allEvents,
  onClose,
  onApply,
}: {
  visible: boolean;
  event: TripEvent | null;
  allEvents: TripEvent[];
  onClose: () => void;
  onApply: (nextEvents: TripEvent[]) => void;
}) {
  const [q, setQ] = useState('');
  const [r, setR] = useState('');
  useEffect(() => {
    if (!event) return;
    const d = event.data as AIQueryData;
    setQ(d.question ?? '');
    setR(d.response ?? '');
  }, [event?.id]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.tripTimelineModalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.tripTimelineModalHeader}>
          <Pressable onPress={onClose}>
            <Text style={styles.tripTimelineModalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.tripTimelineModalTitle}>AI entry</Text>
          <Pressable
            onPress={() => {
              if (!event) return;
              const next: TripEvent = {
                ...event,
                data: { question: q.trim() || 'Question', response: r.trim() || null } as AIQueryData,
              };
              onApply(upsertEventSorted(allEvents, next));
              onClose();
            }}
          >
            <Text style={styles.tripTimelineModalSave}>Save</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.tripTimelineModalScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.tripTimelineFieldLabel}>Question</Text>
          <TextInput style={styles.tripTimelineInput} value={q} onChangeText={setQ} multiline />
          <Text style={styles.tripTimelineFieldLabel}>Response</Text>
          <TextInput
            style={[styles.tripTimelineInput, styles.tripTimelineTallInput]}
            value={r}
            onChangeText={setR}
            multiline
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: FontSize.lg,
    color: Colors.textSecondary,
  },
  backButton: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  backButtonText: {
    color: Colors.textInverse,
    fontWeight: '600',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.primary,
  },
  locationName: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textInverse,
  },
  timerText: {
    fontSize: FontSize.md,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  timerTextPaused: {
    color: 'rgba(255,255,255,0.95)',
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  offlineBadge: {
    backgroundColor: Colors.warning,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  offlineBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.text,
  },
  cachedDataBanner: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.warning + '18',
  },
  cachedDataBannerText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  pauseResumeButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  pauseResumeButtonText: {
    color: Colors.textInverse,
    fontWeight: '600',
    fontSize: FontSize.sm,
  },
  endButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  endButtonText: {
    color: Colors.textInverse,
    fontWeight: '600',
    fontSize: FontSize.md,
  },

  // Tab Bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
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
    borderBottomColor: Colors.primary,
  },
  // tabIcon intentionally removed — using Material Icons
  tabLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textTertiary,
  },
  tabLabelActive: {
    color: Colors.primary,
  },
  tabScroll: {
    flex: 1,
  },
  strategyTabContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  strategySectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  strategySectionLabelFirst: {
    marginTop: 0,
  },
  strategyCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  strategyLoader: {
    marginVertical: Spacing.xs,
  },
  strategyBestTime: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  strategyPlaceholder: {
    fontSize: FontSize.md,
    color: Colors.textTertiary,
    fontStyle: 'italic',
  },
  strategyFliesColumns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  strategyFliesColumn: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  strategyFlyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 2,
  },
  strategyFlyBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.secondary,
  },
  strategyFlyName: {
    fontSize: FontSize.md,
    color: Colors.text,
    flex: 1,
  },
  strategyHowToFishText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 24,
  },

  // Photos Tab
  photosTabScroll: {
    flex: 1,
  },
  photosTabContent: {
    padding: Spacing.lg,
  },
  photosTabHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  photosTabTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  addTripPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  addTripPhotoButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
  },
  photosTabPlaceholder: {
    minHeight: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photosTabEmpty: {
    minHeight: 200,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photosTabEmptyText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
  photosTabEmptyHint: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  photosTabGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  tripPhotoThumb: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.borderLight,
  },
  tripPhotoAddSlot: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Fishing Tab
  fishingPausedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.borderLight,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  fishingPausedNoticeText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  nextFlyBanner: {
    backgroundColor: Colors.accent,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  nextFlyLeft: {
    flex: 1,
  },
  nextFlyLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textInverse,
    textTransform: 'uppercase',
  },
  nextFlyName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textInverse,
  },
  nextFlyReason: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  nextFlyTap: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.7)',
  },
  currentFlyBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    zIndex: 1,
    elevation: 1,
  },
  currentFlyLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  currentFlyName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  fishCounterSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.xl,
  },
  fishMinusButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
  },
  fishPlusButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fishButtonText: {
    fontSize: 32,
    fontWeight: '300',
    color: Colors.text,
  },
  fishPlusButtonText: {
    fontSize: 32,
    fontWeight: '300',
    color: Colors.textInverse,
  },
  fishCountDisplay: {
    alignItems: 'center',
    minWidth: 80,
  },
  fishCountNumber: {
    fontSize: FontSize.hero,
    fontWeight: '700',
    color: Colors.primary,
  },
  fishCountLabel: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  actionRowTight: {
    marginBottom: Spacing.xs,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  // actionEmoji intentionally removed — using Material Icons
  actionLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
  },
  noteInputRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  noteInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noteSubmit: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  noteSubmitText: {
    color: Colors.textInverse,
    fontWeight: '600',
  },
  flyFieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  catchModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  catchModalOverlay: {
    width: '100%',
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
    maxWidth: 400,
  },
  catchModal: {
    alignSelf: 'stretch',
    width: '100%',
    height: '88%',
    maxHeight: '88%',
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
  },
  catchModalHeader: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  catchModalScroll: {
    flex: 1,
  },
  catchModalScrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  catchModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  catchFlyDropdownRowWrap: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  catchFlyDropdownCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catchFlyDropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catchFlyDropdownValue: {
    fontSize: FontSize.sm,
    color: Colors.text,
    flex: 1,
  },
  catchFlyDropdownPlaceholder: {
    color: Colors.textTertiary,
  },
  catchFlyPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  catchFlyPickerSheet: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    maxHeight: '60%',
  },
  catchFlyPickerList: {
    maxHeight: 320,
  },
  catchFlyPickerOption: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  catchFlyPickerOptionActive: {
    backgroundColor: Colors.background,
  },
  catchFlyPickerOptionText: {
    fontSize: FontSize.md,
    color: Colors.text,
  },
  catchFlyPickerOptionTextActive: {
    color: Colors.primary,
    fontWeight: '600',
  },
  catchFlyRadioRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  catchFlyRadioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  catchFlyRadioLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  catchFlyRadioLabelActive: {
    color: Colors.text,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  tripPhotoModal: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 360,
  },
  tripPhotoModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  tripPhotoModalHint: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginBottom: Spacing.md,
  },
  tripPhotoModalInput: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.sm,
  },
  tripPhotoModalButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  tripPhotoModalCancel: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tripPhotoModalCancelText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  tripPhotoModalSave: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
    minHeight: 40,
  },
  tripPhotoModalSaveDisabled: {
    opacity: 0.7,
  },
  tripPhotoModalSaveText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textInverse,
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
    color: Colors.textInverse,
    marginBottom: Spacing.xs,
  },
  fullScreenPhotoCaption: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginTop: Spacing.xs,
  },
  catchModalInput: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.sm,
  },
  catchModalNoteInput: {
    minHeight: 64,
  },
  catchPhotoRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  catchPhotoButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catchPhotoButtonLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
  },
  catchPhotoPreviewWrap: {
    position: 'relative',
    width: 120,
    height: 120,
  },
  catchPhotoPreview: {
    width: 120,
    height: 120,
    borderRadius: BorderRadius.md,
  },
  catchPhotoRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  quantityBtn: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityBtnText: {
    fontSize: FontSize.lg,
    color: Colors.text,
    fontWeight: '600',
  },
  quantityValue: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    minWidth: 24,
    textAlign: 'center',
  },
  catchModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  catchModalCancel: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  catchModalCancelText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  timeline: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  timelineTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  timelineEditHint: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginBottom: Spacing.md,
  },
  timelineRowMenuBtn: {
    padding: Spacing.xs,
  },
  tripTimelineActionOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  tripTimelineActionSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    paddingBottom: Spacing.xl,
  },
  tripTimelineActionRow: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  tripTimelineActionLabel: {
    fontSize: FontSize.md,
    color: Colors.text,
  },
  tripTimelineActionDestructive: {
    color: Colors.error,
  },
  tripTimelineActionCancel: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.primary,
    textAlign: 'center',
  },
  tripTimelineModalRoot: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  tripTimelineModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  tripTimelineModalTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
  },
  tripTimelineModalCancel: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  tripTimelineModalSave: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.primary,
  },
  tripTimelineModalScroll: {
    flex: 1,
    padding: Spacing.lg,
  },
  tripTimelineFieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  tripTimelineInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.text,
    backgroundColor: Colors.surface,
  },
  tripTimelineTallInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  tripTimelineNoteBody: {
    flex: 1,
    margin: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.text,
    textAlignVertical: 'top',
  },
  timelineItem: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.md,
    alignItems: 'flex-start',
  },
  timelineTime: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    width: 65,
    paddingTop: 2,
  },
  timelineContent: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  timelineDot: {
    width: 20,
    alignItems: 'center' as const,
    paddingTop: 2,
  },
  timelineTextBlock: {
    flex: 1,
    gap: Spacing.sm,
  },
  timelineText: {
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  timelineCatchDetails: {
    marginTop: Spacing.xs,
    gap: 2,
  },
  timelineCatchDetailLine: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  timelineCatchThumb: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
  },

  mapTabContainer: {
    flex: 1,
    minHeight: 280,
  },
  mapTabMap: {
    flex: 1,
    width: '100%',
    minHeight: 280,
  },
  mapTabPlaceholder: {
    flex: 1,
    minHeight: 280,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  mapTabPlaceholderText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  mapTabRetryButton: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
  },
  mapTabRetryButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: '#fff',
  },
  mapTabBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  mapTabBannerText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  mapTabBannerRetry: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
  },
  mapTabFabColumn: {
    position: 'absolute',
    right: Spacing.md,
    /* Clear bottom strip: Mapbox (i) + zoom stack live above trip safe area */
    bottom: Spacing.lg + 96,
    gap: Spacing.sm,
    alignItems: 'flex-end',
  },
  mapTabFishFab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
  mapTabOfflineFab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.info,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
  mapTabFabPressed: {
    opacity: 0.88,
  },
  mapTabFabDisabled: {
    opacity: 0.55,
  },
  mapTabFishFabLabel: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.textInverse,
  },
  mapTabOfflineFabLabel: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.textInverse,
  },

  // AI Guide Tab
  aiScrollView: {
    flex: 1,
  },
  aiScrollContent: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  aiGetRecButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  aiGetRecButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.primary,
  },
  smartRecCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: Colors.accent,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
    position: 'relative',
    overflow: 'hidden',
  },
  smartRecHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  smartRecTitle: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  smartRecRefresh: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  smartRecRefreshText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
  },
  smartRecFly: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  smartRecColor: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  smartRecReason: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  smartRecFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
  },
  confidenceBadge: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs,
  },
  confidenceText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  switchFlyButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  switchFlyButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textInverse,
  },
  smartRecLoadingOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.lg,
  },
  aiContextNote: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
    marginVertical: Spacing.xs,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surface,
  },
  bubbleText: {
    fontSize: FontSize.md,
    lineHeight: 22,
    flex: 1,
  },
  userBubbleText: {
    color: Colors.textInverse,
  },
  aiBubbleText: {
    color: Colors.text,
  },
  aiInputRow: {
    flexDirection: 'row',
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  aiInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
  },
  aiSendButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  aiSendButtonDisabled: {
    opacity: 0.5,
  },
  aiSendButtonText: {
    color: Colors.textInverse,
    fontWeight: '600',
    fontSize: FontSize.md,
  },
});
