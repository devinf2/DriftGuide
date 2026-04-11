import { useCallback, useEffect, useMemo, useRef, useState, type RefObject, type ReactNode } from 'react';
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
import { CatalogLocationMapIcon } from '@/src/components/map/catalogLocationMapIcon';
import { LabeledEndpointMapPin } from '@/src/components/map/LabeledEndpointMapPin';
import { CatchDetailsModal, type CatchDetailsSubmitAdd } from '@/src/components/catch/CatchDetailsModal';
import { ChangeFlyPickerModal, splitFlyChangeData } from '@/src/components/fly/ChangeFlyPickerModal';
import { TripMapboxMapView, type TripMapboxMapRef } from '@/src/components/map/TripMapboxMapView';
import { GuideChatLinkedSpots } from '@/src/components/GuideChatLinkedSpots';
import { GuideChatWebSources } from '@/src/components/GuideChatWebSources';
import { GuideLocationRecommendationCards } from '@/src/components/GuideLocationRecommendationCards';
import { SpotTaggedText } from '@/src/components/SpotTaggedText';
import type { GuideIntelSource, GuideLocationRecommendation } from '@/src/services/guideIntelContract';
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
import { fetchCatchesInBounds, fetchTripById, upsertCatchEventToCloud } from '@/src/services/sync';
import { isPointInBoundingBox, type BoundingBox } from '@/src/types/boundingBox';
import { COMMON_FLIES_BY_NAME, FLY_COLORS, FLY_NAMES, FLY_SIZES, COMMON_SPECIES as SPECIES_OPTIONS } from '@/src/constants/fishingTypes';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { askAI, getSeason, getSpotFishingSummary, getSpotHowToFish, getTimeOfDay } from '@/src/services/ai';
import { enrichContextWithLocationCatchData } from '@/src/services/guideCatchContext';
import { buildConditionsFromWeatherAndFlow } from '@/src/services/conditions';
import { fetchFlies, fetchFlyCatalog, getFliesFromCache, loadFlyCatalogFromCache } from '@/src/services/flyService';
import { buildPendingFromAddPhotoOptions, savePendingPhoto } from '@/src/services/pendingPhotoStorage';
import { addPhoto, fetchPhotos, PhotoQueuedOfflineError } from '@/src/services/photoService';
import { useLocationFavoritesStore } from '@/src/stores/locationFavoritesStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { useTripStore } from '@/src/stores/tripStore';
import { useAuthStore } from '@/src/stores/authStore';
import { useFriendsStore } from '@/src/stores/friendsStore';
import { SharedTripPhotosSection } from '@/src/components/trip/SharedTripPhotosSection';
import { SharedTripTimelineSection } from '@/src/components/trip/SharedTripTimelineSection';
import {
  photosToViewerSlides,
  TripFullScreenPhotoViewerModal,
} from '@/src/components/trip/TripFullScreenPhotoViewerModal';
import { TripSessionPeopleSheet } from '@/src/components/trip/TripSessionPeopleSheet';
import {
  AIQueryData,
  CatchData,
  Fly,
  FlyCatalog,
  FlyChangeData,
  NoteData,
  Photo,
  PresentationMethod,
  Structure,
  Trip,
  TripEvent,
  type LocationType,
} from '@/src/types';
import { TimelineCatchPhotoStrip } from '@/src/components/catch/TimelineCatchPhotoStrip';
import { getCatchHeroPhotoUrl } from '@/src/utils/catchPhotos';
import { formatCatchWeightLabel, getTripEventDescription } from '@/src/utils/journalTimeline';
import { formatEventTime, formatFishCount, formatTripDate } from '@/src/utils/formatters';
import {
  getSessionTripPhotos,
  getTripPhotosCacheDebugKeys,
  setSessionTripPhotos,
} from '@/src/utils/tripPhotosSessionCache';
import { tripLifecycleNoteTimelineIcon } from '@/src/utils/timelineTripNoteIcon';
import {
  findActiveFlyEventIdBefore,
  sortEventsByTime,
  timestampBetween,
  upsertEventSorted,
} from '@/src/utils/journalTimeline';
import { catalogLocationMarkersInViewport } from '@/src/utils/mapCatalogMarkers';
import { tripMapDefaultCenterCoordinate, tripMapDefaultZoom } from '@/src/utils/mapViewport';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ExpoLocation from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { v4 as uuidv4 } from 'uuid';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type TabKey = 'fish' | 'photos' | 'conditions' | 'map';

type TripGuideChatMessage = {
  id: string;
  role: 'user' | 'ai';
  text: string;
  linkedSpots?: { id: string; name: string }[];
  ambiguousSpots?: { extractedPhrase: string; candidates: { id: string; name: string }[] }[];
  webSources?: GuideIntelSource[];
  sourcesFetchedAt?: string;
  locationRecommendation?: GuideLocationRecommendation | null;
};

/** Rebuild in-trip guide chat from persisted timeline rows (`ai_query`). */
function aiQueryEventsToChatMessages(events: TripEvent[]): TripGuideChatMessage[] {
  const sorted = sortEventsByTime(events.filter((e) => e.event_type === 'ai_query'));
  const rows: TripGuideChatMessage[] = [];
  for (const ev of sorted) {
    const d = ev.data as AIQueryData;
    rows.push({ id: `${ev.id}-q`, role: 'user', text: d.question });
    if (d.response?.trim()) {
      const ws = d.webSources;
      rows.push({
        id: `${ev.id}-a`,
        role: 'ai',
        text: d.response,
        ...(ws && ws.length > 0
          ? {
              webSources: ws.map((s) => ({
                url: s.url,
                title: s.title,
                fetchedAt: s.fetchedAt ?? ev.timestamp,
                excerpt: s.excerpt ?? '',
              })),
              sourcesFetchedAt: ws[0]?.fetchedAt ?? ev.timestamp,
            }
          : {}),
      });
    }
  }
  return rows;
}

/** Set false to silence `[TripPhotos]` / `[TripPhotosCache]` console noise while debugging other issues. */
const TRIP_PHOTOS_DEBUG = typeof __DEV__ !== 'undefined' && __DEV__;

