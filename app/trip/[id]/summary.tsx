import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
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
  Linking,
  Switch,
  TextInput,
  Share,
} from 'react-native';
import { cacheDirectory, downloadAsync } from 'expo-file-system/legacy';
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
import { fetchTripById, fetchTripEvents, fetchTripsFromCloud, syncTripToCloud } from '@/src/services/sync';
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
  WaterClarity,
} from '@/src/types';
import { getCatchHeroPhotoUrl } from '@/src/utils/catchPhotos';
import { formatTripDate, formatTripDuration, formatEventTime, formatFlowRate, formatTemperature } from '@/src/utils/formatters';
import { formatCatchWeightLabel, getTripEventDescription } from '@/src/utils/journalTimeline';
import { inferActiveFishingMsFromPauseResumeEvents } from '@/src/utils/tripTiming';
import {
  getSessionTripPhotos,
  getTripPhotosCacheDebugKeys,
  setSessionTripPhotos,
} from '@/src/utils/tripPhotosSessionCache';
import { useAuthStore } from '@/src/stores/authStore';
import { useFriendsStore } from '@/src/stores/friendsStore';
import { useTripStore } from '@/src/stores/tripStore';
import { getPendingTrips } from '@/src/services/pendingSyncStorage';
import { getFlowStatus, FLOW_STATUS_LABELS, FLOW_STATUS_COLORS, CLARITY_LABELS } from '@/src/services/waterFlow';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { DriftGuideReferenceCard } from '@/src/components/DriftGuideReferenceCard';
import { JournalTripRouteMapView, buildJournalWaypoints } from '@/src/components/map/JournalTripRouteMapView';
import { ConditionsTab } from '@/src/components/trip-tabs/ConditionsTab';
import { SharedTripPhotosSection } from '@/src/components/trip/SharedTripPhotosSection';
import { SharedTripTimelineSection } from '@/src/components/trip/SharedTripTimelineSection';
import {
  photosToViewerSlides,
  TripFullScreenPhotoViewerModal,
} from '@/src/components/trip/TripFullScreenPhotoViewerModal';
import { TripSessionPeopleSheet } from '@/src/components/trip/TripSessionPeopleSheet';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { tripMapDefaultCenterCoordinate } from '@/src/utils/mapViewport';
import { tripStartEndDisplayCoords } from '@/src/utils/tripStartEndFromEvents';
import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import { isTripPinned, reconcileTripPhotoCache, togglePinTrip } from '@/src/services/tripPhotoOfflineCache';
import { createTripSurveyStyles, TRIP_SURVEY_CLARITY_OPTIONS } from './survey';
import { buildShareTripUrl, getShareTripPageBaseUrl } from '@/src/constants/shareLinks';

const SHARE_TRIP_MAX_PHOTO_URLS = 6;

type TabKey = 'fishing' | 'photos' | 'conditions' | 'map';

type TripPinPlacementState = {
  kind: TripEndpointKind;
  lat: number;
  lng: number;
  focusKey: number;
};

/**
 * Leave trip summary. When opened from Profile (`?returnTo=profile`), `router.back()` often lands on Home
 * because the journal tab is not the tab that was active — replace to Profile instead.
 */
function exitTripSummary(
  router: ReturnType<typeof useRouter>,
  returnTo: string | string[] | undefined,
  friendId: string | string[] | undefined,
) {
  const target = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  const fid = Array.isArray(friendId) ? friendId[0] : friendId;
  if (target === 'profile') {
    router.replace('/profile');
    return;
  }
  if (target === 'friend' && typeof fid === 'string' && fid.length > 0) {
    router.replace({ pathname: '/friends/friend/[id]', params: { id: fid } });
    return;
  }
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/profile');
}

const TRIP_PHOTOS_DEBUG = typeof __DEV__ !== 'undefined' && __DEV__;

