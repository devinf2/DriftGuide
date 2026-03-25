import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Platform, KeyboardAvoidingView, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { useLocationStore } from '@/src/stores/locationStore';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchLocationConditions, getDriftGuideScore, getWeatherIconName, formatSkyLabel } from '@/src/services/conditions';
import { getSpotFishingSummary, getSpotDetailedReport, getSpotHowToFish, askAI, getSeason, getTimeOfDay } from '@/src/services/ai';
import { getWeather } from '@/src/services/weather';
import { getStreamFlow } from '@/src/services/waterFlow';
import type { LocationConditions, Location, WeatherData, WaterFlowData } from '@/src/types';
import { ConditionsTab } from '@/src/components/trip-tabs/ConditionsTab';

import { TripMapboxMapView } from '@/src/components/map/TripMapboxMapView';
import { USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import type { BoundingBox } from '@/src/types/boundingBox';
import { catalogLocationMarkersInViewport } from '@/src/utils/mapCatalogMarkers';

type SpotTabKey = 'overview' | 'conditions' | 'ai' | 'map';

export default function SpotFishingTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { locations, fetchLocations, getLocationById, setPendingPlanTripLocationId } = useLocationStore();

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

  const location = id ? getLocationById(id) : undefined;
  const navigation = useNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({
      title: location?.name ?? 'Fishing Trip',
      headerTitleStyle: { fontSize: FontSize.xl, fontWeight: '700' },
    });
  }, [navigation, location?.name]);

  useEffect(() => {
    if (locations.length === 0) fetchLocations();
  }, [locations.length, fetchLocations]);

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

  /** ~40–45 km padding so nearby catalog spots show at spot map zoom without viewport callbacks. */
  const SPOT_MAP_REGION_PAD = 0.35;
  const spotMapRegionBbox = useMemo((): BoundingBox | null => {
    if (lat == null || lng == null) return null;
    return {
      ne: { lat: lat + SPOT_MAP_REGION_PAD, lng: lng + SPOT_MAP_REGION_PAD },
      sw: { lat: lat - SPOT_MAP_REGION_PAD, lng: lng - SPOT_MAP_REGION_PAD },
    };
  }, [lat, lng]);

  const spotMapCatalogMarkers = useMemo(() => {
    if (!spotMapRegionBbox) return [];
    return catalogLocationMarkersInViewport(locations, spotMapRegionBbox, undefined);
  }, [locations, spotMapRegionBbox]);

  const spotMapboxMarkers = useMemo(
    () =>
      spotMapCatalogMarkers.map((m) => ({
        id: m.id,
        coordinate: [m.lon, m.lat] as [number, number],
        title: m.title,
        children: <MaterialIcons name="place" size={34} color={m.color} />,
      })),
    [spotMapCatalogMarkers],
  );

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
      const context = {
        location: location as Location,
        fishingType: 'fly' as const,
        weather: weatherData ?? null,
        waterFlow: waterFlowData ?? null,
        currentFly: null,
        fishCount: 0,
        recentEvents: [],
        timeOfDay: getTimeOfDay(new Date()),
        season: getSeason(new Date()),
      };
      const answer = await askAI(context, q);
      setAiMessages(prev => [...prev, { id: String(Date.now() + 1), role: 'ai', text: answer }]);
    } catch {
      setAiMessages(prev => [...prev, { id: String(Date.now() + 1), role: 'ai', text: 'Sorry, I couldn’t get an answer. Try again.' }]);
    } finally {
      setAiLoading(false);
    }
  }, [aiInput, location, conditions, weatherData, waterFlowData]);

  const handlePlanTripHere = () => {
    if (id) {
      setPendingPlanTripLocationId(id);
      router.back();
    }
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

  if (!id) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Missing spot</Text>
      </View>
    );
  }

  if (!location && locations.length > 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Spot not found</Text>
      </View>
    );
  }

  if (isLoading && !conditions) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingLabel}>Loading conditions…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
                    return <Ionicons key={i} name="star" size={22} color={Colors.textInverse} />;
                  }
                  if (isPartial) {
                    return (
                      <View key={i} style={styles.starPartialWrap}>
                        <Ionicons name="star-outline" size={22} color={Colors.textInverse} style={styles.starOutlineBg} />
                        <View style={[styles.starPartialFill, { width: 22 * partial }]}>
                          <Ionicons name="star" size={22} color={Colors.textInverse} />
                        </View>
                      </View>
                    );
                  }
                  return <Ionicons key={i} name="star-outline" size={22} color={Colors.textInverse} />;
                })}
                {score.showFire && (
                  <Ionicons name="flame" size={20} color={Colors.warning} style={styles.fireIcon} />
                )}
              </View>
            </View>
          )}
          <View style={[styles.tile, styles.bestTimeTile]}>
            {summaryLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} style={styles.tileLoader} />
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
                <Ionicons name={getWeatherIconName(conditions.sky.condition) as keyof typeof Ionicons.glyphMap} size={28} color={Colors.secondary} />
              </View>
              <View style={styles.conditionBlock}>
                <View style={styles.conditionBlockValueWrap}>
                  <Text style={styles.conditionBlockTemp}>{conditions.temperature.temp_f}°F</Text>
                </View>
                <Text style={styles.conditionBlockLabel}>{conditions.sky.label}</Text>
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
            <ActivityIndicator size="small" color={Colors.primary} style={styles.reportLoader} />
          ) : report ? (
            <Text style={styles.reportText}>{report}</Text>
          ) : (
            <Text style={styles.reportPlaceholder}>No report available.</Text>
          )}
          {report && conditions && !detailedReport && !detailedReportLoading && (
            <Pressable style={styles.moreInfoButton} onPress={handleMoreInfo}>
              <Text style={styles.moreInfoButtonText}>More info</Text>
              <Ionicons name="chevron-down" size={16} color={Colors.primary} />
            </Pressable>
          )}
          {detailedReportLoading && (
            <View style={styles.detailedReportLoader}>
              <ActivityIndicator size="small" color={Colors.primary} />
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
            <ActivityIndicator size="small" color={Colors.primary} style={styles.fliesLoader} />
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
                <ActivityIndicator size="small" color={Colors.primary} style={styles.strategyLoader} />
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
                <ActivityIndicator size="small" color={Colors.primary} style={styles.strategyLoader} />
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
                <ActivityIndicator size="small" color={Colors.primary} style={styles.strategyLoader} />
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
            {aiLoading && <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: Spacing.sm }} />}
          </ScrollView>
          <View style={styles.aiInputRow}>
            <TextInput
              style={styles.aiInput}
              placeholder="Ask about this spot…"
              placeholderTextColor={Colors.textTertiary}
              value={aiInput}
              onChangeText={setAiInput}
              editable={!aiLoading}
              multiline
              maxLength={500}
            />
            <Pressable style={styles.aiSendButton} onPress={handleAskAI} disabled={!aiInput.trim() || aiLoading}>
              <Ionicons name="send" size={20} color={Colors.textInverse} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

      {activeTab === 'map' && (
        (() => {
          if (lat == null || lng == null) {
            return (
              <View style={styles.mapTabPlaceholder}>
                <MaterialIcons name="map" size={48} color={Colors.textTertiary} />
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
                showUserLocation={false}
                compassEnabled
              />
            </View>
          );
        })()
      )}

      <View style={styles.pinnedFooter}>
        <Pressable style={styles.selectButton} onPress={handlePlanTripHere}>
          <Text style={styles.selectButtonText}>Select</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  selectButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  selectButtonText: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.textInverse,
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
    color: Colors.textSecondary,
  },
  errorText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
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
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  tileLabelRight: {
    flex: 1,
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
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
    backgroundColor: Colors.primary,
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
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  tileLoader: {
    marginVertical: Spacing.xs,
  },
  bestTimeValue: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  bestTimePlaceholder: {
    fontSize: FontSize.md,
    color: Colors.textTertiary,
  },
  conditionsCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  sectionTitleAbove: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
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
    color: Colors.textSecondary,
  },
  conditionBlockTemp: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.primary,
  },
  conditionBlockValue: {
    fontSize: FontSize.md,
    fontWeight: '500',
    color: Colors.text,
  },
  reportCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  reportLoader: {
    marginVertical: Spacing.sm,
  },
  reportText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 22,
  },
  reportPlaceholder: {
    fontSize: FontSize.md,
    color: Colors.textTertiary,
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
    color: Colors.primary,
  },
  detailedReportLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  detailedReportLoaderText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  detailedReportBlock: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  detailedReportText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 24,
  },
  fliesCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
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
    backgroundColor: Colors.secondary,
  },
  flyName: {
    fontSize: FontSize.md,
    color: Colors.text,
    flex: 1,
  },
  fliesPlaceholder: {
    fontSize: FontSize.md,
    color: Colors.textTertiary,
    fontStyle: 'italic',
  },
  strategyContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  strategyCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  guideSectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  guideSectionLabelFirst: {
    marginTop: 0,
  },
  guideCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  strategyLoader: {
    marginVertical: Spacing.sm,
  },
  strategyBestTime: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  howToFishText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 24,
  },
  guideStrategyFirstLabel: {
    marginTop: 0,
  },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
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
    borderBottomColor: Colors.primary,
  },
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
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
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
    marginBottom: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
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
    color: Colors.text,
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
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  smartRecReason: {
    fontSize: FontSize.md,
    color: Colors.text,
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  confidenceText: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginTop: Spacing.sm,
  },
  aiContextNote: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
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
    backgroundColor: Colors.primary,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  bubbleText: {
    fontSize: FontSize.md,
    color: Colors.text,
  },
  bubbleTextUser: {
    color: Colors.textInverse,
  },
  aiInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  aiInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
  },
  aiSendButton: {
    marginLeft: Spacing.sm,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
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
});
