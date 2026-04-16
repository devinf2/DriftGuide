import { CatalogLocationMapIcon } from '@/src/components/map/catalogLocationMapIcon';
import {
  ProfilePhotoLibrarySection,
  type ProfileHubAlbumPagination,
  type ProfilePhotoLibraryHandle,
  type SharedAlbumFilters,
} from '@/src/components/ProfilePhotoLibrarySection';
import { TripMapboxMapView, type MapboxMapMarker } from '@/src/components/map/TripMapboxMapView';
import {
  createJournalTripGridStyles,
  imageUrlsForTrip,
  JournalTripGridCard,
} from '@/src/components/journal/journalTripGrid';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '@/src/constants/mapDefaults';
import { effectiveTripPhotoVisibility } from '@/src/constants/tripPhotoVisibility';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import {
  fetchPhotosWithTripForTripIds,
  fetchPhotosWithTripPage,
  type PhotoWithTrip,
} from '@/src/services/photoService';
import {
  fetchCompletedTripsPage,
  fetchProfileAlbumFilterOptions,
  fetchUserCatchesForTripIds,
  type ProfileAlbumHubRpcFilters,
} from '@/src/services/sync';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationFavoritesStore } from '@/src/stores/locationFavoritesStore';
import { useAppTheme, type ResolvedScheme } from '@/src/theme/ThemeProvider';
import type { CatchRow, LocationType, Photo, Profile, Trip } from '@/src/types';
import { formatFishCount, formatTripDate, formatTripDuration } from '@/src/utils/formatters';
import { formatCatchWeightLabel } from '@/src/utils/journalTimeline';
import { COORD_STACK_EPS, displayLngLatForOverlappingItems } from '@/src/utils/mapPinDisplayOffset';
import { journalMapDefaultFraming } from '@/src/utils/mapViewport';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import * as ExpoLocation from 'expo-location';
import { type Href, useRouter } from 'expo-router';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type MediaTab = 'trips' | 'photos';
type LayoutTab = 'grid' | 'map';

interface LocationGroup {
  locationId: string;
  locationName: string;
  latitude: number;
  longitude: number;
  trips: Trip[];
}

function catchRowGalleryUrls(c: CatchRow): string[] {
  const from = (c.photo_urls ?? []).map((u) => u?.trim()).filter(Boolean) as string[];
  if (from.length) return from;
  const u = c.photo_url?.trim();
  return u ? [u] : [];
}

function tripMatchesAlbumFilters(
  trip: Trip,
  catches: CatchRow[],
  photos: PhotoWithTrip[],
  f: {
    selectedLocationIds: string[];
    selectedFlyPatterns: string[];
    selectedSpecies: string[];
    dateFrom: string;
    dateTo: string;
  },
): boolean {
  const { selectedLocationIds, selectedFlyPatterns, selectedSpecies, dateFrom, dateTo } = f;
  const tripLocId = trip.location?.id ?? trip.location_id;
  if (selectedLocationIds.length > 0) {
    if (!tripLocId || !selectedLocationIds.includes(tripLocId)) return false;
  }
  const tripStart = trip.start_time;
  if (dateFrom.trim()) {
    if (!tripStart || tripStart < dateFrom.trim()) return false;
  }
  if (dateTo.trim()) {
    const to = dateTo.trim();
    const toEnd = to.length === 10 ? `${to}T23:59:59` : to;
    if (!tripStart || tripStart > toEnd) return false;
  }
  if (selectedFlyPatterns.length > 0) {
    const flies = new Set<string>();
    catches
      .filter((c) => c.trip_id === trip.id)
      .forEach((c) => {
        if (c.fly_pattern?.trim()) flies.add(c.fly_pattern.trim());
      });
    photos
      .filter((p) => p.trip_id === trip.id)
      .forEach((p) => {
        if (p.fly_pattern?.trim()) flies.add(p.fly_pattern.trim());
      });
    if (!selectedFlyPatterns.some((x) => flies.has(x))) return false;
  }
  if (selectedSpecies.length > 0) {
    const species = new Set<string>();
    catches
      .filter((c) => c.trip_id === trip.id)
      .forEach((c) => {
        if (c.species?.trim()) species.add(c.species.trim());
      });
    photos
      .filter((p) => p.trip_id === trip.id)
      .forEach((p) => {
        if (p.species?.trim()) species.add(p.species.trim());
      });
    if (!selectedSpecies.some((x) => species.has(x))) return false;
  }
  return true;
}

type ProfileTripsPhotosHubProps = {
  refreshSignal: number;
  /** When set, load this user’s completed trips / album (RLS: e.g. accepted friend + photo visibility). */
  peerUserId?: string | null;
  /** Peer’s profile (for trip photo visibility defaults on friend profile previews). */
  peerAlbumProfile?: Profile | null;
};

export type ProfileTripsPhotosHubRef = {
  /** Call when the profile screen is scrolled near the bottom (loads next trips or photo page). */
  loadMoreFromScroll: () => void;
};

const TRIPS_PAGE = 8;
/** Library grid is 3 columns; 21 = 7 full rows per page. */
const PHOTOS_PAGE = 21;

/** Opened from own profile hub — trip summary replaces back to Profile tab. */
const PROFILE_JOURNAL_QS = '?returnTo=profile';

function journalHrefFromHub(tripId: string, peerUserId: string | null | undefined): Href {
  if (peerUserId) {
    return `/journal/${tripId}?returnTo=friend&friendId=${encodeURIComponent(peerUserId)}` as Href;
  }
  return `/journal/${tripId}${PROFILE_JOURNAL_QS}` as Href;
}

function mergePhotoWithTripById(prev: PhotoWithTrip[], next: PhotoWithTrip[]): PhotoWithTrip[] {
  const m = new Map(prev.map((p) => [p.id, p]));
  for (const p of next) m.set(p.id, p);
  return Array.from(m.values()).sort((a, b) =>
    String(b.captured_at ?? b.created_at ?? '').localeCompare(String(a.captured_at ?? a.created_at ?? '')),
  );
}

function mergePlainPhotosFromWithTrip(prev: Photo[], next: PhotoWithTrip[]): Photo[] {
  const m = new Map(prev.map((p) => [p.id, p]));
  for (const p of next) {
    const { trip: _t, ...rest } = p;
    m.set(p.id, rest as Photo);
  }
  return Array.from(m.values()).sort((a, b) =>
    String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
  );
}

