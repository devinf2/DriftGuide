import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Platform, KeyboardAvoidingView, TextInput, Modal, Alert, TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { fetchLocationConditions, getDriftGuideScore, getWeatherIconName } from '@/src/services/conditions';
import { getSpotFishingSummary, getSpotDetailedReport, getSpotHowToFish, askAI, getSeason, getTimeOfDay } from '@/src/services/ai';
import { getWeather } from '@/src/services/weather';
import { getStreamFlow } from '@/src/services/waterFlow';
import type { AccessPoint, LocationConditions, Location, WeatherData, WaterFlowData } from '@/src/types';
import { fetchApprovedAccessPointsForLocations } from '@/src/services/accessPointService';
import { ConditionsTab } from '@/src/components/trip-tabs/ConditionsTab';

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

const USED_SPOT_MESSAGE =
  'Another angler has this spot on a trip. You can’t change the pin, visibility, or delete it until their trips no longer use it.';

type SpotTabKey = 'overview' | 'conditions' | 'ai' | 'map';

/** In-screen header avoids iOS 26+ UIBarButtonItem “glass” behind native `headerRight`. */
function SpotModalHeader({
  title,
  topInset,
  showMenu,
  onBack,
  onOpenMenu,
}: {
  title: string;
  topInset: number;
  showMenu: boolean;
  onBack: () => void;
  onOpenMenu: () => void;
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
          alignItems: 'flex-end',
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
        {showMenu ? (
          <Pressable
            onPress={onOpenMenu}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Location options"
          >
            <MaterialIcons name="more-vert" size={24} color={colors.textInverse} />
          </Pressable>
        ) : (
          <View style={headerStyles.spotModalHeaderIconSlot} />
        )}
      </View>
    </View>
  );
}