export default function TripSummaryScreen() {
  const { id, returnTo, friendId } = useLocalSearchParams<{
    id: string;
    returnTo?: string;
    friendId?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const { user, profile } = useAuthStore();
  const { deleteTrip } = useTripStore();
  const { isConnected } = useNetworkStatus();
  const { colors: themeColors } = useAppTheme();
  const styles = useMemo(() => createTripSummaryStyles(themeColors), [themeColors]);
  const surveyStyles = useMemo(() => createTripSurveyStyles(themeColors), [themeColors]);
  const [journalEditMode, setJournalEditMode] = useState(false);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [events, setEvents] = useState<TripEvent[]>([]);
  const [tripPhotos, setTripPhotos] = useState<Photo[]>([]);
  const [tripPhotosLoading, setTripPhotosLoading] = useState(false);
  const tripPhotosRowCountRef = useRef(0);
  tripPhotosRowCountRef.current = tripPhotos.length;
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
  const [tripPhotoViewerIndex, setTripPhotoViewerIndex] = useState<number | null>(null);
  const [tripPinPlacement, setTripPinPlacement] = useState<TripPinPlacementState | null>(null);
  const [tripPinPlacementSaving, setTripPinPlacementSaving] = useState(false);
  /** Map tab: catch pin tapped when there is no photo (full-screen flow uses `fullScreenPhoto`) */
  const [mapCatchDetailEvent, setMapCatchDetailEvent] = useState<TripEvent | null>(null);
  const [keepOfflinePinned, setKeepOfflinePinned] = useState(false);
  const [tripAiSummaryModalVisible, setTripAiSummaryModalVisible] = useState(false);
  const [peopleSheetVisible, setPeopleSheetVisible] = useState(false);
  const [summaryHeaderMenuVisible, setSummaryHeaderMenuVisible] = useState(false);
  const [photoVisSaving, setPhotoVisSaving] = useState(false);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [reviewRating, setReviewRating] = useState<number | null>(null);
  const [reviewClarity, setReviewClarity] = useState<WaterClarity | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [ratingNoteSaving, setRatingNoteSaving] = useState(false);
  const friendships = useFriendsStore((s) => s.friendships);
  const refreshFriends = useFriendsStore((s) => s.refresh);

  const isOwnTrip = useMemo(
    () => Boolean(trip && user?.id && trip.user_id === user.id),
    [trip, user?.id],
  );

  useEffect(() => {
    if (!isOwnTrip) setJournalEditMode(false);
  }, [isOwnTrip]);

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
    let cancelled = false;
    async function load() {
      const uid = user?.id;
      if (!uid || !id) return;
      const pendingMap = await getPendingTrips();
      if (cancelled) return;
      const pendingPayload = pendingMap[id] ?? null;

      let cloudTrip: Trip | null = null;
      let apiEvents: TripEvent[] = [];

      if (isConnected) {
        try {
          const trips = await fetchTripsFromCloud(uid);
          if (cancelled) return;
          cloudTrip = trips.find((t) => t.id === id) ?? null;
          if (!cloudTrip) {
            cloudTrip = await fetchTripById(id);
            if (cancelled) return;
          }
          apiEvents = await fetchTripEvents(id);
          if (cancelled) return;
        } catch {
          cloudTrip = null;
          apiEvents = [];
        }
      }

      if (cancelled) return;

      // Pending bundle is the source of truth until sync removes it (offline or mid-upload).
      const mergedTrip = pendingPayload?.trip ?? cloudTrip ?? null;
      const mergedEvents =
        apiEvents.length > 0 ? apiEvents : (pendingPayload?.events ?? []);

      // Do not re-run load when pendingSyncTrips changes: background sync can clear the pending
      // queue while the user is still "offline" (simulated or real), leaving no cloud row yet —
      // that would flash trip → "Trip not found". Keep last good local state until we're online.
      setTrip((prev) => {
        if (mergedTrip) return mergedTrip;
        if (!isConnected && prev?.id === id) return prev;
        return null;
      });
      setEvents((prev) => {
        if (mergedEvents.length > 0) return mergedEvents;
        if (!isConnected && prev.some((e) => e.trip_id === id)) return prev;
        return mergedEvents;
      });
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, user?.id, isConnected]);

  const handleSessionChanged = useCallback((sid: string | null) => {
    setTrip((prev) => (prev ? { ...prev, shared_session_id: sid } : null));
  }, []);

  const tripPhotosFetchSeqRef = useRef(0);
  const warmTripPhotosKeyRef = useRef<string | null>(null);
  const lastTripPhotosIdentityRef = useRef<string | null>(null);

  /** Same screen instance is reused when opening another trip — clear before paint to avoid flashing the prior trip. */
  useLayoutEffect(() => {
    if (!id) return;
    tripPhotosFetchSeqRef.current += 1;
    setTripPhotosLoading(false);
    setLoading(true);
    setTrip(null);
    setEvents([]);
    setTripPhotos([]);
    lastTripPhotosIdentityRef.current = null;
    warmTripPhotosKeyRef.current = null;
    setActiveTab('fishing');
    setFullScreenPhoto(null);
    setTripPhotoViewerIndex(null);
    setMapCatchDetailEvent(null);
    setTripAiSummaryModalVisible(false);
    setPeopleSheetVisible(false);
    setSummaryHeaderMenuVisible(false);
    setReviewModalVisible(false);
  }, [id]);

  const refreshTripPhotos = useCallback(
    async (showLoading: boolean) => {
      const albumUid = trip?.user_id;
      if (!user || !id || !albumUid) {
        if (TRIP_PHOTOS_DEBUG) console.log('[TripPhotos:summary] refresh:skip (no user/id/album owner)');
        return;
      }
      if (showLoading) {
        setTripPhotosLoading(true);
      } else {
        setTripPhotosLoading(false);
      }
      const seq = ++tripPhotosFetchSeqRef.current;
      if (TRIP_PHOTOS_DEBUG) {
        console.log('[TripPhotos:summary] refresh:start', {
          showLoading,
          seq,
          cacheKey: `${albumUid}:${id}`,
        });
      }
      try {
        const photos = await fetchPhotos(albumUid, { tripId: id });
        if (seq !== tripPhotosFetchSeqRef.current) {
          if (TRIP_PHOTOS_DEBUG) console.log('[TripPhotos:summary] refresh:stale after fetch', { seq });
          return;
        }
        setTripPhotos(photos);
        setSessionTripPhotos(albumUid, id, photos);
        warmTripPhotosKeyRef.current = `${albumUid}:${id}`;
        if (TRIP_PHOTOS_DEBUG) console.log('[TripPhotos:summary] refresh:ok', { seq, count: photos.length });
      } catch (e) {
        if (seq !== tripPhotosFetchSeqRef.current) return;
        if (TRIP_PHOTOS_DEBUG) console.log('[TripPhotos:summary] refresh:error', { seq, showLoading, e });
        if (showLoading) {
          setTripPhotos([]);
          setSessionTripPhotos(albumUid, id, []);
        }
      } finally {
        if (showLoading && seq === tripPhotosFetchSeqRef.current) {
          setTripPhotosLoading(false);
        }
      }
    },
    [user?.id, id, trip?.user_id],
  );

  useEffect(() => {
    if (!user?.id || !id || !trip?.user_id) {
      if (TRIP_PHOTOS_DEBUG) console.log('[TripPhotos:summary] identity:clear (no user/id/album owner)');
      setTripPhotos([]);
      lastTripPhotosIdentityRef.current = null;
      warmTripPhotosKeyRef.current = null;
      return;
    }
    const albumUid = trip.user_id;
    const identity = `${albumUid}:${id}`;
    if (lastTripPhotosIdentityRef.current === identity) {
      return;
    }
    lastTripPhotosIdentityRef.current = identity;
    warmTripPhotosKeyRef.current = null;
    const cached = getSessionTripPhotos(albumUid, id);
    if (TRIP_PHOTOS_DEBUG) {
      console.log('[TripPhotos:summary] identity:hydrate', {
        identity,
        cacheHit: cached !== undefined,
        cachedCount: cached?.length ?? null,
        cacheKeysNow: getTripPhotosCacheDebugKeys(),
      });
    }
    setTripPhotos(cached !== undefined ? cached : []);
  }, [id, user?.id, trip?.user_id]);

  useEffect(() => {
    if (!id || !user?.id || !trip?.user_id) return;
    const albumUid = trip.user_id;
    const key = `${albumUid}:${id}`;
    /** Read Map directly — identity effect’s setState may not be committed before this effect runs. */
    const cachedList = getSessionTripPhotos(albumUid, id);
    if (cachedList !== undefined) {
      setTripPhotos(cachedList);
    }
    const hasSessionCache = cachedList !== undefined;
    const hasWarmedThisTrip = warmTripPhotosKeyRef.current === key;
    const hasRowsAlready = tripPhotosRowCountRef.current > 0;
    const showBlocking = !hasSessionCache && !hasWarmedThisTrip && !hasRowsAlready;
    if (TRIP_PHOTOS_DEBUG) {
      console.log('[TripPhotos:summary] mountFetchEffect', {
        key,
        hasSessionCache,
        cachedCount: cachedList?.length ?? null,
        hasWarmedThisTrip,
        warmKey: warmTripPhotosKeyRef.current,
        rowCountRef: tripPhotosRowCountRef.current,
        showBlocking,
        allCacheKeys: getTripPhotosCacheDebugKeys(),
      });
    }
    void refreshTripPhotos(showBlocking);
  }, [id, user?.id, trip?.user_id, refreshTripPhotos]);

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
    () => photosToViewerSlides(tripPhotos, trip?.location?.name),
    [tripPhotos, trip?.location?.name],
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

  const handleCatchPhotoPress = useCallback((event: TripEvent) => {
    const data = event.data as CatchData;
    const hero = getCatchHeroPhotoUrl(data);
    if (!hero) return;
    setTripPhotoViewerIndex(null);
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
        setTripPhotoViewerIndex(null);
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
      if (nextTrip.user_id !== user?.id) {
        return false;
      }
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
        const found = await fetchTripById(id);
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
    const i = tripPhotos.findIndex((p) => p.id === photo.id);
    if (i >= 0) {
      setFullScreenPhoto(null);
      setTripPhotoViewerIndex(i);
    }
  }, [tripPhotos]);

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

  const handleShareTripLink = useCallback(async () => {
    if (!trip?.id) return;
    if (!getShareTripPageBaseUrl()) {
      Alert.alert(
        'Share link unavailable',
        'Set EXPO_PUBLIC_SHARE_TRIP_BASE_URL to your deployed share-trip function URL (see .env.example).',
      );
      return;
    }
    const webPageUrl = buildShareTripUrl(trip.id);
    if (!webPageUrl) return;

    const appLink = `driftguide://trip/${trip.id}`;
    const place = trip.location?.name?.trim();
    const httpsPhotos = tripPhotos
      .map((p) => p.url)
      .filter((u): u is string => typeof u === 'string' && /^https:\/\//i.test(u))
      .slice(0, SHARE_TRIP_MAX_PHOTO_URLS);

    const buildMessageTextOnly = (): string => {
      const lines: string[] = [
        webPageUrl,
        '',
        `Open in DriftGuide: ${appLink}`,
        '',
        place ? `Trip: ${place}` : 'DriftGuide trip',
      ];
      if (effectivePhotoVisibility === 'public' && httpsPhotos.length > 0) {
        lines.push('', 'Photos:', ...httpsPhotos);
      }
      return lines.join('\n');
    };

    /**
     * iOS + `Share.share({ url: localImage, message })`: if the HTML preview URL is the first line,
     * the sheet often unfurls that link and replaces the photo tile with a web snapshot (looks like
     * raw OG/HTML). Put the preview link last and omit the attached photo from the text list.
     */
    const buildMessageIosWithAttachedPhoto = (): string => {
      const lines: string[] = [
        place ? `Trip: ${place}` : 'DriftGuide trip',
        '',
        'Open in DriftGuide:',
        appLink,
      ];
      if (effectivePhotoVisibility === 'public' && httpsPhotos.length > 1) {
        const more = httpsPhotos.slice(1, 4);
        lines.push('', 'More photos:', ...more);
      }
      lines.push('', 'Trip preview (opens in browser):', webPageUrl);
      return lines.join('\n');
    };

    try {
      if (
        Platform.OS === 'ios' &&
        effectivePhotoVisibility === 'public' &&
        httpsPhotos.length > 0 &&
        cacheDirectory
      ) {
        const remote = httpsPhotos[0];
        const ext = remote.toLowerCase().includes('.png') ? 'png' : 'jpg';
        const dest = `${cacheDirectory}driftguide-trip-share-${trip.id.replace(/-/g, '').slice(0, 12)}.${ext}`;
        try {
          const { uri, status } = await downloadAsync(remote, dest);
          if (status === 200 && uri.startsWith('file')) {
            await Share.share({ url: uri, message: buildMessageIosWithAttachedPhoto() });
            return;
          }
        } catch {
          /* fall through */
        }
      }
      await Share.share({ message: buildMessageTextOnly() });
    } catch {
      /* dismissed */
    }
  }, [trip?.id, trip?.location?.name, effectivePhotoVisibility, tripPhotos]);

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

  const persistTripReview = useCallback(
    async (payload: {
      rating: number | null;
      user_reported_clarity: WaterClarity | null;
      notes: string | null;
    }): Promise<boolean> => {
      if (!trip || !user || !id || trip.user_id !== user.id) return false;
      if (!isConnected) {
        Alert.alert('Offline', 'Connect to the internet to save changes.');
        return false;
      }
      setRatingNoteSaving(true);
      const updated: Trip = {
        ...trip,
        rating: payload.rating,
        user_reported_clarity: payload.user_reported_clarity as Trip['user_reported_clarity'],
        notes: payload.notes,
      };
      setTrip(updated);
      const ok = await syncTripToCloud(updated, events);
      setRatingNoteSaving(false);
      if (!ok) {
        Alert.alert('Could not save', 'Try again when you have a stable connection.');
        const found = await fetchTripById(id);
        if (found) setTrip(found);
        return false;
      }
      return true;
    },
    [trip, user, id, isConnected, events],
  );

  const normalizeTripNote = (raw: string | null | undefined) => {
    const t = raw?.trim() ?? '';
    return t === '' ? null : t;
  };

  const openReviewModal = useCallback(() => {
    if (!trip || !isOwnTrip) return;
    if (!isConnected) {
      Alert.alert('Offline', 'Connect to the internet to save changes.');
      return;
    }
    setReviewRating(trip.rating ?? null);
    const c = trip.user_reported_clarity;
    setReviewClarity(c && c !== 'unknown' ? c : null);
    setReviewNotes(trip.notes ?? '');
    setReviewModalVisible(true);
  }, [trip, isConnected, isOwnTrip]);

  const closeReviewModal = useCallback(() => {
    setReviewModalVisible(false);
  }, []);

  const handleReviewDone = useCallback(async () => {
    if (reviewRating == null) return;
    const ok = await persistTripReview({
      rating: reviewRating,
      user_reported_clarity: reviewClarity,
      notes: normalizeTripNote(reviewNotes),
    });
    if (ok) setReviewModalVisible(false);
  }, [reviewRating, reviewClarity, reviewNotes, persistTripReview]);

  /**
   * Route `id` updates on the same component instance before `useLayoutEffect` / `load()` commit —
   * without this, one frame can still render the previous trip.
   */
  const tripStaleVsRoute = Boolean(id && trip && trip.id !== id);

  if (loading || tripStaleVsRoute) {
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
          <Pressable style={styles.backButton} onPress={() => exitTripSummary(router, returnTo, friendId)}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const handleDeleteTrip = () => {
    if (!id || !isOwnTrip) return;
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
              exitTripSummary(router, returnTo, friendId);
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
                    {formatCatchWeightLabel(d.weight_lb, d.weight_oz) ? (
                      <Text style={styles.mapCatchModalRow}>
                        <MaterialCommunityIcons name="scale-balance" size={16} color={themeColors.textSecondary} />{' '}
                        {formatCatchWeightLabel(d.weight_lb, d.weight_oz)}
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
        <Pressable onPress={() => exitTripSummary(router, returnTo, friendId)}>
          <MaterialIcons name="arrow-back" size={22} color={themeColors.textInverse} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Summary
          </Text>
        </View>
        <View style={styles.headerActions}>
          {isOwnTrip ? (
            <Pressable
              onPress={() => setSummaryHeaderMenuVisible(true)}
              style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Trip options"
            >
              <MaterialIcons name="more-vert" size={24} color={themeColors.textInverse} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <Modal
        visible={summaryHeaderMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSummaryHeaderMenuVisible(false)}
      >
        <View style={styles.summaryHeaderMenuOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSummaryHeaderMenuVisible(false)} />
          <View style={[styles.summaryHeaderMenuSheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <Pressable
              style={styles.summaryHeaderMenuRow}
              onPress={() => {
                setSummaryHeaderMenuVisible(false);
                setPeopleSheetVisible(true);
              }}
            >
              <Text style={styles.summaryHeaderMenuLabel}>Invite friends</Text>
            </Pressable>
            <Pressable
              style={styles.summaryHeaderMenuRow}
              onPress={() => {
                setSummaryHeaderMenuVisible(false);
                void handleShareTripLink();
              }}
            >
              <Text style={styles.summaryHeaderMenuLabel}>Share trip link</Text>
            </Pressable>
            <Pressable
              style={styles.summaryHeaderMenuRow}
              onPress={() => {
                setSummaryHeaderMenuVisible(false);
                setJournalEditMode((v) => !v);
              }}
            >
              <Text style={styles.summaryHeaderMenuLabel}>
                {journalEditMode ? 'Done editing journal' : 'Edit journal'}
              </Text>
            </Pressable>
            <Pressable
              style={styles.summaryHeaderMenuRow}
              disabled={deleting}
              onPress={() => {
                setSummaryHeaderMenuVisible(false);
                handleDeleteTrip();
              }}
            >
              <Text style={[styles.summaryHeaderMenuLabel, styles.summaryHeaderMenuDestructive]}>Delete trip</Text>
            </Pressable>
            <Pressable
              style={styles.summaryHeaderMenuRow}
              onPress={() => setSummaryHeaderMenuVisible(false)}
            >
              <Text style={styles.summaryHeaderMenuCancel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {isOwnTrip ? (
        <View>
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
                    const found = await fetchTripById(id);
                    if (found) setTrip(found);
                  }
                })();
              }}
              disabled={!user || !isConnected}
              saving={photoVisSaving}
            />
          </View>
          {effectivePhotoVisibility !== 'public' ? (
            <Text style={styles.sharePreviewHint}>
              Set trip photos to Public to include images in the share (iOS attaches the first photo;
              link previews use your public album).
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Date & Location */}
      <View style={styles.dateLocationRow}>
        <Text style={styles.dateLocationName} numberOfLines={1}>
          {trip.location?.name || 'Unknown Location'}
        </Text>
        <Text style={styles.dateLocationDate}>{formatTripDate(trip.start_time)}</Text>
      </View>

      {/* Stats Card — three columns: Fish | Duration | Rating (shared value row height for alignment) */}
      <View style={styles.statsCard}>
        <View style={styles.statItem}>
          <View style={styles.statValueSlot}>
            <Text style={styles.statValue}>{trip.total_fish}</Text>
          </View>
          <Text style={styles.statLabel}>Fish</Text>
        </View>
        <View style={[styles.statItem, styles.statItemMiddle]}>
          <View style={styles.statValueSlot}>
            <Text
              style={[styles.statValue, styles.statValueDuration]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.55}
            >
              {tripDurationLabel}
            </Text>
          </View>
          <Text style={styles.statLabel}>Duration</Text>
        </View>
        <View style={styles.statItem}>
          <View style={[styles.statValueSlot, styles.statValueSlotRating]}>
            {isOwnTrip ? (
              <>
                <Pressable
                  onPress={() => openReviewModal()}
                  hitSlop={12}
                  style={({ pressed }) => [styles.statRatingPencil, { opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Edit trip review"
                >
                  <MaterialIcons
                    name="edit"
                    size={15}
                    color={
                      trip.rating != null ||
                      (trip.user_reported_clarity != null && trip.user_reported_clarity !== 'unknown') ||
                      normalizeTripNote(trip.notes) != null
                        ? themeColors.primary
                        : themeColors.textSecondary
                    }
                  />
                </Pressable>
                <Pressable
                  onPress={() => openReviewModal()}
                  style={styles.statRatingTap}
                  disabled={ratingNoteSaving}
                  accessibilityRole="button"
                  accessibilityLabel={
                    trip.rating != null ? `Trip rating ${trip.rating} out of 5` : 'Set trip rating'
                  }
                >
                  {ratingNoteSaving ? (
                    <ActivityIndicator size="small" color={themeColors.primary} />
                  ) : (
                    <>
                      <Text style={styles.statValue}>
                        {trip.rating != null ? String(trip.rating) : '—'}
                      </Text>
                      <MaterialIcons
                        name={trip.rating != null ? 'star' : 'star-border'}
                        size={26}
                        color={trip.rating != null ? themeColors.warning : themeColors.border}
                      />
                    </>
                  )}
                </Pressable>
              </>
            ) : (
              <View style={styles.statRatingTap}>
                <Text style={styles.statValue}>
                  {trip.rating != null ? String(trip.rating) : '—'}
                </Text>
                <MaterialIcons
                  name={trip.rating != null ? 'star' : 'star-border'}
                  size={26}
                  color={trip.rating != null ? themeColors.warning : themeColors.border}
                />
              </View>
            )}
          </View>
          <Text style={styles.statLabel}>Rating</Text>
        </View>
      </View>

      <Modal
        visible={reviewModalVisible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={closeReviewModal}
      >
        <SafeAreaView style={surveyStyles.container} edges={['top', 'bottom']}>
          <View style={surveyStyles.modalTopBar}>
            <Pressable onPress={closeReviewModal} hitSlop={12} accessibilityRole="button">
              <Text style={surveyStyles.modalCancel}>Cancel</Text>
            </Pressable>
          </View>
          <ScrollView
            style={surveyStyles.scroll}
            contentContainerStyle={[
              surveyStyles.content,
              { paddingBottom: Math.max(insets.bottom, 32) + Spacing.xxl },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            <Text style={surveyStyles.title}>How was your trip?</Text>
            <Text style={surveyStyles.subtitle}>Quick survey — helps us improve recommendations</Text>

            <Text style={surveyStyles.label}>Rate your trip (1–5 stars)</Text>
            <View style={surveyStyles.starRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable
                  key={star}
                  style={surveyStyles.starButton}
                  onPress={() => setReviewRating(star)}
                  disabled={ratingNoteSaving}
                >
                  <MaterialIcons
                    name={reviewRating !== null && star <= reviewRating ? 'star' : 'star-border'}
                    size={40}
                    color={
                      reviewRating !== null && star <= reviewRating
                        ? themeColors.warning
                        : themeColors.border
                    }
                  />
                </Pressable>
              ))}
            </View>

            <Text style={surveyStyles.label}>How was the water? (optional)</Text>
            <View style={surveyStyles.clarityRow}>
              {TRIP_SURVEY_CLARITY_OPTIONS.map((key) => (
                <Pressable
                  key={key}
                  style={[
                    surveyStyles.clarityPill,
                    reviewClarity === key && surveyStyles.clarityPillSelected,
                  ]}
                  onPress={() => setReviewClarity(reviewClarity === key ? null : key)}
                  disabled={ratingNoteSaving}
                >
                  <Text
                    style={[
                      surveyStyles.clarityPillText,
                      reviewClarity === key && surveyStyles.clarityPillTextSelected,
                    ]}
                  >
                    {CLARITY_LABELS[key]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={surveyStyles.label}>Notes (optional)</Text>
            <TextInput
              style={surveyStyles.notesInput}
              placeholder="Anything else about conditions or the day?"
              placeholderTextColor={themeColors.textTertiary}
              value={reviewNotes}
              onChangeText={setReviewNotes}
              multiline
              editable={!ratingNoteSaving}
              textAlignVertical="top"
            />

            <Pressable
              style={[
                surveyStyles.primaryButton,
                surveyStyles.submitButton,
                (reviewRating === null || ratingNoteSaving) && surveyStyles.primaryButtonDisabled,
              ]}
              onPress={() => void handleReviewDone()}
              disabled={reviewRating === null || ratingNoteSaving}
            >
              {ratingNoteSaving ? (
                <ActivityIndicator color={themeColors.textInverse} />
              ) : (
                <Text style={surveyStyles.primaryButtonText}>Done</Text>
              )}
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>

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
          editMode={isOwnTrip && journalEditMode}
          onEventsChange={setEvents}
          onTripPatch={(patch) => setTrip((t) => (t ? { ...t, ...patch } : null))}
          onCatchPhotoPress={handleCatchPhotoPress}
          onRequestEditTripPin={isOwnTrip ? openTripPinPlacement : undefined}
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
          editMode={isOwnTrip && journalEditMode}
          tripPinPlacement={tripPinPlacement}
          onRequestEditTripPin={isOwnTrip ? openTripPinPlacement : undefined}
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

      {user && trip && id && isOwnTrip ? (
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
                {typeof data.supplementResponse === 'string' && data.supplementResponse.trim() ? (
                  <View style={summaryStyles.aiDriftGuideWrap}>
                    <DriftGuideReferenceCard rawText={data.supplementResponse.trim()} colors={palette} />
                  </View>
                ) : null}
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
      {loading && tripPhotos.length === 0 ? (
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

  summaryHeaderMenuOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  summaryHeaderMenuSheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
  },
  summaryHeaderMenuRow: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  summaryHeaderMenuLabel: {
    fontSize: FontSize.md,
    color: c.text,
  },
  summaryHeaderMenuDestructive: {
    color: c.error,
  },
  summaryHeaderMenuCancel: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: c.primary,
    textAlign: 'center',
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
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    minWidth: 0,
  },
  statItemMiddle: {
    paddingHorizontal: Spacing.xs,
  },
  /** Same fixed height for all three stat columns so values + labels line up */
  statValueSlot: {
    height: 44,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statValueDuration: {
    width: '100%',
    textAlign: 'center',
  },
  statValueSlotRating: {
    position: 'relative',
  },
  statRatingPencil: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 1,
    padding: 2,
  },
  statRatingTap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: c.primary,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: c.textSecondary,
    marginTop: 4,
    textAlign: 'center',
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
  sharePreviewHint: {
    fontSize: FontSize.xs,
    color: c.textSecondary,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    lineHeight: 16,
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
  aiDriftGuideWrap: {
    marginTop: Spacing.xs,
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