function mergeCatchesById(prev: CatchRow[], next: CatchRow[]): CatchRow[] {
  const m = new Map(prev.map((c) => [c.id, c]));
  for (const c of next) m.set(c.id, c);
  return Array.from(m.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

export const ProfileTripsPhotosHub = forwardRef<ProfileTripsPhotosHubRef, ProfileTripsPhotosHubProps>(
  function ProfileTripsPhotosHub({ refreshSignal, peerUserId = null, peerAlbumProfile = null }, ref) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { user } = useAuthStore();
  const albumOwnerId = peerUserId ?? user?.id ?? null;
  const isPeerAlbum = Boolean(peerUserId);
  const favoriteIds = useLocationFavoritesStore((s) => s.ids);
  const favoriteLocationIds = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const { colors, resolvedScheme } = useAppTheme();
  const hubStyles = useMemo(() => createHubStyles(colors, resolvedScheme), [colors, resolvedScheme]);
  const tripGridStyles = useMemo(() => createJournalTripGridStyles(colors), [colors]);

  const photoLibraryRef = useRef<ProfilePhotoLibraryHandle>(null);

  const [mediaTab, setMediaTab] = useState<MediaTab>('trips');
  const [layoutTab, setLayoutTab] = useState<LayoutTab>('grid');
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [selectedFlyPatterns, setSelectedFlyPatterns] = useState<string[]>([]);
  const [selectedSpecies, setSelectedSpecies] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [allTrips, setAllTrips] = useState<Trip[]>([]);
  const [allCatches, setAllCatches] = useState<CatchRow[]>([]);
  /** Trip pages: album rows for loaded trips (thumbnails + filters). */
  const [tripScopedPhotos, setTripScopedPhotos] = useState<PhotoWithTrip[]>([]);
  /** Photos tab: global library pages (newest first). */
  const [libraryPagedPhotos, setLibraryPagedPhotos] = useState<PhotoWithTrip[]>([]);
  const [tripsDataLoaded, setTripsDataLoaded] = useState(false);
  const [tripsDataLoading, setTripsDataLoading] = useState(false);
  const [tripsLoadingMore, setTripsLoadingMore] = useState(false);
  const [tripsHasMore, setTripsHasMore] = useState(true);
  const [photosLibraryBooting, setPhotosLibraryBooting] = useState(false);
  const [photosLoadingMore, setPhotosLoadingMore] = useState(false);
  const [photosHasMore, setPhotosHasMore] = useState(true);
  const [photoLibraryStarted, setPhotoLibraryStarted] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_MAP_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_MAP_ZOOM);
  const [mapCameraKey, setMapCameraKey] = useState(0);
  const [journalMapUserLocation, setJournalMapUserLocation] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<LocationGroup | null>(null);
  const [selectedFishCatch, setSelectedFishCatch] = useState<CatchRow | null>(null);
  /** Distinct filter choices for full album (RPC); merged with loaded rows until fetch completes. */
  const [albumFilterOptions, setAlbumFilterOptions] = useState<Awaited<
    ReturnType<typeof fetchProfileAlbumFilterOptions>
  > | null>(null);

  const nextTripOffsetRef = useRef(0);
  const nextPhotoOffsetRef = useRef(0);
  const tripsFetchInFlightRef = useRef(false);
  const photosFetchInFlightRef = useRef(false);
  const loadMoreCooldownRef = useRef(0);
  /** Bumped when album owner or filters change — drop stale append results. */
  const hubAlbumDataGenRef = useRef(0);
  /** User hit “load more” while a trips page fetch was already in flight — fetch the next page when the current one finishes. */
  const tripsLoadMorePendingRef = useRef(false);
  const tripsHasMoreRef = useRef(true);
  const tripsLoadingMoreRef = useRef(false);
  tripsHasMoreRef.current = tripsHasMore;
  tripsLoadingMoreRef.current = tripsLoadingMore;
  const photosHasMoreRef = useRef(true);
  const photosLoadingMoreRef = useRef(false);
  photosHasMoreRef.current = photosHasMore;
  photosLoadingMoreRef.current = photosLoadingMore;

  const appendTripsPageRef = useRef<(isInitial: boolean) => Promise<void>>(async () => {});
  const appendPhotoLibraryPageRef = useRef<
    (isInitial: boolean, opts?: { replace?: boolean }) => Promise<void>
  >(async () => {});

  const photosForOptions = useMemo(
    () => mergePhotoWithTripById(tripScopedPhotos, libraryPagedPhotos),
    [tripScopedPhotos, libraryPagedPhotos],
  );

  const allPhotos = useMemo(
    () => mergePlainPhotosFromWithTrip([], photosForOptions),
    [photosForOptions],
  );

  const resetPagedHubState = useCallback(() => {
    hubAlbumDataGenRef.current += 1;
    nextTripOffsetRef.current = 0;
    nextPhotoOffsetRef.current = 0;
    setTripsHasMore(true);
    setPhotosHasMore(true);
    setAllTrips([]);
    setAllCatches([]);
    setTripScopedPhotos([]);
    setLibraryPagedPhotos([]);
    setTripsDataLoaded(false);
    setPhotoLibraryStarted(false);
    setTripsDataLoading(false);
    setTripsLoadingMore(false);
    setPhotosLibraryBooting(false);
    setPhotosLoadingMore(false);
    tripsFetchInFlightRef.current = false;
    photosFetchInFlightRef.current = false;
    tripsLoadMorePendingRef.current = false;
  }, []);

  const resetTripsPagingForFilterChange = useCallback(() => {
    nextTripOffsetRef.current = 0;
    setTripsHasMore(true);
    setAllTrips([]);
    setTripScopedPhotos([]);
    setAllCatches([]);
    setTripsDataLoaded(false);
    setTripsDataLoading(false);
    setTripsLoadingMore(false);
    tripsFetchInFlightRef.current = false;
    tripsLoadMorePendingRef.current = false;
  }, []);

  const resetPhotosPagingForFilterChange = useCallback(() => {
    nextPhotoOffsetRef.current = 0;
    setPhotosHasMore(true);
    setLibraryPagedPhotos([]);
    setPhotoLibraryStarted(false);
    setPhotosLibraryBooting(false);
    setPhotosLoadingMore(false);
    photosFetchInFlightRef.current = false;
  }, []);

  const albumRpcFilters = useMemo((): ProfileAlbumHubRpcFilters => {
    return {
      locationIds: selectedLocationIds,
      species: selectedSpecies,
      flyPatterns: selectedFlyPatterns,
      dateFrom: dateFrom.trim() || null,
      dateTo: dateTo.trim() || null,
    };
  }, [selectedLocationIds, selectedSpecies, selectedFlyPatterns, dateFrom, dateTo]);

  const albumFilterKey = useMemo(() => JSON.stringify(albumRpcFilters), [albumRpcFilters]);

  const appendTripsPage = useCallback(
    async (isInitial: boolean) => {
      if (!user?.id || !albumOwnerId || tripsFetchInFlightRef.current) return;
      if (!isInitial && (!tripsHasMoreRef.current || tripsLoadingMoreRef.current)) return;
      const generation = hubAlbumDataGenRef.current;
      tripsFetchInFlightRef.current = true;
      if (isInitial) setTripsDataLoading(true);
      else setTripsLoadingMore(true);
      let didCommit = false;
      try {
        const offset = nextTripOffsetRef.current;
        const hasFilters =
          selectedLocationIds.length > 0 ||
          selectedFlyPatterns.length > 0 ||
          selectedSpecies.length > 0 ||
          dateFrom.trim() !== '' ||
          dateTo.trim() !== '';
        const page = await fetchCompletedTripsPage(albumOwnerId, {
          limit: TRIPS_PAGE + 1,
          offset,
          filters: hasFilters ? albumRpcFilters : undefined,
        });
        if (generation !== hubAlbumDataGenRef.current) {
          tripsLoadMorePendingRef.current = false;
          return;
        }
        const hasMore = page.length > TRIPS_PAGE;
        const slice = hasMore ? page.slice(0, TRIPS_PAGE) : page;
        const ids = slice.map((t) => t.id);

        const [withTripPhotos, catches] = await Promise.all([
          ids.length ? fetchPhotosWithTripForTripIds(albumOwnerId, ids) : Promise.resolve([] as PhotoWithTrip[]),
          ids.length ? fetchUserCatchesForTripIds(albumOwnerId, ids) : Promise.resolve([] as CatchRow[]),
        ]);

        if (generation !== hubAlbumDataGenRef.current) {
          tripsLoadMorePendingRef.current = false;
          return;
        }

        setAllTrips((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          return [...prev, ...slice.filter((t) => !seen.has(t.id))];
        });
        setTripScopedPhotos((prev) => mergePhotoWithTripById(prev, withTripPhotos));
        setAllCatches((prev) => mergeCatchesById(prev, catches));

        nextTripOffsetRef.current += slice.length;
        setTripsHasMore(hasMore && slice.length > 0);
        setTripsDataLoaded(true);
        didCommit = true;
      } finally {
        tripsFetchInFlightRef.current = false;
        if (isInitial) setTripsDataLoading(false);
        else setTripsLoadingMore(false);
        if (!isInitial && didCommit && tripsLoadMorePendingRef.current) {
          tripsLoadMorePendingRef.current = false;
          if (tripsHasMoreRef.current) {
            queueMicrotask(() => {
              void appendTripsPageRef.current(false);
            });
          }
        }
      }
    },
    [
      user?.id,
      albumOwnerId,
      albumRpcFilters,
      selectedLocationIds.length,
      selectedFlyPatterns.length,
      selectedSpecies.length,
      dateFrom,
      dateTo,
    ],
  );

  appendTripsPageRef.current = appendTripsPage;

  const appendPhotoLibraryPage = useCallback(
    async (isInitial: boolean, opts?: { replace?: boolean }) => {
      if (!user?.id || !albumOwnerId || photosFetchInFlightRef.current) return;
      if (!isInitial && (!photosHasMoreRef.current || photosLoadingMoreRef.current)) return;
      const generation = hubAlbumDataGenRef.current;
      photosFetchInFlightRef.current = true;
      if (isInitial) setPhotosLibraryBooting(true);
      else setPhotosLoadingMore(true);
      try {
        if (opts?.replace) {
          nextPhotoOffsetRef.current = 0;
          setPhotosHasMore(true);
        }
        const offset = isInitial || opts?.replace ? 0 : nextPhotoOffsetRef.current;
        const hasFilters =
          selectedLocationIds.length > 0 ||
          selectedFlyPatterns.length > 0 ||
          selectedSpecies.length > 0 ||
          dateFrom.trim() !== '' ||
          dateTo.trim() !== '';
        const page = await fetchPhotosWithTripPage(albumOwnerId, {
          limit: PHOTOS_PAGE + 1,
          offset,
          filters: hasFilters ? albumRpcFilters : undefined,
        });
        if (generation !== hubAlbumDataGenRef.current) return;
        const hasMore = page.length > PHOTOS_PAGE;
        const slice = hasMore ? page.slice(0, PHOTOS_PAGE) : page;

        const tripIds = [...new Set(slice.map((p) => p.trip_id).filter(Boolean))] as string[];
        const catches =
          tripIds.length > 0 ? await fetchUserCatchesForTripIds(albumOwnerId, tripIds) : ([] as CatchRow[]);

        if (generation !== hubAlbumDataGenRef.current) return;

        setLibraryPagedPhotos((prev) => (opts?.replace ? mergePhotoWithTripById([], slice) : mergePhotoWithTripById(prev, slice)));
        if (catches.length) setAllCatches((prev) => mergeCatchesById(prev, catches));

        nextPhotoOffsetRef.current = offset + slice.length;
        setPhotosHasMore(hasMore && slice.length > 0);
        setPhotoLibraryStarted(true);
      } finally {
        photosFetchInFlightRef.current = false;
        if (isInitial) setPhotosLibraryBooting(false);
        else setPhotosLoadingMore(false);
      }
    },
    [
      user?.id,
      albumOwnerId,
      albumRpcFilters,
      selectedLocationIds.length,
      selectedFlyPatterns.length,
      selectedSpecies.length,
      dateFrom,
      dateTo,
    ],
  );

  appendPhotoLibraryPageRef.current = appendPhotoLibraryPage;

  const reloadPhotoLibraryFirstPage = useCallback(async () => {
    if (!user?.id || !albumOwnerId) return;
    await appendPhotoLibraryPageRef.current(true, { replace: true });
  }, [user?.id, albumOwnerId]);

  useEffect(() => {
    resetPagedHubState();
  }, [albumOwnerId, resetPagedHubState]);

  useEffect(() => {
    if (!user?.id || !albumOwnerId) {
      setAlbumFilterOptions(null);
      return;
    }
    let cancelled = false;
    void fetchProfileAlbumFilterOptions(albumOwnerId).then((opts) => {
      if (!cancelled) setAlbumFilterOptions(opts);
    });
    return () => {
      cancelled = true;
    };
  }, [albumOwnerId, user?.id, refreshSignal]);

  useEffect(() => {
    if (!user?.id || !albumOwnerId) return;
    hubAlbumDataGenRef.current += 1;
    resetTripsPagingForFilterChange();
    resetPhotosPagingForFilterChange();
  }, [albumFilterKey, albumOwnerId, user?.id, resetTripsPagingForFilterChange, resetPhotosPagingForFilterChange]);

  useEffect(() => {
    if (mediaTab !== 'trips' || !user?.id || !albumOwnerId || tripsDataLoaded || tripsDataLoading) return;
    void appendTripsPageRef.current(true);
  }, [mediaTab, user?.id, albumOwnerId, tripsDataLoaded, tripsDataLoading]);

  /** After filter reset or first visit to Photos, load page 1 (server-filtered when filters are on). */
  useEffect(() => {
    if (mediaTab !== 'photos' || !user?.id || !albumOwnerId) return;
    if (photosLibraryBooting || photosLoadingMore || photosFetchInFlightRef.current) return;
    if (!photoLibraryStarted) {
      void appendPhotoLibraryPageRef.current(true, { replace: true });
    }
  }, [
    mediaTab,
    user?.id,
    albumOwnerId,
    photoLibraryStarted,
    photosLibraryBooting,
    photosLoadingMore,
    albumFilterKey,
  ]);

  useEffect(() => {
    void (async () => {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status === 'granted') setJournalMapUserLocation(true);
    })();
  }, []);

  const mediaTabRef = useRef(mediaTab);
  mediaTabRef.current = mediaTab;

  useEffect(() => {
    if (refreshSignal === 0) return;
    resetPagedHubState();
    void (async () => {
      await appendTripsPageRef.current(true);
      if (mediaTabRef.current === 'photos') {
        await appendPhotoLibraryPageRef.current(true, { replace: true });
      }
    })();
  }, [refreshSignal, resetPagedHubState]);

  const loadMoreFromScroll = useCallback(() => {
    const now = Date.now();
    if (now - loadMoreCooldownRef.current < 600) return;
    loadMoreCooldownRef.current = now;
    if (layoutTab !== 'grid') return;
    if (mediaTab === 'trips' && tripsHasMore && !tripsDataLoading) {
      if (tripsLoadingMore || tripsFetchInFlightRef.current) {
        tripsLoadMorePendingRef.current = true;
      } else {
        void appendTripsPageRef.current(false);
      }
    }
    if (mediaTab === 'photos' && photosHasMore && !photosLibraryBooting && !photosLoadingMore) {
      void appendPhotoLibraryPageRef.current(false);
    }
  }, [
    layoutTab,
    mediaTab,
    tripsHasMore,
    tripsDataLoading,
    tripsLoadingMore,
    photosHasMore,
    photosLibraryBooting,
    photosLoadingMore,
  ]);

  useImperativeHandle(ref, () => ({ loadMoreFromScroll }), [loadMoreFromScroll]);

  const tripPhotoUrlsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    const visibilityProfile = isPeerAlbum ? peerAlbumProfile : null;
    for (const trip of allTrips) {
      const fromPhotos = imageUrlsForTrip(trip.id, allPhotos);
      const vis = effectiveTripPhotoVisibility(trip, visibilityProfile);
      const allowCatchPreview = !isPeerAlbum || vis !== 'private';
      if (!allowCatchPreview) {
        map[trip.id] = fromPhotos;
        continue;
      }
      const seen = new Set(fromPhotos);
      const merged = [...fromPhotos];
      for (const c of allCatches) {
        if (c.trip_id !== trip.id) continue;
        for (const u of catchRowGalleryUrls(c)) {
          const t = u.trim();
          if (!t || seen.has(t)) continue;
          seen.add(t);
          merged.push(t);
        }
      }
      map[trip.id] = merged;
    }
    return map;
  }, [allTrips, allPhotos, allCatches, isPeerAlbum, peerAlbumProfile]);

  const filterBundle = useMemo(
    () => ({
      selectedLocationIds,
      selectedFlyPatterns,
      selectedSpecies,
      dateFrom,
      dateTo,
    }),
    [selectedLocationIds, selectedFlyPatterns, selectedSpecies, dateFrom, dateTo],
  );

  const hasActiveFilters =
    selectedLocationIds.length > 0 ||
    selectedFlyPatterns.length > 0 ||
    selectedSpecies.length > 0 ||
    dateFrom.trim() !== '' ||
    dateTo.trim() !== '';

  const filteredAlbumTrips = useMemo(() => {
    return allTrips.filter((t) => tripMatchesAlbumFilters(t, allCatches, photosForOptions, filterBundle));
  }, [allTrips, allCatches, photosForOptions, filterBundle]);

  /** With server-side filter pagination, loaded `allTrips` already match filters — do not filter again. */
  const tripsForHub = useMemo(
    () => (hasActiveFilters ? allTrips : filteredAlbumTrips),
    [hasActiveFilters, allTrips, filteredAlbumTrips],
  );

  const filteredCatchesForMap = useMemo(() => {
    const allowedTripIds =
      mediaTab === 'photos'
        ? new Set(
            photosForOptions
              .map((p) => p.trip_id)
              .filter((tid): tid is string => Boolean(tid)),
          )
        : tripsDataLoaded
          ? new Set(tripsForHub.map((t) => t.id))
          : new Set(
              photosForOptions
                .map((p) => p.trip_id)
                .filter((tid): tid is string => Boolean(tid)),
            );
    return allCatches.filter((c) => {
      if (!allowedTripIds.has(c.trip_id)) return false;
      if (c.latitude == null || c.longitude == null) return false;
      if (selectedSpecies.length > 0) {
        const sp = (c.species ?? '').trim();
        if (!sp || !selectedSpecies.includes(sp)) return false;
      }
      if (selectedFlyPatterns.length > 0) {
        const fp = (c.fly_pattern ?? '').trim();
        if (!fp || !selectedFlyPatterns.includes(fp)) return false;
      }
      return true;
    });
  }, [
    allCatches,
    tripsForHub,
    photosForOptions,
    tripsDataLoaded,
    selectedSpecies,
    selectedFlyPatterns,
    mediaTab,
  ]);

  const locationGroups = useMemo(() => {
    const groups = new Map<string, LocationGroup>();
    for (const trip of tripsForHub) {
      const lat = trip.location?.latitude;
      const lng = trip.location?.longitude;
      if (lat == null || lng == null) continue;
      const key = trip.location_id || `${lat},${lng}`;
      const existing = groups.get(key);
      if (existing) {
        existing.trips.push(trip);
      } else {
        groups.set(key, {
          locationId: key,
          locationName: trip.location?.name || 'Unknown Location',
          latitude: lat,
          longitude: lng,
          trips: [trip],
        });
      }
    }
    return Array.from(groups.values());
  }, [tripsForHub]);

  const fishMapPins = useMemo(() => filteredCatchesForMap, [filteredCatchesForMap]);

  /** Trips map: trip locations. Photos map: catch pins (same as former “My Fish”). */
  const mapFraming = useMemo(() => {
    if (mediaTab === 'trips') {
      return journalMapDefaultFraming(tripsForHub, []);
    }
    return journalMapDefaultFraming(
      [],
      fishMapPins.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
    );
  }, [mediaTab, tripsForHub, fishMapPins]);

  const mapDataBlocking = useMemo(() => {
    if (mediaTab === 'trips') return tripsDataLoading && !tripsDataLoaded && allTrips.length === 0;
    return photosLibraryBooting && libraryPagedPhotos.length === 0;
  }, [mediaTab, tripsDataLoading, tripsDataLoaded, allTrips.length, photosLibraryBooting, libraryPagedPhotos.length]);

  useEffect(() => {
    if (mapDataBlocking) return;
    setMapCenter(mapFraming.center);
    setMapZoom(mapFraming.zoom);
    setMapCameraKey((k) => k + 1);
  }, [mapDataBlocking, mapFraming]);

  useEffect(() => {
    setSelectedGroup(null);
    setSelectedFishCatch(null);
  }, [mediaTab]);

  const tripNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allTrips) {
      if (t.location?.name) m.set(t.id, t.location.name);
    }
    for (const p of photosForOptions) {
      const name = p.trip?.location?.name?.trim();
      if (p.trip_id && name) m.set(p.trip_id, name);
    }
    return m;
  }, [allTrips, photosForOptions]);

  const locationsMerged = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of albumFilterOptions?.locations ?? []) {
      if (row.id && row.name) map.set(row.id, row.name);
    }
    photosForOptions.forEach((p) => {
      const loc = p.trip?.location;
      if (loc?.id && loc?.name) map.set(loc.id, loc.name);
    });
    allTrips.forEach((t) => {
      const loc = t.location;
      if (loc?.id && loc?.name) map.set(loc.id, loc.name);
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [albumFilterOptions, photosForOptions, allTrips]);

  const flyOptionsMerged = useMemo(() => {
    const set = new Set<string>();
    for (const f of albumFilterOptions?.flyPatterns ?? []) {
      if (f.trim()) set.add(f.trim());
    }
    photosForOptions.forEach((p) => {
      if (p.fly_pattern?.trim()) set.add(p.fly_pattern.trim());
    });
    allCatches.forEach((c) => {
      if (c.fly_pattern?.trim()) set.add(c.fly_pattern.trim());
    });
    return Array.from(set).sort();
  }, [albumFilterOptions, photosForOptions, allCatches]);

  const speciesOptionsMerged = useMemo(() => {
    const set = new Set<string>();
    for (const s of albumFilterOptions?.species ?? []) {
      if (s.trim()) set.add(s.trim());
    }
    photosForOptions.forEach((p) => {
      if (p.species?.trim()) set.add(p.species.trim());
    });
    allCatches.forEach((c) => {
      if (c.species?.trim()) set.add(c.species.trim());
    });
    return Array.from(set).sort();
  }, [albumFilterOptions, photosForOptions, allCatches]);

  const toggleLocation = useCallback((id: string) => {
    setSelectedLocationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);
  const toggleFly = useCallback((fly: string) => {
    setSelectedFlyPatterns((prev) => (prev.includes(fly) ? prev.filter((x) => x !== fly) : [...prev, fly]));
  }, []);
  const toggleSpecies = useCallback((species: string) => {
    setSelectedSpecies((prev) =>
      prev.includes(species) ? prev.filter((x) => x !== species) : [...prev, species],
    );
  }, []);

  const clearAlbumFilters = useCallback(() => {
    setSelectedLocationIds([]);
    setSelectedFlyPatterns([]);
    setSelectedSpecies([]);
    setDateFrom('');
    setDateTo('');
  }, []);

  const sharedAlbumFilters: SharedAlbumFilters = useMemo(
    () => ({
      selectedLocationIds,
      selectedFlyPatterns,
      selectedSpecies,
      dateFrom,
      dateTo,
      locations: locationsMerged,
      flyOptions: flyOptionsMerged,
      speciesOptions: speciesOptionsMerged,
      toggleLocation,
      toggleFly,
      toggleSpecies,
      setDateFrom,
      setDateTo,
      clearAll: clearAlbumFilters,
    }),
    [
      selectedLocationIds,
      selectedFlyPatterns,
      selectedSpecies,
      dateFrom,
      dateTo,
      locationsMerged,
      flyOptionsMerged,
      speciesOptionsMerged,
      toggleLocation,
      toggleFly,
      toggleSpecies,
      clearAlbumFilters,
    ],
  );

  const handleMarkerPress = useCallback(
    (group: LocationGroup) => {
      if (group.trips.length === 1) {
        router.push(journalHrefFromHub(group.trips[0].id, peerUserId));
      } else {
        setSelectedGroup(group);
      }
    },
    [router, peerUserId],
  );

  const handleFishMarkerPress = useCallback((c: CatchRow) => {
    setSelectedFishCatch(c);
  }, []);

  const mapboxMarkers = useMemo((): MapboxMapMarker[] => {
    if (mediaTab === 'trips') {
      const sortedPlaceGroups = [...locationGroups].sort((a, b) => {
        if (Math.abs(a.latitude - b.latitude) > COORD_STACK_EPS) return a.latitude - b.latitude;
        if (Math.abs(a.longitude - b.longitude) > COORD_STACK_EPS) return a.longitude - b.longitude;
        const aChild = a.trips[0]?.location?.parent_location_id ? 1 : 0;
        const bChild = b.trips[0]?.location?.parent_location_id ? 1 : 0;
        return aChild - bChild;
      });
      const placeDisplayCoords = displayLngLatForOverlappingItems(
        sortedPlaceGroups.map((g) => ({
          id: g.locationId,
          lat: g.latitude,
          lng: g.longitude,
        })),
      );
      return sortedPlaceGroups.map((group) => {
        const coord =
          placeDisplayCoords.get(group.locationId) ?? ([group.longitude, group.latitude] as [number, number]);
        return {
          id: `hub-journal-${group.locationId}`,
          coordinate: coord,
          title: group.locationName,
          onPress: () => handleMarkerPress(group),
          children: (
            <View style={hubStyles.markerContainer} pointerEvents="box-none">
              <View style={hubStyles.markerBadge}>
                <Text style={hubStyles.markerBadgeText}>{group.trips.length}</Text>
              </View>
              <View style={hubStyles.markerBubble}>
                <CatalogLocationMapIcon
                  type={group.trips[0]?.location?.type as LocationType | undefined}
                  color={colors.textInverse}
                  size={20}
                  isFavorite={favoriteLocationIds.has(group.locationId)}
                />
              </View>
              <Text style={hubStyles.markerLabel} numberOfLines={1}>
                {group.locationName}
              </Text>
            </View>
          ),
        };
      });
    }
    return fishMapPins.map((c) => {
      const fishPhotos = catchRowGalleryUrls(c);
      const fishHero = fishPhotos[0];
      return {
        id: `hub-fish-${c.id}`,
        coordinate: [c.longitude!, c.latitude!] as [number, number],
        title: c.species?.trim() || 'Catch',
        onPress: () => handleFishMarkerPress(c),
        catchPhotoUrl: fishHero ?? null,
      };
    });
  }, [
    mediaTab,
    locationGroups,
    fishMapPins,
    handleMarkerPress,
    handleFishMarkerPress,
    hubStyles,
    colors,
    favoriteLocationIds,
  ]);

  /** Same horizontal inset as profile `ScrollView` content (`Spacing.md`); do not double-pad inside the hub. */
  const gridGap = Spacing.sm;
  const cardWidth = useMemo(() => {
    const pad = Spacing.md * 2;
    return (winWidth - pad - gridGap) / 2;
  }, [winWidth, gridGap]);

  const mapBlockHeight = Math.round(winHeight * 0.52);
  const segmentIconMuted = colors.textSecondary;
  const segmentIconActive = colors.textInverse;

  const profileHubAlbumPagination = useMemo<ProfileHubAlbumPagination | null>(() => {
    if (!user?.id || !albumOwnerId) return null;
    return {
      photos: libraryPagedPhotos,
      loading: photosLibraryBooting && libraryPagedPhotos.length === 0,
      loadingMore: photosLoadingMore,
      hasMore: photosHasMore,
      onLoadMore: loadMoreFromScroll,
      onPhotoDeleted: (photoId) => {
        setLibraryPagedPhotos((prev) => prev.filter((p) => p.id !== photoId));
      },
      onReloadAfterMutation: () => {
        void reloadPhotoLibraryFirstPage();
      },
    };
  }, [
    user?.id,
    albumOwnerId,
    libraryPagedPhotos,
    photosLibraryBooting,
    photosLoadingMore,
    photosHasMore,
    loadMoreFromScroll,
    reloadPhotoLibraryFirstPage,
  ]);

  return (
    <View style={hubStyles.outer}>
      <View style={hubStyles.hubHeader}>
        <View style={hubStyles.controlsBar}>
          <View style={hubStyles.segmentToggleTripsPhotos}>
            <Pressable
              style={[hubStyles.toggleButtonEqual, mediaTab === 'trips' && hubStyles.toggleButtonActive]}
              onPress={() => setMediaTab('trips')}
            >
              <MaterialIcons
                name="route"
                size={16}
                color={mediaTab === 'trips' ? segmentIconActive : segmentIconMuted}
              />
              <Text
                style={[hubStyles.toggleText, mediaTab === 'trips' && hubStyles.toggleTextActive]}
                numberOfLines={1}
              >
                Trips
              </Text>
            </Pressable>
            <Pressable
              style={[hubStyles.toggleButtonEqual, mediaTab === 'photos' && hubStyles.toggleButtonActive]}
              onPress={() => {
                setMediaTab('photos');
                if (
                  albumOwnerId &&
                  !photoLibraryStarted &&
                  !photosLibraryBooting &&
                  !photosFetchInFlightRef.current
                ) {
                  void appendPhotoLibraryPageRef.current(true);
                }
              }}
            >
              <MaterialCommunityIcons
                name="image-multiple-outline"
                size={16}
                color={mediaTab === 'photos' ? segmentIconActive : segmentIconMuted}
              />
              <Text
                style={[hubStyles.toggleText, mediaTab === 'photos' && hubStyles.toggleTextActive]}
                numberOfLines={1}
              >
                Photos
              </Text>
            </Pressable>
          </View>
          <View style={hubStyles.controlsBarTrailing}>
            <View style={hubStyles.segmentToggleIcons}>
              <Pressable
                style={[hubStyles.toggleIconOnly, layoutTab === 'grid' && hubStyles.toggleIconOnlyActive]}
                onPress={() => {
                  setLayoutTab('grid');
                  setSelectedGroup(null);
                  setSelectedFishCatch(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Grid"
                accessibilityState={{ selected: layoutTab === 'grid' }}
              >
                <MaterialIcons
                  name="grid-view"
                  size={20}
                  color={layoutTab === 'grid' ? segmentIconActive : segmentIconMuted}
                />
              </Pressable>
              <Pressable
                style={[hubStyles.toggleIconOnly, layoutTab === 'map' && hubStyles.toggleIconOnlyActive]}
                onPress={() => setLayoutTab('map')}
                accessibilityRole="button"
                accessibilityLabel="Map"
                accessibilityState={{ selected: layoutTab === 'map' }}
              >
                <MaterialIcons name="map" size={20} color={layoutTab === 'map' ? segmentIconActive : segmentIconMuted} />
              </Pressable>
            </View>
            <Pressable
              onPress={() => photoLibraryRef.current?.openFilters()}
              style={hubStyles.iconBtn}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Filters"
            >
              <View style={hubStyles.filterIconWrap}>
                <MaterialCommunityIcons
                  name={hasActiveFilters ? 'filter' : 'filter-outline'}
                  size={22}
                  color={colors.primary}
                />
                {hasActiveFilters ? <View style={hubStyles.filterBadge} /> : null}
              </View>
            </Pressable>
            {!isPeerAlbum ? (
              <Pressable
                onPress={() => photoLibraryRef.current?.openAddPhoto()}
                style={hubStyles.iconBtn}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Add photo"
              >
                <MaterialCommunityIcons name="plus-circle-outline" size={22} color={colors.primary} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {layoutTab === 'grid' && mediaTab === 'trips' && (
        <View style={hubStyles.tripsGridWrap}>
          {tripsDataLoading && !tripsDataLoaded && allTrips.length === 0 ? (
            <View style={hubStyles.loadingBox}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={hubStyles.loadingText}>Loading trips…</Text>
            </View>
          ) : tripsForHub.length === 0 ? (
            <View style={hubStyles.empty}>
              <MaterialIcons name="route" size={40} color={colors.textTertiary} />
              <Text style={hubStyles.emptyTitle}>No trips match</Text>
              <Text style={hubStyles.emptyText}>Try adjusting filters or complete a trip.</Text>
            </View>
          ) : (
            <View style={hubStyles.tripsGridInner}>
              {tripsForHub.map((item) => (
                <JournalTripGridCard
                  key={item.id}
                  trip={item}
                  imageUrls={tripPhotoUrlsMap[item.id] ?? []}
                  cardWidth={cardWidth}
                  onPress={() => router.push(journalHrefFromHub(item.id, peerUserId))}
                  colors={colors}
                  styles={tripGridStyles}
                />
              ))}
              {tripsHasMore ? (
                <View style={hubStyles.tripsGridFooter}>
                  {tripsLoadingMore ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={hubStyles.tripsGridFooterHint}>Scroll for more trips</Text>
                  )}
                </View>
              ) : null}
            </View>
          )}
        </View>
      )}

      {layoutTab === 'map' && (
        <View style={[hubStyles.mapWrapper, { height: mapBlockHeight }]}>
          {Platform.OS === 'web' ? (
            <View style={hubStyles.mapWebPlaceholder}>
              <MaterialIcons name="map" size={40} color={colors.textTertiary} />
              <Text style={hubStyles.mapWebPlaceholderText}>Map is available in the iOS and Android app.</Text>
            </View>
          ) : (
            <TripMapboxMapView
              containerStyle={hubStyles.map}
              centerCoordinate={mapCenter}
              zoomLevel={mapZoom}
              cameraKey={String(mapCameraKey)}
              markers={mapboxMarkers}
              showUserLocation={journalMapUserLocation}
              onZoomLevelChange={setMapZoom}
              reservePlanTripFabSpacing
              mapTabControlLayout={false}
            />
          )}

          {mediaTab === 'trips' && tripsDataLoading && !tripsDataLoaded && allTrips.length === 0 ? (
            <View style={hubStyles.mapEmptyOverlay} pointerEvents="none">
              <View style={hubStyles.mapEmptyBubble}>
                <Text style={hubStyles.mapEmptyText}>Loading trips…</Text>
              </View>
            </View>
          ) : null}

          {mediaTab === 'trips' && tripsDataLoaded && locationGroups.length === 0 && (
            <View style={hubStyles.mapEmptyOverlay} pointerEvents="none">
              <View style={hubStyles.mapEmptyBubble}>
                <Text style={hubStyles.mapEmptyText}>No trip locations on the map</Text>
              </View>
            </View>
          )}

          {mediaTab === 'photos' && fishMapPins.length === 0 && (
            <View style={hubStyles.mapEmptyOverlay} pointerEvents="none">
              <View style={hubStyles.mapEmptyBubble}>
                <Text style={hubStyles.mapEmptyText}>No catches with map pins</Text>
              </View>
            </View>
          )}

          <Modal visible={!!selectedGroup} transparent animationType="slide" onRequestClose={() => setSelectedGroup(null)}>
            <View style={hubStyles.entryModalRoot}>
              <Pressable style={hubStyles.entryModalDim} onPress={() => setSelectedGroup(null)} />
              <View style={[hubStyles.entryModalSheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
                {selectedGroup && (
                  <>
                    <View style={hubStyles.selectedPanelHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={hubStyles.selectedPanelTitle}>{selectedGroup.locationName}</Text>
                        <Text style={hubStyles.selectedPanelSubtitle}>
                          {selectedGroup.trips.length} entries — tap one to open
                        </Text>
                      </View>
                      <Pressable onPress={() => setSelectedGroup(null)} hitSlop={12}>
                        <MaterialIcons name="close" size={22} color={colors.textSecondary} />
                      </Pressable>
                    </View>
                    <FlatList
                      data={selectedGroup.trips}
                      keyboardShouldPersistTaps="handled"
                      renderItem={({ item }) => (
                        <Pressable
                          style={hubStyles.selectedTripCard}
                          onPress={() => {
                            setSelectedGroup(null);
                            router.push(journalHrefFromHub(item.id, peerUserId));
                          }}
                        >
                          <View style={hubStyles.selectedTripRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={hubStyles.selectedTripDate}>{formatTripDate(item.start_time)}</Text>
                              <Text style={hubStyles.selectedTripMeta}>
                                {formatFishCount(item.total_fish)} ·{' '}
                                {formatTripDuration(item.start_time, item.end_time, {
                                  imported: item.imported,
                                  activeFishingMs: item.active_fishing_ms ?? undefined,
                                })}
                              </Text>
                            </View>
                            <MaterialIcons name="chevron-right" size={20} color={colors.textTertiary} />
                          </View>
                        </Pressable>
                      )}
                      keyExtractor={(item) => item.id}
                      style={hubStyles.selectedTripList}
                      contentContainerStyle={hubStyles.selectedTripListContent}
                    />
                  </>
                )}
              </View>
            </View>
          </Modal>

          <Modal
            visible={selectedFishCatch != null}
            transparent
            animationType="slide"
            onRequestClose={() => setSelectedFishCatch(null)}
          >
            <View style={hubStyles.entryModalRoot}>
              <Pressable style={hubStyles.entryModalDim} onPress={() => setSelectedFishCatch(null)} />
              {selectedFishCatch != null ? (
                <View style={hubStyles.fishCatchBottomStack}>
                  <ScrollView
                    style={[hubStyles.fishCatchHeroScroll, { maxHeight: Math.round(winHeight * 0.42) }]}
                    contentContainerStyle={hubStyles.fishCatchHeroScrollContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={hubStyles.fishCatchHeroInner}>
                      {(() => {
                        const gallery = catchRowGalleryUrls(selectedFishCatch);
                        if (gallery.length === 0) return null;
                        return (
                          <ScrollView
                            horizontal
                            pagingEnabled
                            showsHorizontalScrollIndicator={false}
                            style={{ width: winWidth - Spacing.lg * 2 }}
                          >
                            {gallery.map((uri, idx) => (
                              <Image
                                key={`${uri}-${idx}`}
                                source={{ uri }}
                                style={[hubStyles.fishCatchHeroImage, { width: winWidth - Spacing.lg * 2 }]}
                                resizeMode="cover"
                              />
                            ))}
                          </ScrollView>
                        );
                      })()}
                      <View style={hubStyles.fishCatchHeroCard}>
                        <Text style={hubStyles.fishCatchHeroTitle}>{selectedFishCatch.species || 'Catch'}</Text>
                        <Text style={hubStyles.fishCatchHeroSubtitle}>
                          {format(new Date(selectedFishCatch.timestamp), 'MMM d, yyyy')}
                          {tripNameById.get(selectedFishCatch.trip_id)
                            ? ` · ${tripNameById.get(selectedFishCatch.trip_id)}`
                            : ''}
                        </Text>
                        {(selectedFishCatch.fly_pattern ||
                          selectedFishCatch.fly_size ||
                          selectedFishCatch.fly_color) ? (
                          <Text style={hubStyles.fishCatchHeroRow}>
                            <MaterialCommunityIcons name="hook" size={14} color="rgba(255,255,255,0.92)" />{' '}
                            {[
                              selectedFishCatch.fly_pattern,
                              selectedFishCatch.fly_size ? `#${selectedFishCatch.fly_size}` : null,
                              selectedFishCatch.fly_color,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          </Text>
                        ) : null}
                        {(selectedFishCatch.size_inches != null ||
                          (selectedFishCatch.quantity != null && selectedFishCatch.quantity > 1)) ? (
                          <Text style={hubStyles.fishCatchHeroRow}>
                            <MaterialCommunityIcons name="ruler" size={14} color="rgba(255,255,255,0.92)" />{' '}
                            {[
                              selectedFishCatch.size_inches != null
                                ? `${selectedFishCatch.size_inches}"`
                                : null,
                              selectedFishCatch.quantity != null && selectedFishCatch.quantity > 1
                                ? `×${selectedFishCatch.quantity}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        ) : null}
                        {formatCatchWeightLabel(selectedFishCatch.weight_lb, selectedFishCatch.weight_oz) ? (
                          <Text style={hubStyles.fishCatchHeroRow}>
                            <MaterialCommunityIcons name="scale-balance" size={14} color="rgba(255,255,255,0.92)" />{' '}
                            {formatCatchWeightLabel(selectedFishCatch.weight_lb, selectedFishCatch.weight_oz)}
                          </Text>
                        ) : null}
                        {selectedFishCatch.note ? (
                          <Text style={hubStyles.fishCatchHeroNote}>{selectedFishCatch.note}</Text>
                        ) : null}
                      </View>
                    </View>
                  </ScrollView>
                  <View style={[hubStyles.fishCatchSheetActions, { paddingBottom: insets.bottom + Spacing.lg }]}>
                    <View style={hubStyles.fishCatchSheetHeader}>
                      <Pressable onPress={() => setSelectedFishCatch(null)} hitSlop={12} style={hubStyles.fishCatchSheetClose}>
                        <MaterialIcons name="close" size={22} color={colors.textSecondary} />
                      </Pressable>
                    </View>
                    <Pressable
                      style={hubStyles.fishOpenJournalBtn}
                      onPress={() => {
                        const id = selectedFishCatch.trip_id;
                        setSelectedFishCatch(null);
                        router.push(journalHrefFromHub(id, peerUserId));
                      }}
                    >
                      <Text style={hubStyles.fishOpenJournalBtnText}>Open trip</Text>
                      <MaterialIcons name="chevron-right" size={20} color={colors.textInverse} />
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          </Modal>
        </View>
      )}

      <ProfilePhotoLibrarySection
        ref={photoLibraryRef}
        embedded
        peerUserId={peerUserId ?? null}
        contentHidden={!(mediaTab === 'photos' && layoutTab === 'grid')}
        refreshSignal={refreshSignal}
        sharedAlbumFilters={sharedAlbumFilters}
        profileHubAlbum={profileHubAlbumPagination}
      />
    </View>
  );
});

function createHubStyles(colors: ThemeColors, scheme: ResolvedScheme) {
  return StyleSheet.create({
    outer: { marginTop: Spacing.md },
    loadingBox: {
      minHeight: 160,
      justifyContent: 'center',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    loadingText: { fontSize: FontSize.md, color: colors.textSecondary },
    hubHeader: {
      backgroundColor: 'transparent',
      width: '100%',
      paddingTop: Spacing.xs,
      paddingBottom: Spacing.xs,
      marginBottom: Spacing.sm,
    },
    controlsBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      gap: Spacing.md,
      flexWrap: 'nowrap',
    },
    controlsBarTrailing: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
      gap: Spacing.md,
    },
    /** Trips | Photos — equal halves so the bar does not shift when toggling */
    segmentToggleTripsPhotos: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: 2,
      borderWidth: 1,
      borderColor: colors.border,
    },
    /** Grid | Map — icons only, fixed footprint */
    segmentToggleIcons: {
      flexShrink: 0,
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: 2,
      borderWidth: 1,
      borderColor: colors.border,
    },
    toggleIconOnly: {
      width: 36,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: BorderRadius.md - 2,
    },
    toggleIconOnlyActive: {
      backgroundColor: colors.primary,
    },
    iconBtn: { padding: Spacing.xs, flexShrink: 0 },
    filterIconWrap: { position: 'relative', width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
    filterBadge: {
      position: 'absolute',
      top: -2,
      right: -4,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    toggleButtonEqual: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      borderRadius: BorderRadius.md - 2,
      gap: 4,
    },
    toggleButtonActive: { backgroundColor: colors.primary },
    toggleText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
    toggleTextActive: { color: colors.textInverse },
    tripsGridWrap: { paddingBottom: Spacing.lg },
    tripsGridInner: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: Spacing.sm,
    },
    tripsGridFooter: {
      width: '100%',
      alignItems: 'center',
      paddingTop: Spacing.md,
      paddingBottom: Spacing.sm,
    },
    tripsGridFooterHint: { fontSize: FontSize.xs, color: colors.textTertiary },
    empty: { alignItems: 'center', paddingVertical: Spacing.lg },
    emptyTitle: { fontSize: FontSize.lg, fontWeight: '600', color: colors.text, marginTop: Spacing.sm },
    emptyText: { fontSize: FontSize.sm, color: colors.textSecondary, textAlign: 'center', marginTop: Spacing.xs },
    mapWrapper: { borderRadius: BorderRadius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
    map: { flex: 1 },
    mapWebPlaceholder: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.lg,
      backgroundColor: colors.surface,
      minHeight: 200,
    },
    mapWebPlaceholderText: { marginTop: Spacing.sm, fontSize: FontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    mapEmptyOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
    mapEmptyBubble: {
      backgroundColor: 'rgba(0,0,0,0.65)',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.full,
    },
    mapEmptyText: { color: '#FFFFFF', fontSize: FontSize.md, fontWeight: '600' },
    markerContainer: { alignItems: 'center', width: 80 },
    markerBadge: {
      backgroundColor: colors.accent,
      borderRadius: BorderRadius.full,
      minWidth: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 5,
      marginBottom: -2,
      zIndex: 1,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 2,
      elevation: 3,
    },
    markerBadgeText: { color: colors.textInverse, fontSize: 11, fontWeight: '700' },
    markerBubble: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.full,
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 4,
    },
    markerLabel: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: scheme === 'dark' ? '#F8FAFC' : colors.text,
      marginTop: 2,
      textAlign: 'center',
      backgroundColor: scheme === 'dark' ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255,255,255,0.85)',
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: 'hidden',
    },
    entryModalRoot: { flex: 1, justifyContent: 'flex-end' },
    entryModalDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
    entryModalSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      maxHeight: '58%',
      minHeight: 200,
      paddingHorizontal: Spacing.lg,
      elevation: 12,
    },
    selectedPanelHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderLight,
    },
    selectedPanelTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    selectedPanelSubtitle: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2 },
    selectedTripList: { maxHeight: 300 },
    selectedTripListContent: { paddingBottom: Spacing.xl, paddingTop: Spacing.xs },
    selectedTripCard: { paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
    selectedTripRow: { flexDirection: 'row', alignItems: 'center' },
    selectedTripDate: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    selectedTripMeta: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2 },
    fishCatchBottomStack: { width: '100%' },
    fishCatchHeroScroll: { flexGrow: 0 },
    fishCatchHeroScrollContent: { paddingBottom: Spacing.sm, flexGrow: 0 },
    fishCatchHeroInner: { paddingHorizontal: Spacing.lg },
    fishCatchHeroImage: {
      height: 200,
      borderRadius: BorderRadius.lg,
      backgroundColor: 'rgba(255,255,255,0.12)',
      marginBottom: Spacing.md,
      alignSelf: 'center',
    },
    fishCatchHeroCard: {
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
    },
    fishCatchHeroTitle: { fontSize: FontSize.xl, fontWeight: '700', color: colors.textInverse },
    fishCatchHeroSubtitle: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.88)', marginTop: Spacing.xs },
    fishCatchHeroRow: { fontSize: FontSize.md, color: 'rgba(255,255,255,0.92)', marginTop: Spacing.sm },
    fishCatchHeroNote: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.78)', marginTop: Spacing.md, lineHeight: 20 },
    fishCatchSheetActions: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      paddingHorizontal: Spacing.lg,
      elevation: 12,
    },
    fishCatchSheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.sm,
    },
    fishCatchSheetClose: { marginRight: -Spacing.xs },
    fishOpenJournalBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      marginBottom: Spacing.md,
      paddingVertical: Spacing.md,
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
    },
    fishOpenJournalBtnText: { fontSize: FontSize.md, fontWeight: '600', color: colors.textInverse },
  });
}