export default function SpotFishingTripScreen() {
  const { colors, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createSpotStyles(colors), [colors]);

  const { id, planTripPicker, fromPlanTrip } = useLocalSearchParams<{
    id: string;
    planTripPicker?: string;
    /** Set when opening spot from Plan a Trip (suggestions or search) so Select returns to that screen with the water chosen. */
    fromPlanTrip?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { locations, fetchLocations, getLocationById, setPendingPlanTripLocationId } = useLocationStore();
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
  const [aiMessages, setAiMessages] = useState<{ id: string; role: 'user' | 'ai'; text: string }[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiScrollRef = useRef<ScrollView>(null);
  const [howToFish, setHowToFish] = useState<string | null>(null);
  const [howToFishLoading, setHowToFishLoading] = useState(false);
  const [approvedAccessPoints, setApprovedAccessPoints] = useState<AccessPoint[]>([]);

  const location = id ? getLocationById(id) : undefined;

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
    if (!location) {
      setApprovedAccessPoints([]);
      return;
    }
    const ids = [...spotMapRelatedLocationIds(location, locations)];
    void fetchApprovedAccessPointsForLocations(ids).then(setApprovedAccessPoints);
  }, [location, locations]);

  useEffect(() => {
    if (!location || !id) return;

    let cancelled = false;
    setLoading(true);
    setConditions(null);

    fetchLocationConditions(location, locations).then(c => {
      if (!cancelled) {
        setConditions(c);
        setLoading(false);

        setSummaryLoading(true);
        getSpotFishingSummary(location.name, c).then(s => {
          if (!cancelled) {
            setReport(s.report);
            setTopFlies(s.topFlies);
            setBestTime(s.bestTime);
            setSummaryLoading(false);
          }
        });
      }
    });

    return () => { cancelled = true; };
  }, [id, location?.id, locations]);

  const score = conditions ? getDriftGuideScore(conditions) : null;
  const isLoading = loading || !location;

  const parent = location?.parent_location_id && locations.length ? locations.find(l => l.id === location.parent_location_id) : null;
  const lat = location?.latitude ?? parent?.latitude ?? null;
  const lng = location?.longitude ?? parent?.longitude ?? null;
  const stationId = (location?.metadata as Record<string, string> | null)?.usgs_station_id;

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
  ]);

  useEffect(() => {
    if (activeTab !== 'conditions' || !location) return;
    setConditionsTabLoading(true);
    Promise.all([
      lat != null && lng != null ? getWeather(lat, lng) : Promise.resolve(null),
      stationId ? getStreamFlow(stationId) : Promise.resolve(null),
    ]).then(([w, wf]) => {
      setWeatherData(w ?? null);
      setWaterFlowData(wf ?? null);
      setConditionsTabLoading(false);
    }).catch(() => setConditionsTabLoading(false));
  }, [activeTab, location?.id, lat, lng, stationId]);

  const refreshConditions = useCallback(() => {
    if (!location || activeTab !== 'conditions') return;
    setConditionsTabLoading(true);
    Promise.all([
      lat != null && lng != null ? getWeather(lat, lng) : Promise.resolve(null),
      stationId ? getStreamFlow(stationId) : Promise.resolve(null),
    ]).then(([w, wf]) => {
      setWeatherData(w ?? null);
      setWaterFlowData(wf ?? null);
      setConditionsTabLoading(false);
    }).catch(() => setConditionsTabLoading(false));
  }, [location?.id, lat, lng, stationId, activeTab]);

  const fetchHowToFish = useCallback(() => {
    if (!location || !conditions) return;
    setHowToFishLoading(true);
    setHowToFish(null);
    getSpotHowToFish(location.name, conditions).then((text) => {
      setHowToFish(text);
      setHowToFishLoading(false);
    }).catch(() => setHowToFishLoading(false));
  }, [location?.id, conditions]);

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
      setAiMessages(prev => [...prev, { id: String(Date.now() + 1), role: 'ai', text: answer }]);
    } catch {
      setAiMessages(prev => [...prev, { id: String(Date.now() + 1), role: 'ai', text: 'Sorry, I couldn’t get an answer. Try again.' }]);
    } finally {
      setAiLoading(false);
    }
  }, [aiInput, location, conditions, weatherData, waterFlowData, locations, user?.id]);

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

  const handleMoreInfo = () => {
    if (!location || !conditions) return;
    setDetailedReportLoading(true);
    setDetailedReport(null);
    getSpotDetailedReport(location.name, conditions).then(text => {
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
                router.back();
              } else {
                Alert.alert('Could not delete', USED_SPOT_MESSAGE);
              }
            },
          },
        ],
      );
    });
  }, [id, runCreatorActionIfAllowed, fetchLocations, router]);

  const spotHeaderTitle = location?.name ?? 'Fishing Trip';
  const showSpotCreatorMenu = creatorMenu?.isCreator === true;

  if (!id) {
    return (
      <View style={styles.container}>
        <SpotModalHeader
          title="Fishing Trip"
          topInset={insets.top}
          showMenu={false}
          onBack={handleHeaderBack}
          onOpenMenu={() => setManageMenuOpen(true)}
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
          topInset={insets.top}
          showMenu={showSpotCreatorMenu}
          onBack={handleHeaderBack}
          onOpenMenu={() => setManageMenuOpen(true)}
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
          topInset={insets.top}
          showMenu={showSpotCreatorMenu}
          onBack={handleHeaderBack}
          onOpenMenu={() => setManageMenuOpen(true)}
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
        topInset={insets.top}
        showMenu={showSpotCreatorMenu}
        onBack={handleHeaderBack}
        onOpenMenu={() => setManageMenuOpen(true)}
      />
      <View style={styles.tabBar}>
        {([
          { key: 'overview' as SpotTabKey, label: 'Overview' },
          { key: 'conditions' as SpotTabKey, label: 'Conditions' },
          { key: 'ai' as SpotTabKey, label: 'AI Guide' },
          { key: 'map' as SpotTabKey, label: 'Map' },
        ]).map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      {activeTab === 'overview' && (
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Labels row: DriftGuide Rating | Best time to fish */}
        <View style={styles.tileLabelsRow}>
          <Text style={styles.tileLabelLeft}>DriftGuide Rating</Text>
          <Text style={styles.tileLabelRight}>Best time to fish</Text>
        </View>
        {/* Tiles row: stars + fire | best time value */}
        <View style={styles.tilesRow}>
          {score !== null && (
            <View style={[styles.tile, styles.scoreTile]}>
              <View style={styles.starsRow}>
                {[0, 1, 2, 3, 4].map((i) => {
                  const fullStars = Math.floor(score.stars);
                  const partial = score.stars - fullStars;
                  const isFull = i < fullStars;
                  const isPartial = i === fullStars && partial > 0.05;
                  if (isFull) {
                    return <Ionicons key={i} name="star" size={22} color={colors.textInverse} />;
                  }
                  if (isPartial) {
                    return (
                      <View key={i} style={styles.starPartialWrap}>
                        <Ionicons name="star-outline" size={22} color={colors.textInverse} style={styles.starOutlineBg} />
                        <View style={[styles.starPartialFill, { width: 22 * partial }]}>
                          <Ionicons name="star" size={22} color={colors.textInverse} />
                        </View>
                      </View>
                    );
                  }
                  return <Ionicons key={i} name="star-outline" size={22} color={colors.textInverse} />;
                })}
                {score.showFire && (
                  <Ionicons name="flame" size={20} color={colors.warning} style={styles.fireIcon} />
                )}
              </View>
            </View>
          )}
          <View style={[styles.tile, styles.bestTimeTile]}>
            {summaryLoading ? (
              <ActivityIndicator size="small" color={colors.primary} style={styles.tileLoader} />
            ) : bestTime ? (
              <Text style={styles.bestTimeValue} numberOfLines={1}>{bestTime}</Text>
            ) : (
              <Text style={styles.bestTimePlaceholder}>—</Text>
            )}
          </View>
        </View>

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

      {activeTab === 'ai' && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={120}>
          <ScrollView ref={aiScrollRef} style={styles.tabScroll} contentContainerStyle={styles.aiScrollContent} keyboardShouldPersistTaps="handled">
            {/* Best time to fish */}
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

            {/* Top flies */}
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

            {/* How to fish it */}
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

            <Text style={styles.aiContextNote}>Ask a question about this spot. AI uses current conditions and location.</Text>
            {aiMessages.map((msg) => (
              <View key={msg.id} style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble]}>
                <Text style={[styles.bubbleText, msg.role === 'user' && styles.bubbleTextUser]}>{msg.text}</Text>
              </View>
            ))}
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
            <Pressable style={styles.aiSendButton} onPress={handleAskAI} disabled={!aiInput.trim() || aiLoading}>
              <Ionicons name="send" size={20} color={colors.textInverse} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

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
        <Pressable style={styles.selectButton} onPress={handlePlanTripHere}>
          <Text style={styles.selectButtonText}>Select for trip</Text>
        </Pressable>
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
  tileLabelLeft: {
    flex: 1,
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  tileLabelRight: {
    flex: 1,
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
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
  scoreTile: {
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  starPartialWrap: {
    width: 22,
    height: 22,
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
    marginLeft: Spacing.sm,
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