export default function TripDashboardScreen() {
  const { colors, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createTripDashboardStyles(colors), [colors]);

  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const { isConnected } = useNetworkStatus();
  const {
    activeTrip, events, fishCount, currentFly, currentFly2, nextFlyRecommendation,
    weatherData, waterFlowData, conditionsLoading, recommendationLoading,
    addCatch, removeCatch, changeFly, updateFlyChangeEvent, addNote, addBite, addFishOn, addAIQuery, endTrip,
    resumeTrip, isTripPaused,
    fetchConditions,
    refreshSmartRecommendation,
    replaceActiveTripEvents,
    patchActiveTrip,
    clearActiveTrip,
  } = useTripStore();

  const { user } = useAuthStore();
  const friendships = useFriendsStore((s) => s.friendships);
  const refreshFriends = useFriendsStore((s) => s.refresh);
  const [peopleSheetVisible, setPeopleSheetVisible] = useState(false);

  const locations = useLocationStore((s) => s.locations);
  const fetchLocations = useLocationStore((s) => s.fetchLocations);
  const userProxRefForAI = useRef<[number, number] | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>('fish');
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
  /** Full-screen photo view: timeline / map catch (single image) */
  const [fullScreenPhoto, setFullScreenPhoto] = useState<{
    url: string;
    location?: string;
    fly?: string;
    date?: string;
    species?: string;
    caption?: string;
  } | null>(null);
  /** Photos tab: index into `tripPhotos` for swipeable full-screen viewer */
  const [tripPhotoViewerIndex, setTripPhotoViewerIndex] = useState<number | null>(null);

  /** Updated every render so photo-tab effects see current row count (avoids stale closure). */
  const tripPhotosRowCountRef = useRef(0);
  tripPhotosRowCountRef.current = tripPhotos.length;

  const [aiPendingQuestion, setAiPendingQuestion] = useState<string | null>(null);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiScrollRef = useRef<ScrollView>(null);
  const [tripAiModalVisible, setTripAiModalVisible] = useState(false);

  const [userFlies, setUserFlies] = useState<Fly[]>([]);
  const [flyCatalog, setFlyCatalog] = useState<FlyCatalog[]>([]);
  const conditionsFetched = useRef(false);
  /** One automatic "select fly" prompt per trip id (dismiss without picking does not re-prompt). */
  const autoFlyPromptedForTripRef = useRef<string | null>(null);
  const [mapLocation, setMapLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [mapLocationLoading, setMapLocationLoading] = useState(false);
  const [mapLocationError, setMapLocationError] = useState<string | null>(null);
  const [strategyTopFlies, setStrategyTopFlies] = useState<string[]>([]);
  const [strategyBestTime, setStrategyBestTime] = useState<string | null>(null);
  const [strategyHowToFish, setStrategyHowToFish] = useState<string | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  /** Avoid re-calling spot summary APIs every time the trip guide modal opens. */
  const strategyFetchedForTripIdRef = useRef<string | null>(null);

  /** Fly names for picker: from Fly Box when available, else default list */
  const flyPickerNames = userFlies.length > 0
    ? [...new Set(userFlies.map(f => f.name))].sort()
    : FLY_NAMES;

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
    fetchFlyCatalog()
      .then(setFlyCatalog)
      .catch(async () => {
        setFlyCatalog(await loadFlyCatalogFromCache());
      });
  }, []);

  useEffect(() => {
    if (locations.length === 0) void fetchLocations();
  }, [locations.length, fetchLocations]);

  useEffect(() => {
    void refreshFriends(user?.id ?? null);
  }, [user?.id, refreshFriends]);

  useEffect(() => {
    if (!activeTrip?.id || !isConnected) return;
    let cancelled = false;
    void fetchTripById(activeTrip.id).then((t) => {
      if (cancelled || !t) return;
      if (user?.id && t.user_id !== user.id) {
        clearActiveTrip();
        return;
      }
      const sid = t.shared_session_id ?? null;
      const cur = activeTrip.shared_session_id ?? null;
      if (sid !== cur) patchActiveTrip({ shared_session_id: sid });
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeTrip?.id,
    activeTrip?.shared_session_id,
    activeTrip?.user_id,
    isConnected,
    user?.id,
    patchActiveTrip,
    clearActiveTrip,
  ]);

  /** Live trip UI is driven by the store; keep the URL aligned so deep links don’t show another id while editing a different active trip. */
  useEffect(() => {
    if (!id || !activeTrip?.id || activeTrip.status !== 'active') return;
    if (!user?.id || activeTrip.user_id !== user.id) return;
    if (id === activeTrip.id) return;
    router.replace(`/trip/${activeTrip.id}`);
  }, [id, activeTrip?.id, activeTrip?.status, activeTrip?.user_id, user?.id, router]);

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

  const tripPhotosFetchSeqRef = useRef(0);
  /** After a successful fetch for `userId:tripId`, tab revisits skip the blocking spinner (Map can clear on Fast Refresh). */
  const warmTripPhotosKeyRef = useRef<string | null>(null);
  const lastTripPhotosIdentityRef = useRef<string | null>(null);

  const refreshTripPhotos = useCallback(
    async (showLoading: boolean) => {
      if (!activeTrip?.id || !activeTrip?.user_id) {
        if (TRIP_PHOTOS_DEBUG) console.log('[TripPhotos] refresh:skip (no activeTrip id/user_id)');
        return;
      }
      const uid = activeTrip.user_id;
      const tid = activeTrip.id;
      if (showLoading) {
        setTripPhotosLoading(true);
      } else {
        setTripPhotosLoading(false);
      }
      const seq = ++tripPhotosFetchSeqRef.current;
      if (TRIP_PHOTOS_DEBUG) {
        console.log('[TripPhotos] refresh:start', {
          showLoading,
          seq,
          cacheKey: `${uid}:${tid}`,
          routeParamId: id,
          routeMatchesActiveTripId: tid === id,
        });
      }
      try {
        const photos = await fetchPhotos(uid, { tripId: tid });
        if (seq !== tripPhotosFetchSeqRef.current) {
          if (TRIP_PHOTOS_DEBUG) console.log('[TripPhotos] refresh:stale after fetch', { seq });
          return;
        }
        setTripPhotos(photos);
        setSessionTripPhotos(uid, tid, photos);
        warmTripPhotosKeyRef.current = `${uid}:${tid}`;
        if (TRIP_PHOTOS_DEBUG) console.log('[TripPhotos] refresh:ok', { seq, count: photos.length });
      } catch (e) {
        if (seq !== tripPhotosFetchSeqRef.current) return;
        if (TRIP_PHOTOS_DEBUG) console.log('[TripPhotos] refresh:error', { seq, showLoading, e });
        if (showLoading) {
          setTripPhotos([]);
          setSessionTripPhotos(uid, tid, []);
        }
      } finally {
        if (showLoading && seq === tripPhotosFetchSeqRef.current) {
          setTripPhotosLoading(false);
        }
      }
    },
    [activeTrip?.id, activeTrip?.user_id, id],
  );

  /**
   * When user/trip identity changes: restore from session cache (or empty).
   * Do NOT run `setTripPhotos` on every effect run — that wipes in-memory rows when cache is empty
   * (e.g. tab switch) and causes a spinner every time.
   */
  useEffect(() => {
    if (!activeTrip?.user_id || !activeTrip?.id) {
      if (TRIP_PHOTOS_DEBUG) {
        console.log('[TripPhotos] identity:clear state (missing activeTrip user_id or id)', {
          routeParamId: id,
        });
      }
      setTripPhotos([]);
      lastTripPhotosIdentityRef.current = null;
      warmTripPhotosKeyRef.current = null;
      return;
    }
    const uid = activeTrip.user_id;
    const tid = activeTrip.id;
    const identity = `${uid}:${tid}`;
    if (lastTripPhotosIdentityRef.current === identity) {
      return;
    }
    lastTripPhotosIdentityRef.current = identity;
    warmTripPhotosKeyRef.current = null;
    const cached = getSessionTripPhotos(uid, tid);
    if (TRIP_PHOTOS_DEBUG) {
      console.log('[TripPhotos] identity:hydrate', {
        identity,
        routeParamId: id,
        routeMatchesTid: tid === id,
        authUserId: user?.id,
        cacheHit: cached !== undefined,
        cachedCount: cached?.length ?? null,
        cacheKeysNow: getTripPhotosCacheDebugKeys(),
      });
    }
    setTripPhotos(cached !== undefined ? cached : []);
  }, [activeTrip?.id, activeTrip?.user_id]);

  useEffect(() => {
    if (!activeTrip?.id || !activeTrip?.user_id || activeTab !== 'photos') return;
    const uid = activeTrip.user_id;
    const tid = activeTrip.id;
    const key = `${uid}:${tid}`;
    /** Read Map directly — React state/ref from identity effect may not have flushed yet this commit. */
    const cachedList = getSessionTripPhotos(uid, tid);
    if (cachedList !== undefined) {
      setTripPhotos(cachedList);
    }
    const hasSessionCache = cachedList !== undefined;
    const hasWarmedThisTrip = warmTripPhotosKeyRef.current === key;
    const hasRowsAlready = tripPhotosRowCountRef.current > 0;
    const showBlockingSpinner = !hasSessionCache && !hasWarmedThisTrip && !hasRowsAlready;
    if (TRIP_PHOTOS_DEBUG) {
      console.log('[TripPhotos] photosTabEffect', {
        key,
        routeParamId: id,
        routeMatchesTid: tid === id,
        hasSessionCache,
        cachedCount: cachedList?.length ?? null,
        hasWarmedThisTrip,
        warmKey: warmTripPhotosKeyRef.current,
        rowCountRef: tripPhotosRowCountRef.current,
        showBlockingSpinner,
        allCacheKeys: getTripPhotosCacheDebugKeys(),
      });
    }
    void refreshTripPhotos(showBlockingSpinner);
  }, [activeTrip?.id, activeTrip?.user_id, activeTab, refreshTripPhotos, id]);

  useEffect(() => {
    if (!TRIP_PHOTOS_DEBUG) return;
    if (activeTab !== 'photos' || !activeTrip?.id) return;
    const blocking = tripPhotosLoading && tripPhotos.length === 0;
    if (blocking) {
      console.log('[TripPhotos] UI:blockingSpinner visible', {
        tripPhotosLoading,
        tripPhotoCount: tripPhotos.length,
        sharedSession: !!activeTrip.shared_session_id,
        tid: activeTrip.id,
        routeParamId: id,
        tripOwnerId: activeTrip.user_id,
        authUserId: user?.id,
        cacheKeys: getTripPhotosCacheDebugKeys(),
      });
    }
  }, [
    activeTab,
    activeTrip?.id,
    activeTrip?.shared_session_id,
    activeTrip?.user_id,
    tripPhotosLoading,
    tripPhotos.length,
    id,
    user?.id,
  ]);

  useEffect(() => {
    if (tripPhotoViewerIndex == null) return;
    if (tripPhotos.length === 0) {
      setTripPhotoViewerIndex(null);
      return;
    }
    if (tripPhotoViewerIndex >= tripPhotos.length) {
      setTripPhotoViewerIndex(tripPhotos.length - 1);
    }
  }, [tripPhotoViewerIndex, tripPhotos.length]);

  const tripPhotoViewerSlides = useMemo(
    () => photosToViewerSlides(tripPhotos, activeTrip?.location?.name),
    [tripPhotos, activeTrip?.location?.name],
  );

  const tripPhotoViewerSlidesFull = useMemo(() => {
    if (tripPhotoViewerIndex != null && tripPhotos.length > 0) {
      return tripPhotoViewerSlides;
    }
    if (fullScreenPhoto) {
      return [
        {
          remoteUri: fullScreenPhoto.url,
          location: fullScreenPhoto.location,
          fly: fullScreenPhoto.fly,
          date: fullScreenPhoto.date,
          species: fullScreenPhoto.species,
          caption: fullScreenPhoto.caption,
        },
      ];
    }
    return [];
  }, [tripPhotoViewerIndex, tripPhotos.length, tripPhotoViewerSlides, fullScreenPhoto]);

  const tripPhotoViewerVisible = tripPhotoViewerSlidesFull.length > 0;
  const tripPhotoViewerActiveIndex = tripPhotoViewerIndex ?? 0;

  const closeTripPhotoViewer = useCallback(() => {
    setTripPhotoViewerIndex(null);
    setFullScreenPhoto(null);
  }, []);

  const onTripPhotoViewerIndexChange = useCallback((next: number) => {
    setTripPhotoViewerIndex((prev) => (prev != null ? next : prev));
  }, []);

  const historicalAiMessages = useMemo(() => aiQueryEventsToChatMessages(events), [events]);
  const displayAiMessages = useMemo(
    () =>
      aiPendingQuestion
        ? [
            ...historicalAiMessages,
            { id: 'pending-user', role: 'user' as const, text: aiPendingQuestion },
          ]
        : historicalAiMessages,
    [historicalAiMessages, aiPendingQuestion],
  );

  useEffect(() => {
    strategyFetchedForTripIdRef.current = null;
    setStrategyTopFlies([]);
    setStrategyBestTime(null);
    setStrategyHowToFish(null);
    setStrategyLoading(false);
  }, [activeTrip?.id]);

  useEffect(() => {
    if (!tripAiModalVisible || !activeTrip?.location) return;
    if (strategyFetchedForTripIdRef.current === activeTrip.id) return;

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
        strategyFetchedForTripIdRef.current = activeTrip.id;
      }
    }).catch(() => {
      if (!cancelled) setStrategyLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tripAiModalVisible, activeTrip?.id, activeTrip?.location?.id, activeTrip?.location?.name, weatherData, waterFlowData]);

  useEffect(() => {
    if (!tripAiModalVisible) return;
    const t = setTimeout(() => aiScrollRef.current?.scrollToEnd({ animated: true }), 250);
    return () => clearTimeout(t);
  }, [tripAiModalVisible, displayAiMessages.length, aiLoading]);

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
      await refreshTripPhotos(false);
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
  }, [activeTrip?.id, activeTrip?.user_id, tripPhotoUri, tripPhotoCaption, tripPhotoSpecies, currentFly, refreshTripPhotos, isConnected]);

  const handleCancelTripPhoto = useCallback(() => {
    setTripPhotoUri(null);
    setTripPhotoCaption('');
    setTripPhotoSpecies('');
  }, []);

  const handleCatchPhotoPress = useCallback((event: TripEvent) => {
    const data = event.data as CatchData;
    const hero = getCatchHeroPhotoUrl(data);
    if (!hero) return;
    setTripPhotoViewerIndex(null);
    setFullScreenPhoto({
      url: hero,
      location: activeTrip?.location?.name ?? undefined,
      date: formatTripDate(event.timestamp),
      species: data.species ?? undefined,
      caption: data.note ?? undefined,
    });
  }, [activeTrip?.location?.name]);

  const handleTripPhotoPress = useCallback((photo: Photo) => {
    const i = tripPhotos.findIndex((p) => p.id === photo.id);
    if (i >= 0) {
      setFullScreenPhoto(null);
      setTripPhotoViewerIndex(i);
    }
  }, [tripPhotos]);

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

  const handleCatchSkipAdd = useCallback(() => {
    if (!activeTrip || isTripPaused) return;
    addCatch({ quantity: 1, released: null }, null, null);
  }, [activeTrip, isTripPaused, addCatch]);

  const handleEditCatch = useCallback((ev: TripEvent) => {
    if (isTripPaused) return;
    const fresh = useTripStore
      .getState()
      .events.find((e) => e.id === ev.id && e.event_type === 'catch');
    setCatchUIMode(fresh ?? ev);
  }, [isTripPaused]);

  const handleCatchSubmitAdd = useCallback(
    async (payload: CatchDetailsSubmitAdd) => {
      if (!activeTrip?.id || !activeTrip?.user_id) return;
      const {
        primary,
        dropper,
        catchFields,
        latitude,
        longitude,
        photoUris,
        photoCapturedAtIso,
        catchTimestampIso,
        conditionsSnapshot,
      } = payload;
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
      const capturedAt = photoCapturedAtIso ?? catchTimestampIso ?? new Date().toISOString();
      const photoOptionsBase = {
        userId: activeTrip.user_id,
        tripId: activeTrip.id,
        caption: catchFields.note?.trim() || undefined,
        species: species ?? undefined,
        fly_pattern: primary.pattern,
        fly_size: primary.size ?? undefined,
        fly_color: primary.color ?? undefined,
        fly_id: primary.fly_id ?? undefined,
        captured_at: capturedAt,
      };

      const catchOptions =
        conditionsSnapshot !== undefined ? { conditionsSnapshot } : undefined;

      const hasPhotos = photoUris.length > 0;
      const eventId = addCatch(
        {
          ...catchFields,
          ...(hasPhotos && !isConnected
            ? {
                photo_urls: [...photoUris],
                photo_url: photoUris[0] ?? null,
              }
            : { photo_url: null, photo_urls: null }),
        },
        latitude,
        longitude,
        undefined,
        catchOptions,
      );

      if (!eventId || !hasPhotos) return;

      const catchEvent = useTripStore.getState().events.find((e) => e.id === eventId && e.event_type === 'catch');
      if (!catchEvent) return;

      if (isConnected) {
        const allEvents = useTripStore.getState().events;
        const ok = await upsertCatchEventToCloud(activeTrip, catchEvent, allEvents);
        if (!ok) {
          Alert.alert('Sync failed', 'Could not save the catch before uploading photos. Try again when online.');
          return;
        }
        const appendCatchEventPhotoUrl = useTripStore.getState().appendCatchEventPhotoUrl;
        for (let i = 0; i < photoUris.length; i++) {
          try {
            const photo = await addPhoto(
              {
                ...photoOptionsBase,
                uri: photoUris[i],
                catchId: eventId,
                displayOrder: i,
              },
              { isOnline: true },
            );
            appendCatchEventPhotoUrl(activeTrip.id, eventId, photo.url);
          } catch (e) {
            Alert.alert('Upload failed', (e as Error).message);
            throw e;
          }
        }
      } else {
        for (let i = 0; i < photoUris.length; i++) {
          try {
            await savePendingPhoto({
              ...buildPendingFromAddPhotoOptions(
                {
                  ...photoOptionsBase,
                  uri: photoUris[i],
                  displayOrder: i,
                },
                'catch',
                eventId,
              ),
            });
          } catch {
            // non-blocking
          }
        }
      }
    },
    [addCatch, changeFly, activeTrip, currentFly, currentFly2, isConnected],
  );

  const handleCatchSubmitEdit = useCallback(
    async (nextEvents: TripEvent[]) => {
      replaceActiveTripEvents(nextEvents, {
        viewerUserId: user?.id ?? activeTrip?.user_id,
      });
    },
    [replaceActiveTripEvents, user?.id, activeTrip?.user_id],
  );

  const handleEndTrip = () => {
    if (!activeTrip) return;
    const endMsg = activeTrip.shared_session_id
      ? `This ends only your trip. Friends in your fishing group keep their own trips; the group stays active.\n\nEnd with ${formatFishCount(fishCount)}?`
      : `End this trip with ${formatFishCount(fishCount)}?`;
    Alert.alert('End Trip', endMsg, [
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

  useEffect(() => {
    if (!activeTrip || activeTrip.status !== 'active' || isTripPaused) return;
    const hasPrimaryFly = Boolean(currentFly?.pattern?.trim());
    if (hasPrimaryFly) return;
    if (autoFlyPromptedForTripRef.current === activeTrip.id) return;
    autoFlyPromptedForTripRef.current = activeTrip.id;
    setFlyPickerEditEvent(null);
    setShowFlyPicker(true);
  }, [activeTrip?.id, activeTrip?.status, currentFly, isTripPaused]);

  const handleAskAI = useCallback(async () => {
    const question = aiInput.trim();
    if (!question || aiLoading || isTripPaused) return;

    setAiPendingQuestion(question);
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

    try {
      const context = await enrichContextWithLocationCatchData(base, {
        question,
        locations,
        userId: activeTrip?.user_id ?? null,
        userLat: userProxRefForAI.current?.[1] ?? null,
        userLng: userProxRefForAI.current?.[0] ?? null,
        referenceDate: now,
      });
      const response = await askAI(context, question);

      addAIQuery(
        question,
        response.text,
        response.sources?.map((s) => ({
          url: s.url,
          title: s.title,
          fetchedAt: s.fetchedAt,
          excerpt: s.excerpt,
        })),
      );

      setTimeout(() => aiScrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      Alert.alert('Trip guide', 'Could not get a response. Check your connection and try again.');
    } finally {
      setAiPendingQuestion(null);
      setAiLoading(false);
    }
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
              placeholderTextColor={colors.textTertiary}
              value={tripPhotoCaption}
              onChangeText={setTripPhotoCaption}
            />
            <Text style={styles.flyFieldLabel}>Species (optional)</Text>
            <TextInput
              style={styles.tripPhotoModalInput}
              placeholder="e.g. Brown Trout"
              placeholderTextColor={colors.textTertiary}
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
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.tripPhotoModalSaveText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <TripFullScreenPhotoViewerModal
        visible={tripPhotoViewerVisible}
        onClose={closeTripPhotoViewer}
        slides={tripPhotoViewerSlidesFull}
        index={tripPhotoViewerActiveIndex}
        onIndexChange={onTripPhotoViewerIndexChange}
        paddingTop={effectiveTop}
        paddingBottom={insets.bottom}
        closeButtonTop={insets.top + Spacing.sm}
      />

      <Modal
        visible={tripAiModalVisible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={() => setTripAiModalVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
          <View style={styles.tripAiModalHeader}>
            <Text style={styles.tripAiModalTitle}>Trip guide</Text>
            <Pressable onPress={() => setTripAiModalVisible(false)} hitSlop={12}>
              <Text style={styles.tripAiModalDone}>Done</Text>
            </Pressable>
          </View>
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
                    <ActivityIndicator size="small" color={colors.primary} style={styles.strategyLoader} />
                  ) : strategyBestTime ? (
                    <Text style={styles.strategyBestTime}>{strategyBestTime}</Text>
                  ) : (
                    <Text style={styles.strategyPlaceholder}>—</Text>
                  )}
                </View>
                <Text style={styles.strategySectionLabel}>Top flies</Text>
                <View style={styles.strategyCard}>
                  {strategyLoading ? (
                    <ActivityIndicator size="small" color={colors.primary} style={styles.strategyLoader} />
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
                    <ActivityIndicator size="small" color={colors.primary} style={styles.strategyLoader} />
                  ) : strategyHowToFish ? (
                    <Text style={styles.strategyHowToFishText}>{strategyHowToFish}</Text>
                  ) : (
                    <Text style={styles.strategyPlaceholder}>—</Text>
                  )}
                </View>
              </>
            }
            messages={displayAiMessages}
            input={aiInput}
            setInput={setAiInput}
            loading={aiLoading}
            onSend={handleAskAI}
            scrollRef={aiScrollRef}
            styles={styles}
            colors={colors}
          />
        </SafeAreaView>
      </Modal>

      {/* Header — extends into top safe area so status bar area is blue */}
      <View style={[styles.header, { paddingTop: effectiveTop + Spacing.md }]}>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.locationName} numberOfLines={2}>
            {activeTrip.location?.name || 'Fishing Trip'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {!isConnected && (
            <View style={styles.offlineBadge}>
              <Text style={styles.offlineBadgeText}>Offline</Text>
            </View>
          )}
          <Pressable
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, marginRight: Spacing.sm }]}
            onPress={() => setPeopleSheetVisible(true)}
            hitSlop={8}
            accessibilityLabel="Fishing group"
          >
            <MaterialIcons name="group" size={22} color={colors.textInverse} />
          </Pressable>
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
          { key: 'map' as TabKey, label: 'Map' },
        ]).map((tab) => {
          const color = activeTab === tab.key ? colors.primary : colors.textTertiary;
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
            patchActiveTrip={patchActiveTrip}
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
            userId={user?.id ?? activeTrip.user_id}
            isConnected={isConnected}
            styles={styles}
            colors={colors}
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
            flyCatalog={flyCatalog}
            allEvents={events}
            editingEvent={catchUIMode != null && catchUIMode !== 'add' ? catchUIMode : null}
            seedPrimary={currentFly}
            seedDropper={currentFly2}
            getPresentationForFly={getPresentationForFly}
            onSubmitAdd={handleCatchSubmitAdd}
            onSubmitEdit={handleCatchSubmitEdit}
            onSkipAdd={handleCatchSkipAdd}
          />
        </>
      )}

      {/* Trip rig picker: shared ChangeFlyPickerModal (My flies + catalog + Try next from tripStore) */}
      <ChangeFlyPickerModal
        visible={showFlyPicker}
        onClose={closeFlyPicker}
        userFlies={userFlies}
        flyCatalog={flyCatalog}
        seedKey={flyPickerEditEvent?.id ?? 'rig'}
        initialPrimary={flyPickerSeeds.primary}
        initialDropper={flyPickerSeeds.dropper}
        title={flyPickerEditEvent ? 'Edit fly change' : 'Select Fly'}
        onConfirm={handleFlyPickerConfirm}
        nextFlyRecommendation={flyPickerEditEvent ? null : nextFlyRecommendation}
        recommendationLoading={recommendationLoading}
      />

      {activeTab === 'photos' && activeTrip && (
        activeTrip.shared_session_id ? (
          <SharedTripPhotosSection
            trip={activeTrip}
            viewerUserId={user?.id ?? activeTrip.user_id}
            isConnected={isConnected}
            myTripPhotos={tripPhotos}
            myPhotosLoading={tripPhotosLoading}
            onPhotoPress={handleTripPhotoPress}
            onAddPhoto={handlePickTripPhoto}
            uploading={tripPhotoUploading}
          />
        ) : (
          <PhotosTab
            tripPhotos={tripPhotos}
            loading={tripPhotosLoading}
            uploading={tripPhotoUploading}
            onAddPhoto={handlePickTripPhoto}
            onPhotoPress={handleTripPhotoPress}
            styles={styles}
            colors={colors}
          />
        )
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

      {activeTab === 'map' && (
        <TripMapTab
          trip={activeTrip}
          events={events}
          userId={activeTrip.user_id}
          isConnected={isConnected}
          mapLocation={mapLocation}
          mapLocationLoading={mapLocationLoading}
          mapLocationError={mapLocationError}
          colors={colors}
          mapColorScheme={resolvedScheme}
          styles={styles}
          onSelectCatch={(ev) => setCatchUIMode(ev)}
          onRequestLocation={async () => {
            setMapLocationLoading(true);
            setMapLocationError(null);
            try {
              const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
              if (status !== 'granted') {
                setMapLocationError('Location permission is needed to show your position on the map.');
                return;
              }
              const loc = await ExpoLocation.getCurrentPositionAsync({
                accuracy: ExpoLocation.Accuracy.Balanced,
              });
              setMapLocation({
                lat: loc.coords.latitude,
                lon: loc.coords.longitude,
              });
            } catch {
              setMapLocationError('Could not get your location.');
            } finally {
              setMapLocationLoading(false);
            }
          }}
        />
      )}

      {activeTab !== 'map' ? (
        <Pressable
          style={[styles.tripAiChatFab, { bottom: Spacing.lg + insets.bottom }]}
          onPress={() => setTripAiModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Open trip guide chat"
        >
          <MaterialIcons name="chat" size={26} color={colors.textInverse} />
        </Pressable>
      ) : null}

      {user && activeTrip ? (
        <TripSessionPeopleSheet
          visible={peopleSheetVisible}
          onClose={() => setPeopleSheetVisible(false)}
          tripId={activeTrip.id}
          userId={user.id}
          sharedSessionId={activeTrip.shared_session_id ?? null}
          acceptedFriendships={friendships}
          onSessionChanged={(sid) => patchActiveTrip({ shared_session_id: sid })}
        />
      ) : null}
    </SafeAreaView>
  );
}

/* ─── Fishing Tab ─── */

function FishingTab({
  activeTrip,
  replaceActiveTripEvents,
  patchActiveTrip,
  currentFly, currentFly2,
  openFlyPicker, fishCount, removeCatch, onFishPlus, onEditCatch, onEditFlyChange,
  showNoteInput, setShowNoteInput, noteText, setNoteText, handleAddNote,
  addBite, addFishOn,
  events,
  flyPickerNames: _flyPickerNames = FLY_NAMES,
  userFlies: _userFlies = [],
  onCatchPhotoPress,
  tripPaused = false,
  userId,
  isConnected,
  styles,
  colors,
}: any) {
  const useSharedGroupTimeline = Boolean(activeTrip.shared_session_id && userId);
  const sortedEvents = useMemo(() => sortEventsByTime(events), [events]);
  const [rowActions, setRowActions] = useState<{ event: TripEvent; index: number } | null>(null);
  const [noteModal, setNoteModal] = useState<TripEvent | null>(null);
  const [aiModal, setAiModal] = useState<TripEvent | null>(null);

  const closeRowMenu = useCallback(() => setRowActions(null), []);

  const applyEvents = useCallback(
    (next: TripEvent[]) => {
      replaceActiveTripEvents(next, { viewerUserId: userId });
    },
    [replaceActiveTripEvents, userId],
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
          weight_lb: null,
          weight_oz: null,
          note: null,
          photo_url: null,
          active_fly_event_id: activeFly,
          caught_on_fly: null,
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
          <MaterialCommunityIcons name="pause-circle-outline" size={22} color={colors.textSecondary} />
          <Text style={styles.fishingPausedNoticeText}>
            Trip is paused. Tap Resume in the header to log catches, flies, and notes.
          </Text>
        </View>
      ) : null}
      <View
        style={{ flex: 1, opacity: tripPaused ? 0.38 : 1 }}
        pointerEvents={tripPaused ? 'none' : 'auto'}
      >
      {/* Current Fly (primary + optional dropper) */}
      <Pressable
        style={[styles.currentFlyBar, currentFly2 ? styles.currentFlyBarRig : null]}
        onPress={openFlyPicker}
      >
        <Text style={[styles.currentFlyLabel, currentFly2 ? styles.currentFlyLabelRig : null]}>
          {currentFly2 ? 'Current rig' : 'Current Fly'}
        </Text>
        {currentFly && currentFly2 ? (
          <View style={styles.currentFlyNamesColumn}>
            <Text style={[styles.currentFlyName, styles.currentFlyRigLine]} numberOfLines={2}>
              {`${currentFly.pattern}${currentFly.size ? ` #${currentFly.size}` : ''}`}
            </Text>
            <Text style={[styles.currentFlyName, styles.currentFlyRigLine, styles.currentFlyRigSecond]} numberOfLines={2}>
              {`${currentFly2.pattern}${currentFly2.size ? ` #${currentFly2.size}` : ''}`}
            </Text>
          </View>
        ) : (
          <Text style={styles.currentFlyName}>
            {currentFly ? `${currentFly.pattern}${currentFly.size ? ` #${currentFly.size}` : ''}` : 'Tap to select'}
          </Text>
        )}
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
          <MaterialCommunityIcons name="fish" size={20} color={colors.accent} />
          <Text style={styles.actionLabel}>Bite</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => addFishOn?.()}>
          <MaterialIcons name="highlight-off" size={20} color={colors.textSecondary} />
          <Text style={styles.actionLabel}>Fish On</Text>
        </Pressable>
      </View>
      {/* Change Fly / Add Note */}
      <View style={styles.actionRow}>
        <Pressable style={styles.actionButton} onPress={openFlyPicker}>
          <MaterialCommunityIcons name="hook" size={20} color={colors.accent} />
          <Text style={styles.actionLabel}>Change Fly</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => setShowNoteInput(!showNoteInput)}>
          <MaterialIcons name="edit-note" size={20} color={colors.textSecondary} />
          <Text style={styles.actionLabel}>Add Note</Text>
        </Pressable>
      </View>

      {/* Note Input */}
      {showNoteInput && (
        <View style={styles.noteInputRow}>
          <TextInput
            style={styles.noteInput}
            placeholder="Write a note..."
            placeholderTextColor={colors.textTertiary}
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

      {/* Event timeline: group + per-angler tabs when this trip is linked to a shared session */}
      {useSharedGroupTimeline ? (
        <View style={{ flex: 1, minHeight: 0, zIndex: 0 }}>
          <SharedTripTimelineSection
            trip={activeTrip}
            userId={userId}
            isConnected={isConnected}
            events={events}
            editMode={!tripPaused}
            onEventsChange={applyEvents}
            onTripPatch={patchActiveTrip}
            onCatchPhotoPress={onCatchPhotoPress}
          />
        </View>
      ) : (
        <>
          <ScrollView style={[styles.timeline, { zIndex: 0 }]} keyboardShouldPersistTaps="handled">
            <View style={styles.timelineTitleRow}>
              <Text style={styles.timelineTitle}>Timeline</Text>
              <Pressable
                onPress={() => Alert.alert('Timeline', TIMELINE_ROW_HELP)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="How to edit the timeline"
              >
                <MaterialIcons name="info-outline" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
            {[...sortedEvents].reverse().map((event: TripEvent, revIdx: number) => {
              const index = sortedEvents.length - 1 - revIdx;
              const lifecycleIcon =
                event.event_type === 'note'
                  ? tripLifecycleNoteTimelineIcon((event.data as NoteData).text, colors)
                  : null;
              return (
                <View key={event.id} style={styles.timelineItem}>
                  <Text style={styles.timelineTime}>{formatEventTime(event.timestamp)}</Text>
                  <View style={styles.timelineContent}>
                    <View style={styles.timelineDot}>
                      {event.event_type === 'catch' ? (
                        <MaterialCommunityIcons name="fish" size={14} color={colors.primary} />
                      ) : event.event_type === 'fly_change' ? (
                        <MaterialCommunityIcons name="hook" size={14} color={colors.accent} />
                      ) : event.event_type === 'ai_query' ? (
                        <MaterialIcons name="smart-toy" size={14} color={colors.info} />
                      ) : event.event_type === 'bite' ? (
                        <MaterialCommunityIcons name="fish" size={14} color={colors.accent} />
                      ) : event.event_type === 'fish_on' ? (
                        <MaterialIcons name="touch-app" size={14} color={colors.primary} />
                      ) : event.event_type === 'got_off' ? (
                        <MaterialIcons name="highlight-off" size={14} color={colors.textSecondary} />
                      ) : lifecycleIcon ? (
                        <MaterialIcons name={lifecycleIcon.name} size={14} color={lifecycleIcon.color} />
                      ) : (
                        <MaterialIcons name="edit-note" size={14} color={colors.textSecondary} />
                      )}
                    </View>
                    <View style={styles.timelineTextBlock}>
                      <Text style={styles.timelineText}>
                        {getTripEventDescription(event)}
                      </Text>
                      {event.event_type === 'catch' ? (
                        <CatchDetailsBlock data={event.data as CatchData} styles={styles} />
                      ) : null}
                      {event.event_type === 'catch' ? (
                        <TimelineCatchPhotoStrip
                          data={event.data as CatchData}
                          onPress={() => onCatchPhotoPress?.(event)}
                          imageStyle={styles.timelineCatchThumb}
                        />
                      ) : null}
                    </View>
                    <Pressable
                      style={styles.timelineRowMenuBtn}
                      onPress={() => setRowActions({ event, index })}
                      hitSlop={12}
                      accessibilityLabel="Timeline row actions"
                    >
                      <MaterialIcons name="more-vert" size={22} color={colors.textSecondary} />
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
        </>
      )}
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
  styles,
  colors,
}: {
  tripPhotos: Photo[];
  loading: boolean;
  uploading: boolean;
  onAddPhoto: () => void;
  onPhotoPress?: (photo: Photo) => void;
  styles: any;
  colors: ThemeColors;
}) {
  return (
    <ScrollView style={styles.photosTabScroll} contentContainerStyle={styles.photosTabContent}>
      <View style={styles.photosTabHeader}>
        <Text style={styles.photosTabTitle}>Trip photos</Text>
        <Pressable style={styles.addTripPhotoButton} onPress={onAddPhoto} disabled={uploading}>
          {uploading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <MaterialIcons name="add-a-photo" size={18} color={colors.primary} />
              <Text style={styles.addTripPhotoButtonText}>Add</Text>
            </>
          )}
        </Pressable>
      </View>
      {loading && tripPhotos.length === 0 ? (
        <View style={styles.photosTabPlaceholder}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : tripPhotos.length === 0 ? (
        <Pressable style={styles.photosTabEmpty} onPress={onAddPhoto}>
          <MaterialIcons name="photo-library" size={48} color={colors.textTertiary} />
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
            <MaterialIcons name="add" size={32} color={colors.primary} />
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
  locationType?: LocationType;
  /** Catalog viewport pins only */
  isFavorite?: boolean;
  endpointLabel?: 'Start' | 'End';
  endpointIcon?: 'place' | 'flag';
  catchEventId?: string;
  catchPhotoUrl?: string | null;
};

function buildTripMapMarkers(trip: Trip, tripEvents: TripEvent[], themeColors: ThemeColors): TripMapMarker[] {
  const markers: TripMapMarker[] = [];

  const startLat = trip.start_latitude ?? null;
  const startLon = trip.start_longitude ?? null;
  if (startLat != null && startLon != null) {
    markers.push({
      id: 'trip-start',
      lon: startLon,
      lat: startLat,
      title: 'Start',
      color: themeColors.primary,
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
      color: themeColors.secondary,
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
      color: themeColors.primaryLight,
      catchEventId: e.id,
      catchPhotoUrl: getCatchHeroPhotoUrl(catchData),
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
  colors,
  mapColorScheme,
  styles,
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
  colors: ThemeColors;
  mapColorScheme: 'light' | 'dark';
  styles: any;
}) {
  const locations = useLocationStore((s) => s.locations);
  const fetchLocations = useLocationStore((s) => s.fetchLocations);
  const favoriteIds = useLocationFavoritesStore((s) => s.ids);
  const favoriteLocationIds = useMemo(() => new Set(favoriteIds), [favoriteIds]);
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
        color: colors.secondary,
        catchEventId: c.id,
        catchPhotoUrl: null as string | null,
      }));
  }, [cachedPins, dataViewport, tripCatchIds]);

  const catalogMarkersForViewport = useMemo(
    () =>
      catalogLocationMarkersInViewport(
        locations,
        dataViewport,
        trip.location_id ?? undefined,
        colors.textTertiary,
        mapColorScheme,
        favoriteLocationIds,
      ),
    [locations, dataViewport, trip.location_id, colors.textTertiary, mapColorScheme, favoriteLocationIds],
  );

  const allMarkers = useMemo(() => {
    const tripMarkers = buildTripMapMarkers(trip, tripEvents, colors);
    return [...catalogMarkersForViewport, ...tripMarkers, ...cacheMarkersForViewport];
  }, [trip, tripEvents, colors, catalogMarkersForViewport, cacheMarkersForViewport]);

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
              <CatalogLocationMapIcon
                type={m.locationType}
                color={m.color}
                size={34}
                isFavorite={m.isFavorite === true}
              />
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
        <MaterialIcons name="map" size={48} color={colors.textTertiary} />
        <Text style={styles.mapTabPlaceholderText}>Map is available in the iOS and Android app.</Text>
      </View>
    );
  }

  return (
    <View style={styles.mapTabContainer}>
      {mapLocationError ? (
        <View style={styles.mapTabBanner}>
          <MaterialIcons name="location-off" size={18} color={colors.warning} />
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
          style={({ pressed }) => [
            styles.mapTabOfflineFab,
            offlineBusy && styles.mapTabFabDisabled,
            pressed && !offlineBusy && styles.mapTabFabPressed,
          ]}
          onPress={() => void handleDownloadOffline()}
          disabled={offlineBusy}
        >
          <MaterialIcons name="download" size={22} color={colors.textInverse} />
          <Text style={styles.mapTabOfflineFabLabel}>{offlineBusy ? '…' : 'Area'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ─── AI Guide Tab ─── */

function AIGuideTab({
  messages,
  input,
  setInput,
  loading,
  onSend,
  scrollRef,
  strategySlot,
  styles,
  colors,
}: {
  messages: TripGuideChatMessage[];
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  onSend: () => void;
  scrollRef: RefObject<ScrollView | null>;
  strategySlot?: ReactNode;
  styles: any;
  colors: ThemeColors;
}) {
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
        {messages.map((msg) => (
          <View
            key={msg.id}
            style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble]}
          >
            {msg.role === 'user' ? (
              <Text style={[styles.bubbleText, styles.userBubbleText]}>{msg.text}</Text>
            ) : (
              <SpotTaggedText
                text={msg.text}
                baseStyle={[styles.bubbleText, styles.aiBubbleText]}
              />
            )}
            {msg.role === 'ai' && msg.locationRecommendation ? (
              <GuideLocationRecommendationCards recommendation={msg.locationRecommendation} colors={colors} />
            ) : null}
            {msg.role === 'ai' ? (
              <GuideChatLinkedSpots
                linkedSpots={msg.linkedSpots}
                ambiguous={msg.ambiguousSpots}
                colors={colors}
              />
            ) : null}
            {msg.role === 'ai' && msg.webSources && msg.webSources.length > 0 ? (
              <GuideChatWebSources
                sources={msg.webSources}
                fetchedAt={msg.sourcesFetchedAt}
                colors={colors}
              />
            ) : null}
          </View>
        ))}

        {loading && (
          <View style={[styles.bubble, styles.aiBubble]}>
            <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
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
          placeholderTextColor={colors.textTertiary}
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

function CatchDetailsBlock({ data, styles }: { data: CatchData; styles: any }) {
  const lines: string[] = [];
  if (data.note?.trim()) lines.push(data.note.trim());
  const w = formatCatchWeightLabel(data.weight_lb, data.weight_oz);
  if (w) lines.push(`Weight: ${w}`);
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

const TIMELINE_ROW_HELP =
  'Tap ⋮ on a row to edit, add notes, fish, or fly changes above/below, or delete.';

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
  const { colors } = useAppTheme();
  const styles = useMemo(() => createTripDashboardStyles(colors), [colors]);
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
          placeholderTextColor={colors.textTertiary}
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
  const { colors } = useAppTheme();
  const styles = useMemo(() => createTripDashboardStyles(colors), [colors]);
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
              const prev = event.data as AIQueryData;
              const next: TripEvent = {
                ...event,
                data: {
                  ...prev,
                  question: q.trim() || 'Question',
                  response: r.trim() || null,
                },
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

function createTripDashboardStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: FontSize.lg,
    color: colors.textSecondary,
  },
  backButton: {
    marginTop: Spacing.md,
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  backButtonText: {
    color: colors.textInverse,
    fontWeight: '600',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: colors.primary,
  },
  headerTitleBlock: {
    flex: 1,
    minWidth: 0,
    paddingRight: Spacing.sm,
  },
  locationName: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: colors.textInverse,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  offlineBadge: {
    backgroundColor: colors.warning,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  offlineBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.text,
  },
  cachedDataBanner: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    backgroundColor: colors.warning + '18',
  },
  cachedDataBannerText: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
  },
  pauseResumeButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  pauseResumeButtonText: {
    color: colors.textInverse,
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
    color: colors.textInverse,
    fontWeight: '600',
    fontSize: FontSize.md,
  },

  // Tab Bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
    borderBottomColor: colors.primary,
  },
  // tabIcon intentionally removed — using Material Icons
  tabLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  tabLabelActive: {
    color: colors.primary,
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
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  strategySectionLabelFirst: {
    marginTop: 0,
  },
  strategyCard: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  strategyLoader: {
    marginVertical: Spacing.xs,
  },
  strategyBestTime: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  strategyPlaceholder: {
    fontSize: FontSize.md,
    color: colors.textTertiary,
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
    backgroundColor: colors.secondary,
  },
  strategyFlyName: {
    fontSize: FontSize.md,
    color: colors.text,
    flex: 1,
  },
  strategyHowToFishText: {
    fontSize: FontSize.md,
    color: colors.text,
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
    color: colors.text,
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
    color: colors.primary,
  },
  photosTabPlaceholder: {
    minHeight: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photosTabEmpty: {
    minHeight: 200,
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photosTabEmptyText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: Spacing.sm,
  },
  photosTabEmptyHint: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
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
    backgroundColor: colors.borderLight,
  },
  tripPhotoAddSlot: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    borderColor: colors.border,
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
    backgroundColor: colors.borderLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fishingPausedNoticeText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  currentFlyBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    zIndex: 1,
    elevation: 1,
  },
  /** Two-fly rig: align label to top next to stacked fly names */
  currentFlyBarRig: {
    alignItems: 'flex-start',
  },
  currentFlyLabel: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
  },
  currentFlyLabelRig: {
    marginTop: 2,
  },
  currentFlyName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  currentFlyNamesColumn: {
    flex: 1,
    marginLeft: Spacing.md,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  currentFlyRigLine: {
    textAlign: 'right',
    maxWidth: '100%',
  },
  currentFlyRigSecond: {
    marginTop: 4,
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
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  fishPlusButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fishButtonText: {
    fontSize: 32,
    fontWeight: '300',
    color: colors.text,
  },
  fishPlusButtonText: {
    fontSize: 32,
    fontWeight: '300',
    color: colors.textInverse,
  },
  fishCountDisplay: {
    alignItems: 'center',
    minWidth: 80,
  },
  fishCountNumber: {
    fontSize: FontSize.hero,
    fontWeight: '700',
    color: colors.primary,
  },
  fishCountLabel: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
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
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // actionEmoji intentionally removed — using Material Icons
  actionLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  noteInputRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  noteInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteSubmit: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  noteSubmitText: {
    color: colors.textInverse,
    fontWeight: '600',
  },
  flyFieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
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
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
  },
  catchModalHeader: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
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
    color: colors.text,
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
    backgroundColor: colors.background,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catchFlyDropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    backgroundColor: colors.background,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catchFlyDropdownValue: {
    fontSize: FontSize.sm,
    color: colors.text,
    flex: 1,
  },
  catchFlyDropdownPlaceholder: {
    color: colors.textTertiary,
  },
  catchFlyPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  catchFlyPickerSheet: {
    backgroundColor: colors.surface,
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
    borderBottomColor: colors.border,
  },
  catchFlyPickerOptionActive: {
    backgroundColor: colors.background,
  },
  catchFlyPickerOptionText: {
    fontSize: FontSize.md,
    color: colors.text,
  },
  catchFlyPickerOptionTextActive: {
    color: colors.primary,
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
    color: colors.textSecondary,
  },
  catchFlyRadioLabelActive: {
    color: colors.text,
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
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 360,
  },
  tripPhotoModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: Spacing.xs,
  },
  tripPhotoModalHint: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
    marginBottom: Spacing.md,
  },
  tripPhotoModalInput: {
    backgroundColor: colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tripPhotoModalCancelText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
  },
  tripPhotoModalSave: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.md,
    backgroundColor: colors.primary,
    minHeight: 40,
  },
  tripPhotoModalSaveDisabled: {
    opacity: 0.7,
  },
  tripPhotoModalSaveText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.textInverse,
  },
  catchModalInput: {
    backgroundColor: colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catchPhotoButtonLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.primary,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityBtnText: {
    fontSize: FontSize.lg,
    color: colors.text,
    fontWeight: '600',
  },
  quantityValue: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: colors.text,
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
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  catchModalCancel: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  catchModalCancelText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  timeline: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  timelineTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
  },
  timelineTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
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
    backgroundColor: colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    paddingBottom: Spacing.xl,
  },
  tripTimelineActionRow: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tripTimelineActionLabel: {
    fontSize: FontSize.md,
    color: colors.text,
  },
  tripTimelineActionDestructive: {
    color: colors.error,
  },
  tripTimelineActionCancel: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.primary,
    textAlign: 'center',
  },
  tripTimelineModalRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tripTimelineModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tripTimelineModalTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  tripTimelineModalCancel: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
  },
  tripTimelineModalSave: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
  tripTimelineModalScroll: {
    flex: 1,
    padding: Spacing.lg,
  },
  tripTimelineFieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  tripTimelineInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  tripTimelineTallInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  tripTimelineNoteBody: {
    flex: 1,
    margin: Spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: colors.text,
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
    color: colors.textTertiary,
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
    color: colors.text,
  },
  timelineCatchDetails: {
    marginTop: Spacing.xs,
    gap: 2,
  },
  timelineCatchDetailLine: {
    fontSize: FontSize.xs,
    color: colors.textSecondary,
  },
  timelineCatchThumb: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.surface,
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
    backgroundColor: colors.surface,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  mapTabPlaceholderText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  mapTabRetryButton: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.md,
  },
  mapTabRetryButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.textInverse,
  },
  mapTabBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mapTabBannerText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: colors.textSecondary,
  },
  mapTabBannerRetry: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  mapTabFabColumn: {
    position: 'absolute',
    right: Spacing.md,
    /* Clear bottom strip: Mapbox (i) + zoom stack live above trip safe area */
    bottom: Spacing.lg + 96,
    gap: Spacing.sm,
    alignItems: 'flex-end',
  },
  mapTabOfflineFab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: colors.info,
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
  mapTabOfflineFabLabel: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: colors.textInverse,
  },

  tripAiChatFab: {
    position: 'absolute',
    right: Spacing.md,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 4,
    zIndex: 20,
  },
  tripAiModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  tripAiModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  tripAiModalDone: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.primary,
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
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  aiGetRecButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
  smartRecCard: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    shadowColor: colors.shadow,
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
    color: colors.textSecondary,
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
    color: colors.primary,
  },
  smartRecFly: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  smartRecColor: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  smartRecReason: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
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
    backgroundColor: colors.background,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs,
  },
  confidenceText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  switchFlyButton: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  switchFlyButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.textInverse,
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
    color: colors.textTertiary,
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
    backgroundColor: colors.primary,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
  },
  bubbleText: {
    fontSize: FontSize.md,
    lineHeight: 22,
    flex: 1,
  },
  userBubbleText: {
    color: colors.textInverse,
  },
  aiBubbleText: {
    color: colors.text,
  },
  aiInputRow: {
    flexDirection: 'row',
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  aiInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: colors.text,
  },
  aiSendButton: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  aiSendButtonDisabled: {
    opacity: 0.5,
  },
  aiSendButtonText: {
    color: colors.textInverse,
    fontWeight: '600',
    fontSize: FontSize.md,
  },

  });
}

