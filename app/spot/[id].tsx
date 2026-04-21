import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Platform, KeyboardAvoidingView, TextInput, Modal, Alert, TouchableOpacity,
} from 'react-native';
import * as Linking from 'expo-linking';
import NetInfo from '@react-native-community/netinfo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationFavoritesStore } from '@/src/stores/locationFavoritesStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { useTripStore } from '@/src/stores/tripStore';
import { useSimulateOfflineStore } from '@/src/stores/simulateOfflineStore';
import { fetchLocationConditions, getDriftGuideScore, getWeatherIconName } from '@/src/services/conditions';
import {
  getSpotFishingSummary,
  getSpotDetailedReport,
  getSpotHowToFish,
  askAI,
  buildOfflineGuideSections,
  getSeason,
  getTimeOfDay,
  type OfflineGuideSections,
  type SpotFishingSummaryOptions,
} from '@/src/services/ai';
import type { GuideIntelSource, GuideLocationRecommendation } from '@/src/services/guideIntelContract';
import { fetchCommunityFishTotalForLocation } from '@/src/services/catchAggregates';
import {
  computeDriftGuideCompositeScore,
  internalRawFromCounts,
} from '@/src/services/driftGuideScore';
import { loadGuideIntelForLocation, saveGuideIntelForLocation } from '@/src/services/guideIntelCache';
import { getWeather } from '@/src/services/weather';
import { getStreamFlow } from '@/src/services/waterFlow';
import type { AccessPoint, LocationConditions, Location, WeatherData, WaterFlowData } from '@/src/types';
import { fetchApprovedAccessPointsForLocations } from '@/src/services/accessPointService';
import { ConditionsTab } from '@/src/components/trip-tabs/ConditionsTab';
import { DriftGuideReferenceCard } from '@/src/components/DriftGuideReferenceCard';
import { GuideChatLinkedSpots } from '@/src/components/GuideChatLinkedSpots';
import { GuideLocationRecommendationCards } from '@/src/components/GuideLocationRecommendationCards';
import { GuideChatWebSources } from '@/src/components/GuideChatWebSources';
import { SpotTaggedText } from '@/src/components/SpotTaggedText';
import { OfflineFallbackGuide } from '@/src/components/OfflineFallbackGuide';
import { OfflineGuideActionStack } from '@/src/components/OfflineGuideActionStack';
import { buildOfflineSpotGuide } from '@/src/services/offlineSpotGuide';

import { buildCatalogMapboxMarkers } from '@/src/components/map/catalogMapboxMarkers';
import { TripMapboxMapView } from '@/src/components/map/TripMapboxMapView';
import { USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { locationsForSpotMapContext, spotMapRelatedLocationIds } from '@/src/utils/locationSpotMapFilter';
import * as ExpoLocation from 'expo-location';
import { enrichContextWithLocationCatchData } from '@/src/services/guideCatchContext';
import {
  fetchLocationCreatorManageState,
  setLocationPublic,
  softDeleteCommunityLocation,
  type LocationCreatorManageState,
} from '@/src/services/locationService';
import { effectiveIsAppOnline } from '@/src/utils/netReachability';
import {
  averagePublicTripRatingFromRows,
  fetchLocationCommunityRatings,
  type LocationPublicTripRatingRow,
} from '@/src/services/locationCommunityRatings';
import { LocationCommunityRatingsTab } from '@/src/components/spot/LocationCommunityRatingsTab';

const USED_SPOT_MESSAGE =
  'Another angler has this spot on a trip. You can’t change the pin, visibility, or delete it until their trips no longer use it.';

type SpotTabKey = 'overview' | 'conditions' | 'community' | 'ai' | 'map';

/** In-screen header avoids iOS 26+ UIBarButtonItem “glass” behind native `headerRight`. */
function SpotModalHeader({
  title,
  topInset,
  showMenu,
  onBack,
  onOpenMenu,
  showFavorite,
  isFavorite,
  onToggleFavorite,
}: {
  title: string;
  topInset: number;
  showMenu: boolean;
  onBack: () => void;
  onOpenMenu: () => void;
  /** Signed-in: show heart to favorite this catalog location. */
  showFavorite?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}) {
  const { colors } = useAppTheme();
  const headerStyles = useMemo(
    () =>
      StyleSheet.create({
        spotModalHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.primary,
          paddingBottom: Spacing.sm,
          paddingHorizontal: Spacing.xs,
        },
        spotModalHeaderSide: {
          width: 44,
          justifyContent: 'center',
        },
        spotModalHeaderSideEnd: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 4,
        },
        spotModalHeaderTitle: {
          flex: 1,
          color: colors.textInverse,
          fontSize: FontSize.xl,
          fontWeight: '700',
          textAlign: 'center',
        },
        spotModalHeaderIconSlot: {
          width: 24,
          height: 24,
        },
      }),
    [colors],
  );

  return (
    <View style={[headerStyles.spotModalHeader, { paddingTop: topInset }]}>
      <View style={headerStyles.spotModalHeaderSide}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={28} color={colors.textInverse} />
        </Pressable>
      </View>
      <Text style={headerStyles.spotModalHeaderTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={[headerStyles.spotModalHeaderSide, headerStyles.spotModalHeaderSideEnd]}>
        {showFavorite && onToggleFavorite ? (
          <Pressable
            onPress={onToggleFavorite}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={24}
              color={colors.textInverse}
            />
          </Pressable>
        ) : null}
        {showMenu ? (
          <Pressable
            onPress={onOpenMenu}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Location options"
          >
            <MaterialIcons name="more-vert" size={24} color={colors.textInverse} />
          </Pressable>
        ) : !showFavorite ? (
          <View style={headerStyles.spotModalHeaderIconSlot} />
        ) : null}
      </View>
    </View>
  );
}

export default function SpotFishingTripScreen() {
  const { colors, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createSpotStyles(colors), [colors]);

  const { id, planTripPicker, fromPlanTrip, fromMap } = useLocalSearchParams<{
    id: string;
    planTripPicker?: string;
    /** Set when opening spot from Plan a Trip (suggestions or search) so Select returns to that screen with the water chosen. */
    fromPlanTrip?: string;
    /** Set when opening from Map tab or pick-location map — Plan a Trip + Fish Now footer. */
    fromMap?: string;
  }>();
  const paramTruthy = (v: string | string[] | undefined) => {
    const s = Array.isArray(v) ? v[0] : v;
    return s === '1' || s === 'true';
  };
  const openedFromMap = paramTruthy(fromMap);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const { user } = useAuthStore();
  const { locations, fetchLocations, getLocationById, setPendingPlanTripLocationId, addRecentLocation } =
    useLocationStore();
  const startTrip = useTripStore((s) => s.startTrip);
  const [creatorMenu, setCreatorMenu] = useState<LocationCreatorManageState | null>(null);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const userProxRef = useRef<[number, number] | null>(null);
  const [spotMapUserLayer, setSpotMapUserLayer] = useState(false);
  const [activeTab, setActiveTab] = useState<SpotTabKey>('overview');
  const [conditions, setConditions] = useState<LocationConditions | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [topFlies, setTopFlies] = useState<string[]>([]);
  const [bestTime, setBestTime] = useState<string | null>(null);
  const [detailedReport, setDetailedReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [detailedReportLoading, setDetailedReportLoading] = useState(false);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [waterFlowData, setWaterFlowData] = useState<WaterFlowData | null>(null);
  const [conditionsTabLoading, setConditionsTabLoading] = useState(false);
  const [aiMessages, setAiMessages] = useState<
    {
      id: string;
      role: 'user' | 'ai';
      text: string;
      isOfflineSupplement?: boolean;
      linkedSpots?: { id: string; name: string }[];
      ambiguousSpots?: { extractedPhrase: string; candidates: { id: string; name: string }[] }[];
      webSources?: GuideIntelSource[];
      sourcesFetchedAt?: string;
      locationRecommendation?: GuideLocationRecommendation | null;
    }[]
  >([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiScrollRef = useRef<ScrollView>(null);
  const [howToFish, setHowToFish] = useState<string | null>(null);
  const [howToFishLoading, setHowToFishLoading] = useState(false);
  const [offlineSpotGuideSections, setOfflineSpotGuideSections] = useState<OfflineGuideSections | null>(null);
  const [offlineSpotGuideLoading, setOfflineSpotGuideLoading] = useState(false);
  const [approvedAccessPoints, setApprovedAccessPoints] = useState<AccessPoint[]>([]);
  const [communityFishN, setCommunityFishN] = useState(0);
  const [communityRatingsLoading, setCommunityRatingsLoading] = useState(false);
  const [showCommunityTab, setShowCommunityTab] = useState(false);
  const [communityRatingRows, setCommunityRatingRows] = useState<LocationPublicTripRatingRow[]>([]);
  const [summarySources, setSummarySources] = useState<GuideIntelSource[]>([]);
  const [summarySignal, setSummarySignal] = useState<number | null>(null);
  const [summaryFetchedAt, setSummaryFetchedAt] = useState<string | null>(null);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [spotRawNetOn, setSpotRawNetOn] = useState(true);
  const [fishNowStarting, setFishNowStarting] = useState(false);
  const simulateOffline = useSimulateOfflineStore((s) => s.simulateOffline);
  const spotNetOn = useMemo(
    () => effectiveIsAppOnline(spotRawNetOn),
    [spotRawNetOn, simulateOffline],
  );

  const location = id ? getLocationById(id) : undefined;

  const favoriteIds = useLocationFavoritesStore((s) => s.ids);
  const favoriteLocationIds = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const isSpotFavorite = Boolean(id && favoriteIds.includes(id));
  const showFavoriteInHeader = Boolean(user && id && location);
  const handleToggleFavorite = useCallback(() => {
    if (!user?.id || !id) return;
    void useLocationFavoritesStore.getState().toggle(user.id, id);
  }, [user?.id, id]);

  const handleHeaderBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const refreshCreatorMenu = useCallback(async () => {
    if (!id || !user?.id) {
      setCreatorMenu({ isCreator: false, hasActiveTripUsage: false, canManageUnusedOnly: false });
      return;
    }
    const s = await fetchLocationCreatorManageState(id);
    setCreatorMenu(s ?? { isCreator: false, hasActiveTripUsage: false, canManageUnusedOnly: false });
  }, [id, user?.id]);

  useEffect(() => {
    void refreshCreatorMenu();
  }, [refreshCreatorMenu]);

  useFocusEffect(
    useCallback(() => {
      void refreshCreatorMenu();
    }, [refreshCreatorMenu]),
  );

  useEffect(() => {
    if (locations.length === 0) fetchLocations();
  }, [locations.length, fetchLocations]);

  useEffect(() => {
    (async () => {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      setSpotMapUserLayer(true);
      try {
        const loc = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        userProxRef.current = [loc.coords.longitude, loc.coords.latitude];
      } catch {
        userProxRef.current = null;
      }
    })();
  }, []);

  useEffect(() => {
    const sub = NetInfo.addEventListener((s) => {
      setSpotRawNetOn(Boolean(s.isConnected && s.isInternetReachable !== false));
    });
    void NetInfo.fetch().then((s) => {
      setSpotRawNetOn(Boolean(s.isConnected && s.isInternetReachable !== false));
    });
    return () => sub();
  }, []);

  useEffect(() => {
    if (!location) {
      setApprovedAccessPoints([]);
      return;
    }
    const ids = [...spotMapRelatedLocationIds(location, locations)];
    void fetchApprovedAccessPointsForLocations(ids).then(setApprovedAccessPoints);
  }, [location, locations]);

  useFocusEffect(
    useCallback(() => {
      if (!id || !user?.id || simulateOffline) {
        setShowCommunityTab(false);
        setCommunityRatingRows([]);
        setCommunityRatingsLoading(false);
        return;
      }
      let cancelled = false;
      setCommunityRatingsLoading(true);
      void fetchLocationCommunityRatings(id).then((res) => {
        if (cancelled) return;
        setShowCommunityTab(res.showCommunityTab);
        setCommunityRatingRows(res.rows);
        setCommunityRatingsLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [id, user?.id, simulateOffline]),
  );

  useEffect(() => {
    if (activeTab === 'community' && !showCommunityTab) setActiveTab('overview');
  }, [activeTab, showCommunityTab]);

  useEffect(() => {
    if (!location || !id) return;

    let cancelled = false;
    setLoading(true);
    setConditions(null);
    setWeatherData(null);
    setWaterFlowData(null);
    setSummarySources([]);
    setSummarySignal(null);
    setSummaryFetchedAt(null);
    setSourcesExpanded(false);

    void (async () => {
      const cond = await fetchLocationConditions(location, locations);
      if (cancelled) return;
      setConditions(cond);
      setWeatherData(cond.rawWeather ?? null);
      setWaterFlowData(cond.rawWaterFlow ?? null);
      setLoading(false);

      const parentLoc = location.parent_location_id
        ? locations.find((l) => l.id === location.parent_location_id)
        : null;
      const optLat = location.latitude ?? parentLoc?.latitude ?? null;
      const optLng = location.longitude ?? parentLoc?.longitude ?? null;
      const meta = (location.metadata as Record<string, string> | null)?.usgs_station_id ?? null;

      const [online, n, cached] = await Promise.all([
        NetInfo.fetch().then((s) =>
          effectiveIsAppOnline(Boolean(s.isConnected && s.isInternetReachable !== false)),
        ),
        fetchCommunityFishTotalForLocation(id),
        loadGuideIntelForLocation(id),
      ]);
      if (cancelled) return;
      setCommunityFishN(n);

      const opts: SpotFishingSummaryOptions = {
        latitude: optLat,
        longitude: optLng,
        usgsSiteId: meta,
        communityFishN: n,
      };

      const applySummary = (s: {
        report: string;
        topFlies: string[];
        bestTime: string;
        sources?: GuideIntelSource[];
        fishingQualitySignal?: number | null;
        fetchedAt?: string;
      }) => {
        setReport(s.report);
        setTopFlies(s.topFlies);
        setBestTime(s.bestTime);
        setSummarySources(s.sources ?? []);
        setSummarySignal(s.fishingQualitySignal ?? null);
        setSummaryFetchedAt(s.fetchedAt ?? null);
      };

      setSummaryLoading(true);

      if (online) {
        const s = await getSpotFishingSummary(location.name, cond, opts);
        if (cancelled) return;
        applySummary(s);
        await saveGuideIntelForLocation(id, s);
        setSummaryLoading(false);
        return;
      }

      if (cached?.report) {
        applySummary(cached);
        setSummaryLoading(false);
        return;
      }

      const s = buildOfflineSpotGuide(location, cond);
      if (cancelled) return;
      applySummary(s);
      setSummaryLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, location?.id, locations]);

  const conditionsScore = useMemo(
    () => (conditions ? getDriftGuideScore(conditions) : null),
    [conditions],
  );

  const composite = useMemo(() => {
    if (!conditions) return null;
    const n = communityFishN;
    const iRaw = internalRawFromCounts(n, Math.min(n, Math.max(0, Math.ceil(n * 0.35))));
    return computeDriftGuideCompositeScore({
      conditions,
      internalRaw: iRaw,
      communityFishN: n,
      external: { fishingQualitySignal: summarySignal, fetchedAt: summaryFetchedAt },
    });
  }, [conditions, communityFishN, summarySignal, summaryFetchedAt]);

  const displayStars = composite?.stars ?? 0;
  const averageCommunityRating = useMemo(
    () => averagePublicTripRatingFromRows(communityRatingRows),
    [communityRatingRows],
  );
  const showLocationRatingRow = !communityRatingsLoading && averageCommunityRating != null;
  const spotTabs = useMemo((): { key: SpotTabKey; label: string }[] => {
    const tabs: { key: SpotTabKey; label: string }[] = [
      { key: 'overview', label: 'Overview' },
      { key: 'conditions', label: 'Conditions' },
      { key: 'ai', label: 'AI Guide' },
    ];
    if (showCommunityTab) tabs.push({ key: 'community', label: 'Community' });
    tabs.push({ key: 'map', label: 'Map' });
    return tabs;
  }, [showCommunityTab]);
  const showSpotOfflineGuide = !spotNetOn && !summaryFetchedAt;

  const externalStale = useMemo(() => {
    if (!summaryFetchedAt) return false;
    const t = new Date(summaryFetchedAt).getTime();
    if (Number.isNaN(t)) return true;
    const maxAge = 5 * 24 * 60 * 60 * 1000;
    return Date.now() - t > maxAge;
  }, [summaryFetchedAt]);

  const driftGuideScoreInfoMessage = useMemo(
    () =>
      summaryFetchedAt
        ? `Updated ${new Date(summaryFetchedAt).toLocaleDateString()}`
        : 'Weather, recent catches, and regional signals',
    [summaryFetchedAt],
  );

  const isLoading = loading || !location;

  const parent = location?.parent_location_id && locations.length ? locations.find(l => l.id === location.parent_location_id) : null;
  const lat = location?.latitude ?? parent?.latitude ?? null;
  const lng = location?.longitude ?? parent?.longitude ?? null;
  const stationId = (location?.metadata as Record<string, string> | null)?.usgs_station_id;

  const spotSummaryOptions: SpotFishingSummaryOptions = useMemo(
    () => ({
      latitude: lat,
      longitude: lng,
      usgsSiteId: stationId ?? null,
      communityFishN,
    }),
    [lat, lng, stationId, communityFishN],
  );

  const spotMapLocations = useMemo(() => {
    if (!location) return [];
    return locationsForSpotMapContext(location, locations);
  }, [location, locations]);

  const spotMapboxMarkers = useMemo(() => {
    const catalog = buildCatalogMapboxMarkers(
      spotMapLocations,
      (loc) => {
        if (loc.id !== id) router.push(`/spot/${loc.id}`);
      },
      {
        primary: colors.primary,
        surface: colors.surface,
        surfaceElevated: colors.surfaceElevated,
        colorScheme: resolvedScheme,
      },
      favoriteLocationIds,
    );
    const access = approvedAccessPoints.map((ap) => ({
      id: `ap-${ap.id}`,
      coordinate: [ap.longitude, ap.latitude] as [number, number],
      title: ap.name,
      useMarkerView: true,
      children: (
        <View style={styles.accessPointMapBubble}>
          <MaterialIcons name="directions-walk" size={18} color={colors.success} />
        </View>
      ),
    }));
    return [...catalog, ...access];
  }, [
    spotMapLocations,
    approvedAccessPoints,
    id,
    router,
    colors.primary,
    colors.surface,
    colors.surfaceElevated,
    colors.success,
    resolvedScheme,
    styles,
    favoriteLocationIds,
  ]);

  const refreshConditions = useCallback(() => {
    if (!location || activeTab !== 'conditions') return;
    const spotId = typeof id === 'string' ? id : null;
    setConditionsTabLoading(true);
    Promise.all([
      lat != null && lng != null ? getWeather(lat, lng, { locationId: spotId }) : Promise.resolve(null),
      stationId ? getStreamFlow(stationId) : Promise.resolve(null),
    ]).then(([w, wf]) => {
      setWeatherData(w ?? null);
      setWaterFlowData(wf ?? null);
      setConditionsTabLoading(false);
    }).catch(() => setConditionsTabLoading(false));
  }, [location?.id, lat, lng, stationId, activeTab, id]);

  const fetchHowToFish = useCallback(() => {
    if (!location || !conditions) return;
    setHowToFishLoading(true);
    setHowToFish(null);
    getSpotHowToFish(location.name, conditions, spotSummaryOptions).then((text) => {
      setHowToFish(text);
      setHowToFishLoading(false);
    }).catch(() => setHowToFishLoading(false));
  }, [location?.id, conditions, spotSummaryOptions]);

  useEffect(() => {
    if (activeTab === 'ai' && location && conditions) fetchHowToFish();
  }, [activeTab, location?.id, conditions, fetchHowToFish]);

  const handleAskAI = useCallback(async () => {
    const q = aiInput.trim();
    if (!q || !location || !conditions) return;
    setAiInput('');
    setAiMessages(prev => [...prev, { id: String(Date.now()), role: 'user', text: q }]);
    setAiLoading(true);
    try {
      const now = new Date();
      const base = {
        location: location as Location,
        fishingType: 'fly' as const,
        weather: weatherData ?? null,
        waterFlow: waterFlowData ?? null,
        currentFly: null,
        fishCount: 0,
        recentEvents: [],
        timeOfDay: getTimeOfDay(now),
        season: getSeason(now),
      };
      const context = await enrichContextWithLocationCatchData(base, {
        question: q,
        locations,
        userId: user?.id ?? null,
        userLat: userProxRef.current?.[1] ?? null,
        userLng: userProxRef.current?.[0] ?? null,
        referenceDate: now,
      });
      const answer = await askAI(context, q);
      const sup = answer.supplementText?.trim();
      setAiMessages((prev) => {
        const main = {
          id: String(Date.now() + 1),
          role: 'ai' as const,
          text: answer.text,
          linkedSpots: context.guideLinkedSpots,
          ambiguousSpots: context.guideLocationAmbiguous,
          webSources: answer.sources,
          sourcesFetchedAt: answer.fetchedAt,
          locationRecommendation: answer.locationRecommendation,
        };
        if (!sup) return [...prev, main];
        return [
          ...prev,
          main,
          {
            id: String(Date.now() + 2),
            role: 'ai' as const,
            text: sup,
            isOfflineSupplement: true,
          },
        ];
      });
    } catch {
      setAiMessages(prev => [...prev, { id: String(Date.now() + 1), role: 'ai', text: 'Sorry, I couldn’t get an answer. Try again.' }]);
    } finally {
      setAiLoading(false);
    }
  }, [aiInput, location, conditions, weatherData, waterFlowData, locations, user?.id]);

  const spotAiStrategyFragment = useMemo(
    () => (
      <>
        <Text style={[styles.guideSectionLabel, styles.guideSectionLabelFirst]}>Best time to fish</Text>
        <View style={styles.guideCard}>
          {summaryLoading ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.strategyLoader} />
          ) : bestTime ? (
            <Text style={styles.strategyBestTime}>{bestTime}</Text>
          ) : (
            <Text style={styles.fliesPlaceholder}>—</Text>
          )}
        </View>
        <Text style={styles.guideSectionLabel}>Top flies</Text>
        <View style={styles.guideCard}>
          {summaryLoading ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.strategyLoader} />
          ) : topFlies.length > 0 ? (
            <View style={styles.fliesTwoCol}>
              <View style={styles.fliesColumn}>
                {topFlies.slice(0, 3).map((fly, i) => (
                  <View key={i} style={styles.flyRow}>
                    <View style={styles.flyBullet} />
                    <Text style={styles.flyName} numberOfLines={2}>
                      {fly}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.fliesColumn}>
                {topFlies.slice(3, 6).map((fly, i) => (
                  <View key={i + 3} style={styles.flyRow}>
                    <View style={styles.flyBullet} />
                    <Text style={styles.flyName} numberOfLines={2}>
                      {fly}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <Text style={styles.fliesPlaceholder}>No fly suggestions for this spot.</Text>
          )}
        </View>
        <Text style={styles.guideSectionLabel}>How to fish it</Text>
        <View style={styles.guideCard}>
          {howToFishLoading ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.strategyLoader} />
          ) : howToFish ? (
            <Text style={styles.howToFishText}>{howToFish}</Text>
          ) : (
            <Text style={styles.fliesPlaceholder}>—</Text>
          )}
        </View>
      </>
    ),
    [styles, colors.primary, summaryLoading, bestTime, topFlies, howToFishLoading, howToFish],
  );

  useEffect(() => {
    if (activeTab !== 'ai' || spotNetOn || !location || !conditions) {
      setOfflineSpotGuideSections(null);
      setOfflineSpotGuideLoading(false);
      return;
    }
    let cancelled = false;
    setOfflineSpotGuideLoading(true);
    setOfflineSpotGuideSections(null);
    void (async () => {
      const now = new Date();
      try {
        const base = {
          location: location as Location,
          fishingType: 'fly' as const,
          weather: weatherData ?? null,
          waterFlow: waterFlowData ?? null,
          currentFly: null,
          fishCount: 0,
          recentEvents: [],
          timeOfDay: getTimeOfDay(now),
          season: getSeason(now),
        };
        const ctx = await enrichContextWithLocationCatchData(base, {
          question: '',
          locations,
          userId: user?.id ?? null,
          userLat: userProxRef.current?.[1] ?? null,
          userLng: userProxRef.current?.[0] ?? null,
          referenceDate: now,
        });
        if (!cancelled) setOfflineSpotGuideSections(buildOfflineGuideSections(ctx, ''));
      } catch {
        if (!cancelled) setOfflineSpotGuideSections(null);
      } finally {
        if (!cancelled) setOfflineSpotGuideLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, spotNetOn, location?.id, conditions, weatherData, waterFlowData, locations, user?.id]);

  const handlePlanTripHere = () => {
    if (!id) return;
    const returningToPlanTrip =
      planTripPicker === '1' ||
      planTripPicker === 'true' ||
      fromPlanTrip === '1' ||
      fromPlanTrip === 'true';
    if (returningToPlanTrip) {
      setPendingPlanTripLocationId(id);
      router.dismissTo('/trip/new');
      return;
    }
    setPendingPlanTripLocationId(null);
    router.replace({
      pathname: '/trip/new',
      params: { locationId: id },
    });
  };

  const handleFishNowHere = useCallback(async () => {
    if (!user) {
      Alert.alert('Sign in required', 'Sign in to start a trip.');
      return;
    }
    if (!location || !id) return;
    const { activeTrip: existing, isTripPaused } = useTripStore.getState();
    if (existing?.status === 'active') {
      Alert.alert(
        'Trip in progress',
        isTripPaused
          ? 'Resume or end your paused trip before starting a new one.'
          : 'End or pause your current trip before starting a new one.',
      );
      return;
    }
    setFishNowStarting(true);
    try {
      addRecentLocation(id);
      const tripId = await startTrip(user.id, id, 'fly', location, 'wade');
      router.replace(`/trip/${tripId}`);
    } finally {
      setFishNowStarting(false);
    }
  }, [user, location, id, addRecentLocation, startTrip, router]);

  const handleMoreInfo = () => {
    if (!location || !conditions) return;
    setDetailedReportLoading(true);
    setDetailedReport(null);
    getSpotDetailedReport(location.name, conditions, spotSummaryOptions).then(text => {
      setDetailedReport(text);
      setDetailedReportLoading(false);
    }).catch(() => setDetailedReportLoading(false));
  };

  const runCreatorActionIfAllowed = useCallback(
    (fn: () => void) => {
      if (!creatorMenu?.canManageUnusedOnly) {
        Alert.alert('Not available', USED_SPOT_MESSAGE);
        return;
      }
      setManageMenuOpen(false);
      fn();
    },
    [creatorMenu?.canManageUnusedOnly],
  );

  const handleEditPin = useCallback(() => {
    if (!id) return;
    runCreatorActionIfAllowed(() => router.push(`/spot/edit-pin?id=${encodeURIComponent(id)}`));
  }, [id, router, runCreatorActionIfAllowed]);

  const handleTogglePrivate = useCallback(() => {
    if (!id || !location) return;
    const goingPrivate = location.is_public !== false;
    const title = goingPrivate ? 'Make private?' : 'Make public?';
    const message = goingPrivate
      ? 'Only you will see this spot in DriftGuide lists and search.'
      : 'Anyone can discover this spot in DriftGuide.';
    runCreatorActionIfAllowed(() => {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: goingPrivate ? 'Make private' : 'Make public',
          onPress: async () => {
            const ok = await setLocationPublic(id, !goingPrivate);
            if (ok) {
              await fetchLocations();
              void refreshCreatorMenu();
            } else {
              Alert.alert('Could not update', USED_SPOT_MESSAGE);
            }
          },
        },
      ]);
    });
  }, [id, location, runCreatorActionIfAllowed, fetchLocations, refreshCreatorMenu]);

  const handleDeleteLocation = useCallback(() => {
    if (!id) return;
    runCreatorActionIfAllowed(() => {
      Alert.alert(
        'Delete this spot?',
        'It will be removed from DriftGuide. This can’t be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              const ok = await softDeleteCommunityLocation(id);
              if (ok) {
                await fetchLocations();
                handleHeaderBack();
              } else {
                Alert.alert('Could not delete', USED_SPOT_MESSAGE);
              }
            },
          },
        ],
      );
    });
  }, [id, runCreatorActionIfAllowed, fetchLocations, handleHeaderBack]);

  const spotHeaderTitle = location?.name ?? 'Fishing Trip';
  const showSpotCreatorMenu = creatorMenu?.isCreator === true;

  if (!id) {
    return (
      <View style={styles.container}>
        <SpotModalHeader
          title="Fishing Trip"
          topInset={effectiveTop}
          showMenu={false}
          onBack={handleHeaderBack}
          onOpenMenu={() => setManageMenuOpen(true)}
          showFavorite={false}
        />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Missing spot</Text>
        </View>
      </View>
    );
  }

  if (!location && locations.length > 0) {
    return (
      <View style={styles.container}>
        <SpotModalHeader
          title="Fishing Trip"
          topInset={effectiveTop}
          showMenu={showSpotCreatorMenu}
          onBack={handleHeaderBack}
          onOpenMenu={() => setManageMenuOpen(true)}
          showFavorite={false}
        />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Spot not found</Text>
        </View>
      </View>
    );
  }

  if (isLoading && !conditions) {
    return (
      <View style={styles.container}>
        <SpotModalHeader
          title={spotHeaderTitle}
          topInset={effectiveTop}
          showMenu={showSpotCreatorMenu}
          onBack={handleHeaderBack}
          onOpenMenu={() => setManageMenuOpen(true)}
          showFavorite={showFavoriteInHeader}
          isFavorite={isSpotFavorite}
          onToggleFavorite={handleToggleFavorite}
        />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingLabel}>Loading conditions…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SpotModalHeader
        title={spotHeaderTitle}
        topInset={effectiveTop}
        showMenu={showSpotCreatorMenu}
        onBack={handleHeaderBack}
        onOpenMenu={() => setManageMenuOpen(true)}
        showFavorite={showFavoriteInHeader}
        isFavorite={isSpotFavorite}
        onToggleFavorite={handleToggleFavorite}
      />
      <View style={styles.tabBar}>
        {spotTabs.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text
              style={[
                styles.tabLabel,
                showCommunityTab && styles.tabLabelCompact,
                activeTab === tab.key && styles.tabLabelActive,
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === 'overview' && (
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {showLocationRatingRow ? (
          <>
            <View style={styles.ratingsPairLabelsRow}>
              <View style={styles.tileLabelLeftWrap}>
                <Text style={styles.tileLabelLeft} numberOfLines={1}>
                  Drift Guide
                </Text>
                <Pressable
                  onPress={() => Alert.alert('Drift Guide', driftGuideScoreInfoMessage)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="About Drift Guide score"
                >
                  <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>
              <Text style={styles.ratingsPairCommunityLabel} numberOfLines={1}>
                Community
              </Text>
            </View>
            <View style={styles.ratingsPairTilesRow}>
              {composite !== null ? (
                <View style={[styles.tile, styles.scoreTile, styles.tileCompact, styles.ratingsPairTile]}>
                  <View style={styles.scoreOneLineRow}>
                    <Text style={[styles.scoreOneLineValue, styles.scoreOneLineValueCompact]}>
                      {displayStars.toFixed(1)}
                    </Text>
                    <Ionicons
                      name="star"
                      size={18}
                      color={colors.textInverse}
                      accessibilityLabel="out of five"
                    />
                    {conditionsScore?.showFire === true ? (
                      <Ionicons name="flame" size={16} color={colors.warning} />
                    ) : null}
                  </View>
                </View>
              ) : (
                <View style={[styles.tile, styles.scoreTileMuted, styles.ratingsPairTile]} accessibilityRole="text">
                  <Text style={styles.scoreMutedText}>—</Text>
                </View>
              )}
              <View style={[styles.tile, styles.locationRatingTile, styles.tileCompact, styles.ratingsPairTile]}>
                <View style={styles.scoreOneLineRow}>
                  <Text style={[styles.locationRatingValue, styles.locationRatingValueCompact]}>
                    {averageCommunityRating.toFixed(1)}
                  </Text>
                  <Ionicons name="star" size={18} color={colors.warning} accessibilityLabel="out of five" />
                </View>
              </View>
            </View>
            <View style={styles.topTimesBlock}>
              <Text style={styles.topTimesLabel} numberOfLines={1}>
                Top times to fish
              </Text>
              <View style={[styles.tile, styles.bestTimeTile, styles.bestTimeTileCentered]}>
                {summaryLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} style={styles.tileLoader} />
                ) : bestTime ? (
                  <Text
                    style={styles.bestTimeValue}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    {bestTime}
                  </Text>
                ) : (
                  <Text style={styles.bestTimePlaceholder}>—</Text>
                )}
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={styles.tileLabelsRow}>
              <View style={styles.tileLabelLeftWrap}>
                <Text style={styles.tileLabelLeft} numberOfLines={1}>
                  Drift Guide
                </Text>
                <Pressable
                  onPress={() => Alert.alert('Drift Guide', driftGuideScoreInfoMessage)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="About Drift Guide score"
                >
                  <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>
              <Text style={styles.tileLabelColumn} numberOfLines={1}>
                Best Times
              </Text>
            </View>
            <View style={styles.tilesRow}>
              {composite !== null && (
                <View style={[styles.tile, styles.scoreTile]}>
                  <View style={styles.scoreOneLineRow}>
                    <Text style={styles.scoreOneLineValue}>{displayStars.toFixed(1)}</Text>
                    <Ionicons
                      name="star"
                      size={22}
                      color={colors.textInverse}
                      accessibilityLabel="out of five"
                    />
                    {conditionsScore?.showFire === true ? (
                      <Ionicons name="flame" size={20} color={colors.warning} />
                    ) : null}
                  </View>
                </View>
              )}
              <View style={[styles.tile, styles.bestTimeTile]}>
                {summaryLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} style={styles.tileLoader} />
                ) : bestTime ? (
                  <Text
                    style={styles.bestTimeValue}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    {bestTime}
                  </Text>
                ) : (
                  <Text style={styles.bestTimePlaceholder}>—</Text>
                )}
              </View>
            </View>
          </>
        )}

        {/* Conditions summary — block layout: label above value, temp emphasized */}
        {conditions && (
          <>
            <Text style={styles.sectionTitleAbove}>Conditions</Text>
            <View style={styles.conditionsCard}>
            <View style={styles.conditionsBlocksRow}>
              <View style={styles.conditionCloudWrap}>
                <Ionicons name={getWeatherIconName(conditions.sky.condition) as keyof typeof Ionicons.glyphMap} size={28} color={colors.secondary} />
              </View>
              <View style={styles.conditionBlock}>
                <View style={styles.conditionBlockValueWrap}>
                  <Text style={styles.conditionBlockTemp}>{conditions.temperature.temp_f}°F</Text>
                </View>
                <Text style={styles.conditionBlockLabel}>Temp</Text>
              </View>
              <View style={styles.conditionBlock}>
                <View style={styles.conditionBlockValueWrap}>
                  <Text style={styles.conditionBlockValue}>{conditions.wind.speed_mph} mph</Text>
                </View>
                <Text style={styles.conditionBlockLabel}>Wind</Text>
              </View>
              {conditions.water.flow_cfs != null && (
                <View style={styles.conditionBlock}>
                  <View style={styles.conditionBlockValueWrap}>
                    <Text style={styles.conditionBlockValue}>{conditions.water.flow_cfs} CFS</Text>
                  </View>
                  <Text style={styles.conditionBlockLabel}>Flow</Text>
                </View>
              )}
            </View>
          </View>
          </>
        )}

        {/* Report */}
        <Text style={styles.sectionTitleAbove}>Report</Text>
        <View style={styles.reportCard}>
          {summaryLoading ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.reportLoader} />
          ) : report ? (
            <Text style={styles.reportText}>{report}</Text>
          ) : (
            <Text style={styles.reportPlaceholder}>No report available.</Text>
          )}
          {externalStale && summarySources.length > 0 ? (
            <Text style={styles.staleNote}>
              This saved briefing is older than 5 days — the outlook leans on conditions and community logs until you refresh online.
            </Text>
          ) : null}
          {summarySources.length > 0 ? (
            <>
              <Pressable
                style={styles.sourcesToggle}
                onPress={() => setSourcesExpanded((e) => !e)}
                accessibilityRole="button"
                accessibilityLabel={sourcesExpanded ? 'Hide sources' : 'Show sources'}
              >
                <Text style={styles.sourcesToggleText}>
                  Sources ({summarySources.length}){sourcesExpanded ? '' : ' — tap to expand'}
                </Text>
                <Ionicons
                  name={sourcesExpanded ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.secondary}
                />
              </Pressable>
              {sourcesExpanded
                ? summarySources.map((src, idx) => (
                    <Pressable
                      key={`${src.url}-${idx}`}
                      style={styles.sourceRow}
                      onPress={() => void Linking.openURL(src.url)}
                      accessibilityRole="link"
                    >
                      <Text style={styles.sourceTitle} numberOfLines={2}>
                        {src.title}
                      </Text>
                      {src.excerpt ? (
                        <Text style={styles.sourceExcerpt} numberOfLines={4}>
                          {src.excerpt}
                        </Text>
                      ) : null}
                      <Text style={[styles.sourceExcerpt, { marginTop: 4 }]} numberOfLines={1}>
                        {src.url}
                      </Text>
                    </Pressable>
                  ))
                : null}
            </>
          ) : null}
          {report && conditions && !detailedReport && !detailedReportLoading && (
            <Pressable style={styles.moreInfoButton} onPress={handleMoreInfo}>
              <Text style={styles.moreInfoButtonText}>More info</Text>
              <Ionicons name="chevron-down" size={16} color={colors.primary} />
            </Pressable>
          )}
          {detailedReportLoading && (
            <View style={styles.detailedReportLoader}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.detailedReportLoaderText}>Getting detailed report…</Text>
            </View>
          )}
          {detailedReport && (
            <View style={styles.detailedReportBlock}>
              <Text style={styles.detailedReportText}>{detailedReport}</Text>
            </View>
          )}
        </View>

        {/* Top flies: 2 columns, 6 total */}
        <Text style={styles.sectionTitleAbove}>Top Flies</Text>
        <View style={styles.fliesCard}>
          {summaryLoading ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.fliesLoader} />
          ) : topFlies.length > 0 ? (
            <View style={styles.fliesTwoCol}>
              <View style={styles.fliesColumn}>
                {topFlies.slice(0, 3).map((fly, i) => (
                  <View key={i} style={styles.flyRow}>
                    <View style={styles.flyBullet} />
                    <Text style={styles.flyName} numberOfLines={2}>{fly}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.fliesColumn}>
                {topFlies.slice(3, 6).map((fly, i) => (
                  <View key={i + 3} style={styles.flyRow}>
                    <View style={styles.flyBullet} />
                    <Text style={styles.flyName} numberOfLines={2}>{fly}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <Text style={styles.fliesPlaceholder}>No fly suggestions for this spot.</Text>
          )}
        </View>
      </ScrollView>
      )}

      {activeTab === 'conditions' && (
        <ConditionsTab
          weatherData={weatherData}
          waterFlowData={waterFlowData}
          conditionsLoading={conditionsTabLoading}
          onRefresh={refreshConditions}
          location={location ?? undefined}
          showHourly={true}
        />
      )}

      {activeTab === 'community' && showCommunityTab ? (
        <LocationCommunityRatingsTab colors={colors} loading={communityRatingsLoading} rows={communityRatingRows} />
      ) : null}

      {activeTab === 'ai' && !spotNetOn ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={120}>
          <ScrollView
            ref={aiScrollRef}
            style={styles.tabScroll}
            contentContainerStyle={[styles.aiScrollContent, { flexGrow: 1, paddingBottom: Spacing.xxl }]}
            keyboardShouldPersistTaps="handled"
          >
            {showSpotOfflineGuide ? <OfflineFallbackGuide /> : null}
            <Text style={styles.aiOfflineHint}>
              Offline — strategy and chat stay on this device. The cards below your messages open full detail sheets.
              Reconnect to ask new questions.
            </Text>
            {spotAiStrategyFragment}
            <Text style={styles.aiContextNote}>
              Ask a question about this spot. The guide uses current conditions, location, and your DriftGuide logs when available.
            </Text>
            {aiMessages.map((msg) =>
              msg.role === 'ai' && msg.isOfflineSupplement ? (
                <View key={msg.id} style={styles.aiDriftGuideRow}>
                  <DriftGuideReferenceCard rawText={msg.text} colors={colors} />
                </View>
              ) : (
                <View
                  key={msg.id}
                  style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble]}
                >
                  {msg.role === 'user' ? (
                    <Text style={[styles.bubbleText, styles.bubbleTextUser]}>{msg.text}</Text>
                  ) : (
                    <SpotTaggedText text={msg.text} baseStyle={styles.bubbleText} />
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
              ),
            )}
            {aiLoading ? <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: Spacing.sm }} /> : null}
            <OfflineGuideActionStack
              colors={colors}
              sections={offlineSpotGuideSections}
              loading={offlineSpotGuideLoading}
              fliesStrategyContent={spotAiStrategyFragment}
              strategyLoading={summaryLoading || howToFishLoading}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}

      {activeTab === 'ai' && spotNetOn ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={120}>
          <ScrollView ref={aiScrollRef} style={styles.tabScroll} contentContainerStyle={styles.aiScrollContent} keyboardShouldPersistTaps="handled">
            {showSpotOfflineGuide ? <OfflineFallbackGuide /> : null}
            {spotAiStrategyFragment}
            <Text style={styles.aiContextNote}>
              Ask a question about this spot. The guide uses current conditions, location, and your DriftGuide logs when available.
            </Text>
            {aiMessages.map((msg) =>
              msg.role === 'ai' && msg.isOfflineSupplement ? (
                <View key={msg.id} style={styles.aiDriftGuideRow}>
                  <DriftGuideReferenceCard rawText={msg.text} colors={colors} />
                </View>
              ) : (
                <View
                  key={msg.id}
                  style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble]}
                >
                  {msg.role === 'user' ? (
                    <Text style={[styles.bubbleText, styles.bubbleTextUser]}>{msg.text}</Text>
                  ) : (
                    <SpotTaggedText text={msg.text} baseStyle={styles.bubbleText} />
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
              ),
            )}
            {aiLoading && <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: Spacing.sm }} />}
          </ScrollView>
          <View style={styles.aiInputRow}>
            <TextInput
              style={styles.aiInput}
              placeholder="Ask about this spot…"
              placeholderTextColor={colors.textTertiary}
              value={aiInput}
              onChangeText={setAiInput}
              editable={!aiLoading}
              multiline
              maxLength={500}
            />
            <Pressable
              style={styles.aiSendButton}
              onPress={handleAskAI}
              disabled={!aiInput.trim() || aiLoading}
            >
              <Ionicons name="send" size={20} color={colors.textInverse} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {activeTab === 'map' && (
        (() => {
          if (lat == null || lng == null) {
            return (
              <View style={styles.mapTabPlaceholder}>
                <MaterialIcons name="map" size={48} color={colors.textTertiary} />
                <Text style={styles.mapTabPlaceholderText}>No coordinates for this location.</Text>
              </View>
            );
          }
          return (
            <View style={styles.mapTabContainer}>
              <TripMapboxMapView
                containerStyle={styles.mapTabMap}
                centerCoordinate={[lng, lat]}
                zoomLevel={USER_LOCATION_ZOOM}
                markers={spotMapboxMarkers}
                showUserLocation={spotMapUserLayer}
                compassEnabled
              />
            </View>
          );
        })()
      )}

      <View style={styles.pinnedFooter}>
        {openedFromMap ? (
          <View style={styles.footerActionsRow}>
            <Pressable style={({ pressed }) => [styles.planTripFooterButton, pressed && styles.footerButtonPressed]} onPress={handlePlanTripHere}>
              <Text style={styles.selectButtonText}>Plan a Trip</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.fishNowFooterButton,
                (fishNowStarting || !location) && styles.footerButtonDisabled,
                pressed && !fishNowStarting && styles.footerButtonPressed,
              ]}
              onPress={handleFishNowHere}
              disabled={fishNowStarting || !location}
            >
              {fishNowStarting ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.fishNowFooterButtonText}>Fish Now</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.selectButton} onPress={handlePlanTripHere}>
            <Text style={styles.selectButtonText}>Select for trip</Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={manageMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setManageMenuOpen(false)}
      >
        <TouchableOpacity
          style={styles.manageMenuBackdrop}
          activeOpacity={1}
          onPress={() => setManageMenuOpen(false)}
        >
          <View style={styles.manageMenuCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.manageMenuTitle}>Your spot</Text>
            {creatorMenu && !creatorMenu.canManageUnusedOnly ? (
              <Text style={styles.manageMenuHint}>{USED_SPOT_MESSAGE}</Text>
            ) : null}
            <Pressable
              style={[
                styles.manageMenuRow,
                creatorMenu && !creatorMenu.canManageUnusedOnly && styles.manageMenuRowDisabled,
              ]}
              onPress={handleEditPin}
            >
              <MaterialIcons name="edit-location-alt" size={22} color={colors.primary} />
              <Text style={styles.manageMenuRowText}>Edit pin location</Text>
            </Pressable>
            <Pressable
              style={[
                styles.manageMenuRow,
                creatorMenu && !creatorMenu.canManageUnusedOnly && styles.manageMenuRowDisabled,
              ]}
              onPress={handleTogglePrivate}
            >
              <MaterialIcons
                name={location?.is_public !== false ? 'visibility-off' : 'visibility'}
                size={22}
                color={colors.primary}
              />
              <Text style={styles.manageMenuRowText}>
                {location?.is_public !== false ? 'Make private' : 'Make public'}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.manageMenuRow,
                creatorMenu && !creatorMenu.canManageUnusedOnly && styles.manageMenuRowDisabled,
              ]}
              onPress={handleDeleteLocation}
            >
              <MaterialIcons name="delete-outline" size={22} color={colors.error} />
              <Text style={[styles.manageMenuRowText, styles.manageMenuRowDestructive]}>Delete spot</Text>
            </Pressable>
            <Pressable style={styles.manageMenuCancel} onPress={() => setManageMenuOpen(false)}>
              <Text style={styles.manageMenuCancelText}>Close</Text>
            </Pressable>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function createSpotStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  pinnedFooter: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingBottom: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  footerActionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.sm,
  },
  planTripFooterButton: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fishNowFooterButton: {
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 112,
  },
  fishNowFooterButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
  footerButtonPressed: {
    opacity: 0.88,
  },
  footerButtonDisabled: {
    opacity: 0.5,
  },
  selectButton: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  selectButtonText: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: colors.textInverse,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  loadingLabel: {
    marginTop: Spacing.md,
    fontSize: FontSize.sm,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
  },
  tileLabelsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.xs,
  },
  ratingsPairLabelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.xs,
  },
  ratingsPairCommunityLabel: {
    flex: 1,
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'right',
  },
  ratingsPairTilesRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  ratingsPairTile: {
    flex: 1,
  },
  topTimesBlock: {
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  topTimesLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: Spacing.xs,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  bestTimeTileCentered: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 300,
    alignItems: 'center',
  },
  scoreTileMuted: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreMutedText: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  tileLabelLeftWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tileLabelLeft: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  /** Overview metric headers (title case; avoids all-caps truncation in 3-col row) */
  tileLabelColumn: {
    flex: 1,
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'left',
  },
  tilesRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  tile: {
    flex: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    justifyContent: 'center',
    minHeight: 52,
  },
  tileCompact: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    minHeight: 48,
  },
  scoreTile: {
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  scoreOneLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  scoreOneLineValue: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: colors.textInverse,
  },
  scoreOneLineValueCompact: {
    fontSize: FontSize.md,
  },
  locationRatingTile: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
  },
  locationRatingValue: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  locationRatingValueCompact: {
    fontSize: FontSize.md,
  },
  bestTimeTile: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tileLoader: {
    marginVertical: Spacing.xs,
  },
  bestTimeValue: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  bestTimeValueCompact: {
    fontSize: FontSize.sm,
  },
  bestTimePlaceholder: {
    fontSize: FontSize.md,
    color: colors.textTertiary,
  },
  conditionsCard: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  sectionTitleAbove: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  conditionsBlocksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: Spacing.md,
  },
  conditionCloudWrap: {
    justifyContent: 'center',
  },
  conditionBlock: {
    minWidth: 0,
    flexShrink: 0,
  },
  conditionBlockValueWrap: {
    minHeight: 32,
    justifyContent: 'flex-end',
    marginBottom: 2,
  },
  conditionBlockLabel: {
    fontSize: FontSize.xs,
    color: colors.textSecondary,
  },
  conditionBlockTemp: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: colors.primary,
  },
  conditionBlockValue: {
    fontSize: FontSize.md,
    fontWeight: '500',
    color: colors.text,
  },
  reportCard: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  reportLoader: {
    marginVertical: Spacing.sm,
  },
  reportText: {
    fontSize: FontSize.md,
    color: colors.text,
    lineHeight: 22,
  },
  reportPlaceholder: {
    fontSize: FontSize.md,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  staleNote: {
    fontSize: FontSize.xs,
    color: colors.warning,
    marginTop: Spacing.sm,
    lineHeight: 18,
  },
  sourcesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  sourcesToggleText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: colors.secondary,
  },
  sourceRow: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sourceTitle: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  sourceExcerpt: {
    marginTop: 4,
    fontSize: FontSize.xs,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  moreInfoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  moreInfoButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  detailedReportLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  detailedReportLoaderText: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
  },
  detailedReportBlock: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  detailedReportText: {
    fontSize: FontSize.md,
    color: colors.text,
    lineHeight: 24,
  },
  fliesCard: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  fliesLoader: {
    marginVertical: Spacing.sm,
  },
  fliesTwoCol: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  fliesColumn: {
    flex: 1,
  },
  flyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  flyBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.secondary,
  },
  flyName: {
    fontSize: FontSize.md,
    color: colors.text,
    flex: 1,
  },
  fliesPlaceholder: {
    fontSize: FontSize.md,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  strategyContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  strategyCard: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  guideSectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  guideSectionLabelFirst: {
    marginTop: 0,
  },
  guideCard: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  strategyLoader: {
    marginVertical: Spacing.sm,
  },
  strategyBestTime: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  howToFishText: {
    fontSize: FontSize.md,
    color: colors.text,
    lineHeight: 24,
  },
  guideStrategyFirstLabel: {
    marginTop: 0,
  },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: 2,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: colors.primary,
  },
  tabLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.textTertiary,
    textAlign: 'center',
  },
  tabLabelCompact: {
    fontSize: FontSize.xs,
  },
  tabLabelActive: {
    color: colors.primary,
  },
  tabScroll: {
    flex: 1,
  },
  aiScrollContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  aiGetRecButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: Spacing.md,
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
    marginBottom: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  smartRecHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  smartRecTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: colors.text,
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
    fontSize: FontSize.md,
    color: colors.textSecondary,
    marginTop: 2,
  },
  smartRecReason: {
    fontSize: FontSize.md,
    color: colors.text,
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  confidenceText: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
    marginTop: Spacing.sm,
  },
  aiOfflineHint: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  aiContextNote: {
    fontSize: FontSize.xs,
    color: colors.textTertiary,
    marginBottom: Spacing.md,
  },
  bubble: {
    maxWidth: '85%',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  aiDriftGuideRow: {
    alignSelf: 'flex-start',
    width: '100%',
    maxWidth: '85%',
  },
  bubbleText: {
    fontSize: FontSize.md,
    color: colors.text,
  },
  bubbleTextUser: {
    color: colors.textInverse,
  },
  aiInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  aiInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: colors.text,
  },
  aiSendButton: {
    marginLeft: Spacing.sm,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapTabContainer: {
    flex: 1,
    minHeight: 280,
  },
  accessPointMapBubble: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
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
  manageMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 56,
    paddingRight: Spacing.sm,
  },
  manageMenuCard: {
    minWidth: 260,
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  manageMenuTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  manageMenuHint: {
    fontSize: FontSize.xs,
    color: colors.textTertiary,
    lineHeight: 18,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  manageMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  manageMenuRowDisabled: {
    opacity: 0.45,
  },
  manageMenuRowText: {
    fontSize: FontSize.md,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
  },
  manageMenuRowDestructive: {
    color: colors.error,
  },
  manageMenuCancel: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: Spacing.xs,
  },
  manageMenuCancelText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  });
}

