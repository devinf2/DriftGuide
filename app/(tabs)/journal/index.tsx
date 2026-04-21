import {
  createJournalTripGridStyles,
  imageUrlsForTrip,
  JournalTripGridCard,
} from '@/src/components/journal/journalTripGrid';
import { CatalogLocationMapIcon } from '@/src/components/map/catalogLocationMapIcon';
import { TripMapboxMapView, type MapboxMapMarker } from '@/src/components/map/TripMapboxMapView';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '@/src/constants/mapDefaults';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { fetchPhotos } from '@/src/services/photoService';
import { fetchTripsFromCloud, fetchUserCatchesFromCloud } from '@/src/services/sync';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationFavoritesStore } from '@/src/stores/locationFavoritesStore';
import { useAppTheme, type ResolvedScheme } from '@/src/theme/ThemeProvider';
import {
    Trip,
    type CatchRow,
    type LocationType,
    type Photo,
} from '@/src/types';
import { formatFishCount, formatTripDate, formatTripDuration } from '@/src/utils/formatters';
import { COORD_STACK_EPS, displayLngLatForOverlappingItems } from '@/src/utils/mapPinDisplayOffset';
import { journalMapDefaultFraming } from '@/src/utils/mapViewport';
import { pushJournalTripDetail } from '@/src/utils/journalNavigation';
import { formatCatchWeightLabel } from '@/src/utils/journalTimeline';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { format, isAfter, startOfMonth, startOfWeek, startOfYear } from 'date-fns';
import * as ExpoLocation from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    FlatList,
    Image,
    Modal,
    Platform,
    Pressable, RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ViewMode = 'list' | 'map';
type MapLayer = 'journal' | 'fish';
type DateRange = 'all' | 'week' | 'month' | 'year';

const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
];

function catchRowGalleryUrls(c: CatchRow): string[] {
  const from = (c.photo_urls ?? []).map((u) => u?.trim()).filter(Boolean) as string[];
  if (from.length) return from;
  const u = c.photo_url?.trim();
  return u ? [u] : [];
}

interface LocationGroup {
  locationId: string;
  locationName: string;
  latitude: number;
  longitude: number;
  trips: Trip[];
}

export default function JournalScreen() {
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { user } = useAuthStore();
  const favoriteIds = useLocationFavoritesStore((s) => s.ids);
  const favoriteLocationIds = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const { colors, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createJournalStyles(colors, resolvedScheme), [colors, resolvedScheme]);
  const tripGridStyles = useMemo(() => createJournalTripGridStyles(colors), [colors]);
  const filterButtonRef = useRef<View>(null);

  const [allTrips, setAllTrips] = useState<Trip[]>([]);
  const [allCatches, setAllCatches] = useState<CatchRow[]>([]);
  const [allPhotos, setAllPhotos] = useState<Photo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [mapLayer, setMapLayer] = useState<MapLayer>('journal');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [showFilterPopup, setShowFilterPopup] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_MAP_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_MAP_ZOOM);
  const [mapCameraKey, setMapCameraKey] = useState(0);
  const [journalMapUserLocation, setJournalMapUserLocation] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<LocationGroup | null>(null);
  const [selectedFishCatch, setSelectedFishCatch] = useState<CatchRow | null>(null);

  const loadJournalData = useCallback(async () => {
    if (!user) return;
    const [trips, catches, photosResult] = await Promise.all([
      fetchTripsFromCloud(user.id),
      fetchUserCatchesFromCloud(user.id),
      fetchPhotos(user.id).catch(() => [] as Photo[]),
    ]);
    setAllTrips(trips.filter(t => t.status === 'completed'));
    setAllCatches(catches);
    setAllPhotos(photosResult);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadJournalData();
  }, [loadJournalData]);

  // Reload when screen gains focus (e.g. after deleting an entry and going back)
  useFocusEffect(
    useCallback(() => {
      loadJournalData();
    }, [loadJournalData]),
  );

  useEffect(() => {
    void (async () => {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status === 'granted') setJournalMapUserLocation(true);
    })();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadJournalData();
    setRefreshing(false);
  }, [loadJournalData]);

  const tripPhotoUrlsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const trip of allTrips) {
      map[trip.id] = imageUrlsForTrip(trip.id, allPhotos);
    }
    return map;
  }, [allTrips, allPhotos]);

  const filteredTrips = useMemo(() => {
    if (dateRange === 'all') return allTrips;

    const now = new Date();
    let cutoff: Date;
    switch (dateRange) {
      case 'week':
        cutoff = startOfWeek(now, { weekStartsOn: 0 });
        break;
      case 'month':
        cutoff = startOfMonth(now);
        break;
      case 'year':
        cutoff = startOfYear(now);
        break;
    }

    return allTrips.filter(t => isAfter(new Date(t.start_time), cutoff));
  }, [allTrips, dateRange]);

  const locationGroups = useMemo(() => {
    const groups = new Map<string, LocationGroup>();

    for (const trip of filteredTrips) {
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
  }, [filteredTrips]);

  const filteredCatches = useMemo(() => {
    if (dateRange === 'all') return allCatches;

    const now = new Date();
    let cutoff: Date;
    switch (dateRange) {
      case 'week':
        cutoff = startOfWeek(now, { weekStartsOn: 0 });
        break;
      case 'month':
        cutoff = startOfMonth(now);
        break;
      case 'year':
        cutoff = startOfYear(now);
        break;
    }

    return allCatches.filter(c => isAfter(new Date(c.timestamp), cutoff));
  }, [allCatches, dateRange]);

  const fishMapPins = useMemo(
    () => filteredCatches.filter(c => c.latitude != null && c.longitude != null),
    [filteredCatches],
  );

  const journalFraming = useMemo(
    () => journalMapDefaultFraming(filteredTrips, []),
    [filteredTrips],
  );

  useEffect(() => {
    if (loading) return;
    setMapCenter(journalFraming.center);
    setMapZoom(journalFraming.zoom);
    setMapCameraKey((k) => k + 1);
  }, [loading, journalFraming]);

  const tripNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allTrips) {
      if (t.location?.name) m.set(t.id, t.location.name);
    }
    return m;
  }, [allTrips]);

  const handleMarkerPress = useCallback(
    (group: LocationGroup) => {
      if (group.trips.length === 1) {
        pushJournalTripDetail(`/journal/${group.trips[0].id}`);
      } else {
        setSelectedGroup(group);
      }
    },
    [],
  );

  const handleFishMarkerPress = useCallback((c: CatchRow) => {
    setSelectedFishCatch(c);
  }, []);

  const mapboxMarkers = useMemo((): MapboxMapMarker[] => {
    if (mapLayer === 'journal') {
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
      const placeMarkers = sortedPlaceGroups.map((group) => {
        const coord =
          placeDisplayCoords.get(group.locationId) ?? ([group.longitude, group.latitude] as [number, number]);
        return {
        id: `journal-${group.locationId}`,
        coordinate: coord,
        title: group.locationName,
        onPress: () => handleMarkerPress(group),
        children: (
          <View style={styles.markerContainer} pointerEvents="box-none">
            <View style={styles.markerBadge}>
              <Text style={styles.markerBadgeText}>{group.trips.length}</Text>
            </View>
            <View style={styles.markerBubble}>
              <CatalogLocationMapIcon
                type={group.trips[0]?.location?.type as LocationType | undefined}
                color={colors.textInverse}
                size={20}
                isFavorite={favoriteLocationIds.has(group.locationId)}
              />
            </View>
            <Text style={styles.markerLabel} numberOfLines={1}>
              {group.locationName}
            </Text>
          </View>
        ),
      };
      });
      return placeMarkers;
    }
    return fishMapPins.map((c) => {
      const fishPhotos = catchRowGalleryUrls(c);
      const fishHero = fishPhotos[0];
      return {
        id: `fish-${c.id}`,
        coordinate: [c.longitude!, c.latitude!] as [number, number],
        title: c.species?.trim() || 'Catch',
        onPress: () => handleFishMarkerPress(c),
        /** Use catch-photo path so PointAnnotation refreshes after the image loads (bitmap snapshot). */
        catchPhotoUrl: fishHero ?? null,
      };
    });
  }, [
    mapLayer,
    locationGroups,
    fishMapPins,
    handleMarkerPress,
    handleFishMarkerPress,
    styles,
    colors,
    favoriteLocationIds,
  ]);

  const gridGap = Spacing.sm;
  const listPadX = Spacing.xl;
  const cardWidth = useMemo(() => {
    const pad = listPadX * 2 + insets.left + insets.right;
    return (winWidth - pad - gridGap) / 2;
  }, [winWidth, insets.left, insets.right]);

  const renderTrip = useCallback(
    ({ item }: { item: Trip }) => (
      <JournalTripGridCard
        trip={item}
        imageUrls={tripPhotoUrlsMap[item.id] ?? []}
        cardWidth={cardWidth}
        onPress={() => pushJournalTripDetail(`/journal/${item.id}`)}
        colors={colors}
        styles={tripGridStyles}
      />
    ),
    [tripPhotoUrlsMap, cardWidth, colors, tripGridStyles],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading trips...</Text>
      </View>
    );
  }

  const headerInactive = 'rgba(255,255,255,0.85)';
  const headerActiveIcon = colors.primary;

  return (
    <View style={styles.container}>
      {/* Blue safe area + header (List/Map + filter) */}
      <View style={[styles.journalHeaderWrap, { paddingTop: effectiveTop, paddingLeft: Spacing.xl + insets.left, paddingRight: Spacing.xl + insets.right }]}>
        <View style={styles.controlsBar}>
          <View style={styles.viewToggle}>
            <Pressable
              style={[styles.toggleButton, viewMode === 'list' && styles.toggleButtonActive]}
              onPress={() => {
                setViewMode('list');
                setSelectedGroup(null);
                setSelectedFishCatch(null);
              }}
            >
              <MaterialIcons
                name="view-list"
                size={18}
                color={viewMode === 'list' ? headerActiveIcon : headerInactive}
              />
              <Text style={[styles.toggleText, viewMode === 'list' && styles.toggleTextActive]}>
                List
              </Text>
            </Pressable>
            <Pressable
              style={[styles.toggleButton, viewMode === 'map' && styles.toggleButtonActive]}
              onPress={() => setViewMode('map')}
            >
              <MaterialIcons
                name="map"
                size={18}
                color={viewMode === 'map' ? headerActiveIcon : headerInactive}
              />
              <Text style={[styles.toggleText, viewMode === 'map' && styles.toggleTextActive]}>
                Map
              </Text>
            </Pressable>
          </View>
          <View ref={filterButtonRef} collapsable={false}>
            <Pressable
              style={[styles.filterButton, dateRange !== 'all' && styles.filterButtonActive]}
              onPress={() => {
                filterButtonRef.current?.measureInWindow((x, y, width, height) => {
                  setFilterAnchor({ x, y, width, height });
                  setShowFilterPopup(true);
                });
              }}
            >
              <MaterialIcons
                name="filter-list"
                size={22}
                color={dateRange !== 'all' ? headerActiveIcon : headerInactive}
              />
            </Pressable>
          </View>
        </View>
        {viewMode === 'map' && (
          <View style={styles.mapLayerRow}>
            <Pressable
              style={[styles.mapLayerChip, mapLayer === 'journal' && styles.mapLayerChipActive]}
              onPress={() => {
                setMapLayer('journal');
                setSelectedFishCatch(null);
              }}
            >
              <MaterialIcons
                name="route"
                size={16}
                color={mapLayer === 'journal' ? colors.primary : headerInactive}
              />
              <Text style={[styles.mapLayerChipText, mapLayer === 'journal' && styles.mapLayerChipTextActive]}>
                My Trips
              </Text>
            </Pressable>
            <Pressable
              style={[styles.mapLayerChip, mapLayer === 'fish' && styles.mapLayerChipActive]}
              onPress={() => {
                setMapLayer('fish');
                setSelectedGroup(null);
              }}
            >
              <MaterialCommunityIcons
                name="fish"
                size={16}
                color={mapLayer === 'fish' ? colors.primary : headerInactive}
              />
              <Text style={[styles.mapLayerChipText, mapLayer === 'fish' && styles.mapLayerChipTextActive]}>
                My Fish
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Filter dropdown */}
      <Modal
        visible={showFilterPopup}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFilterPopup(false)}
      >
        <Pressable style={styles.filterOverlay} onPress={() => setShowFilterPopup(false)}>
          {filterAnchor && (
            <View
              style={[
                styles.filterDropdown,
                {
                  top: filterAnchor.y + filterAnchor.height + 4,
                  right: Dimensions.get('window').width - (filterAnchor.x + filterAnchor.width),
                },
              ]}
              onStartShouldSetResponder={() => true}
            >
              <Text style={styles.filterPopupTitle}>Date range</Text>
              {DATE_RANGES.map(r => (
                <Pressable
                  key={r.key}
                  style={[styles.filterOption, dateRange === r.key && styles.filterOptionActive]}
                  onPress={() => {
                    setDateRange(r.key);
                    setShowFilterPopup(false);
                  }}
                >
                  <Text style={[styles.filterOptionText, dateRange === r.key && styles.filterOptionTextActive]}>
                    {r.label}
                  </Text>
                  {dateRange === r.key && (
                    <MaterialIcons name="check" size={20} color={colors.primary} />
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </Pressable>
      </Modal>

      {/* List View */}
      {viewMode === 'list' && (
        <FlatList
          data={filteredTrips}
          numColumns={2}
          renderItem={renderTrip}
          keyExtractor={(item) => item.id}
          nestedScrollEnabled
          columnWrapperStyle={filteredTrips.length > 0 ? styles.journalGridRow : undefined}
          contentContainerStyle={
            filteredTrips.length === 0
              ? styles.centered
              : [styles.journalGridList, { paddingLeft: Spacing.xl + insets.left, paddingRight: Spacing.xl + insets.right }]
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="route" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>
                {dateRange === 'all' ? 'No trips yet' : 'No trips in this period'}
              </Text>
              <Text style={styles.emptyText}>
                {dateRange === 'all'
                  ? 'Complete your first trip to begin building your fishing journal.'
                  : 'Try selecting a different date range.'}
              </Text>
            </View>
          }
        />
      )}

      {/* Map View */}
      {viewMode === 'map' && (
        <View style={styles.mapWrapper}>
          {Platform.OS === 'web' ? (
            <View style={styles.mapWebPlaceholder}>
              <MaterialIcons name="map" size={48} color={colors.textTertiary} />
              <Text style={styles.mapWebPlaceholderText}>
                Map is available in the iOS and Android app.
              </Text>
            </View>
          ) : (
            <TripMapboxMapView
              containerStyle={styles.map}
              centerCoordinate={mapCenter}
              zoomLevel={mapZoom}
              cameraKey={String(mapCameraKey)}
              markers={mapboxMarkers}
              showUserLocation={journalMapUserLocation}
              onZoomLevelChange={setMapZoom}
              reservePlanTripFabSpacing
              mapTabControlLayout
            />
          )}

          {mapLayer === 'journal' && locationGroups.length === 0 && (
            <View style={styles.mapEmptyOverlay} pointerEvents="none">
              <View style={styles.mapEmptyBubble}>
                <Text style={styles.mapEmptyText}>
                  {dateRange === 'all'
                    ? 'No trip locations on the map yet'
                    : 'Nothing on the map in this period'}
                </Text>
              </View>
            </View>
          )}

          {mapLayer === 'fish' && fishMapPins.length === 0 && (
            <View style={styles.mapEmptyOverlay} pointerEvents="none">
              <View style={styles.mapEmptyBubble}>
                <Text style={styles.mapEmptyText}>
                  {dateRange === 'all'
                    ? 'No fish with map pins yet'
                    : 'No fish in this period'}
                </Text>
              </View>
            </View>
          )}

          {/* Modal: select which entry to open when multiple trips at same place */}
          <Modal
            visible={!!selectedGroup}
            transparent
            animationType="slide"
            onRequestClose={() => setSelectedGroup(null)}
          >
            <View style={styles.entryModalRoot}>
              <Pressable style={styles.entryModalDim} onPress={() => setSelectedGroup(null)} />
              <View style={[styles.entryModalSheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
                {selectedGroup && (
                  <>
                    <View style={styles.selectedPanelHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectedPanelTitle}>{selectedGroup.locationName}</Text>
                        <Text style={styles.selectedPanelSubtitle}>
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
                          style={styles.selectedTripCard}
                          onPress={() => {
                            setSelectedGroup(null);
                            pushJournalTripDetail(`/journal/${item.id}`);
                          }}
                        >
                          <View style={styles.selectedTripRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.selectedTripDate}>{formatTripDate(item.start_time)}</Text>
                              <Text style={styles.selectedTripMeta}>
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
                      style={styles.selectedTripList}
                      contentContainerStyle={styles.selectedTripListContent}
                      showsVerticalScrollIndicator
                    />
                  </>
                )}
              </View>
            </View>
          </Modal>

          {/* Selected catch: image + details above sheet, actions below */}
          <Modal
            visible={selectedFishCatch != null}
            transparent
            animationType="slide"
            onRequestClose={() => setSelectedFishCatch(null)}
          >
            <View style={styles.entryModalRoot}>
              <Pressable style={styles.entryModalDim} onPress={() => setSelectedFishCatch(null)} />
              {selectedFishCatch != null ? (
                <View style={styles.fishCatchBottomStack}>
                  <ScrollView
                    style={[styles.fishCatchHeroScroll, { maxHeight: Math.round(winHeight * 0.48) }]}
                    contentContainerStyle={styles.fishCatchHeroScrollContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={styles.fishCatchHeroInner}>
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
                              style={[styles.fishCatchHeroImage, { width: winWidth - Spacing.lg * 2 }]}
                              resizeMode="cover"
                            />
                          ))}
                        </ScrollView>
                        );
                      })()}
                      <View style={styles.fishCatchHeroCard}>
                        <Text style={styles.fishCatchHeroTitle}>
                          {selectedFishCatch.species || 'Catch'}
                        </Text>
                        <Text style={styles.fishCatchHeroSubtitle}>
                          {format(new Date(selectedFishCatch.timestamp), 'MMM d, yyyy')}
                          {tripNameById.get(selectedFishCatch.trip_id)
                            ? ` · ${tripNameById.get(selectedFishCatch.trip_id)}`
                            : ''}
                        </Text>
                        {(selectedFishCatch.fly_pattern || selectedFishCatch.fly_size || selectedFishCatch.fly_color) ? (
                          <Text style={styles.fishCatchHeroRow}>
                            <MaterialCommunityIcons name="hook" size={14} color="rgba(255,255,255,0.92)" />{' '}
                            {[selectedFishCatch.fly_pattern, selectedFishCatch.fly_size ? `#${selectedFishCatch.fly_size}` : null, selectedFishCatch.fly_color].filter(Boolean).join(' ')}
                          </Text>
                        ) : null}
                        {(selectedFishCatch.size_inches != null ||
                          (selectedFishCatch.quantity != null && selectedFishCatch.quantity > 1)) ? (
                          <Text style={styles.fishCatchHeroRow}>
                            <MaterialCommunityIcons name="ruler" size={14} color="rgba(255,255,255,0.92)" />{' '}
                            {[
                              selectedFishCatch.size_inches != null ? `${selectedFishCatch.size_inches}"` : null,
                              selectedFishCatch.quantity != null && selectedFishCatch.quantity > 1
                                ? `×${selectedFishCatch.quantity}`
                                : null,
                            ].filter(Boolean).join(' · ')}
                          </Text>
                        ) : null}
                        {formatCatchWeightLabel(selectedFishCatch.weight_lb, selectedFishCatch.weight_oz) ? (
                          <Text style={styles.fishCatchHeroRow}>
                            <MaterialCommunityIcons name="scale-balance" size={14} color="rgba(255,255,255,0.92)" />{' '}
                            {formatCatchWeightLabel(selectedFishCatch.weight_lb, selectedFishCatch.weight_oz)}
                          </Text>
                        ) : null}
                        {selectedFishCatch.note ? (
                          <Text style={styles.fishCatchHeroNote}>{selectedFishCatch.note}</Text>
                        ) : null}
                      </View>
                    </View>
                  </ScrollView>
                  <View style={[styles.fishCatchSheetActions, { paddingBottom: insets.bottom + Spacing.lg }]}>
                    <View style={styles.fishCatchSheetHeader}>
                      <Pressable onPress={() => setSelectedFishCatch(null)} hitSlop={12} style={styles.fishCatchSheetClose}>
                        <MaterialIcons name="close" size={22} color={colors.textSecondary} />
                      </Pressable>
                    </View>
                    <Pressable
                      style={styles.fishOpenJournalBtn}
                      onPress={() => {
                        const id = selectedFishCatch.trip_id;
                        setSelectedFishCatch(null);
                        pushJournalTripDetail(`/journal/${id}`);
                      }}
                    >
                      <Text style={styles.fishOpenJournalBtnText}>Open trip</Text>
                      <MaterialIcons name="chevron-right" size={20} color={colors.textInverse} />
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          </Modal>
        </View>
      )}
    </View>
  );
}

function createJournalStyles(colors: ThemeColors, scheme: ResolvedScheme) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  loadingText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
    marginTop: Spacing.sm,
  },

  /** Match Plan a Trip header navy (#2C4670): in dark mode `primary` is the lighter blue. */
  journalHeaderWrap: {
    backgroundColor: scheme === 'dark' ? colors.primaryDark : colors.primary,
  },
  controlsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  viewToggle: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: BorderRadius.md,
    padding: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: {
    backgroundColor: colors.textInverse,
    borderColor: colors.textInverse,
  },
  filterOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  filterDropdown: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.xs,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  filterPopupTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  filterOptionActive: {
    backgroundColor: colors.borderLight,
  },
  filterOptionText: {
    fontSize: FontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  filterOptionTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.md - 2,
    gap: Spacing.xs,
  },
  toggleButtonActive: {
    backgroundColor: colors.textInverse,
  },
  toggleText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },
  toggleTextActive: {
    color: colors.primary,
  },
  mapLayerRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  mapLayerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  mapLayerChipActive: {
    backgroundColor: colors.textInverse,
    borderColor: colors.textInverse,
  },
  mapLayerChipText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },
  mapLayerChipTextActive: {
    color: colors.primary,
  },

  // List view (2-column grid)
  journalGridList: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  journalGridRow: {
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  empty: {
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: FontSize.xl,
    fontWeight: '600',
    color: colors.text,
    marginTop: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },

  // Map view
  mapWrapper: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  mapWebPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
    backgroundColor: colors.surface,
  },
  mapWebPlaceholderText: {
    marginTop: Spacing.md,
    fontSize: FontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  markerContainer: {
    alignItems: 'center',
    width: 80,
  },
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
  markerBadgeText: {
    color: colors.textInverse,
    fontSize: 11,
    fontWeight: '700',
  },
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
  mapEmptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapEmptyBubble: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  mapEmptyText: {
    color: '#FFFFFF',
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  // Entry selection modal (multiple trips at same place)
  entryModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  entryModalDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  entryModalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    maxHeight: '58%',
    minHeight: 220,
    paddingHorizontal: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
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
  selectedPanelTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  selectedPanelSubtitle: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  selectedTripList: {
    maxHeight: 320,
  },
  selectedTripListContent: {
    paddingBottom: Spacing.xl,
    paddingTop: Spacing.xs,
  },
  selectedTripCard: {
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  selectedTripRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectedTripDate: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  selectedTripMeta: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  fishCatchBottomStack: {
    width: '100%',
  },
  fishCatchHeroScroll: {
    flexGrow: 0,
  },
  fishCatchHeroScrollContent: {
    paddingBottom: Spacing.sm,
    flexGrow: 0,
  },
  fishCatchHeroInner: {
    paddingHorizontal: Spacing.lg,
  },
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
  fishCatchHeroTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: colors.textInverse,
  },
  fishCatchHeroSubtitle: {
    fontSize: FontSize.sm,
    color: 'rgba(255,255,255,0.88)',
    marginTop: Spacing.xs,
  },
  fishCatchHeroRow: {
    fontSize: FontSize.md,
    color: 'rgba(255,255,255,0.92)',
    marginTop: Spacing.sm,
  },
  fishCatchHeroNote: {
    fontSize: FontSize.sm,
    color: 'rgba(255,255,255,0.78)',
    marginTop: Spacing.md,
    lineHeight: 20,
  },
  fishCatchSheetActions: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 12,
  },
  fishCatchSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  fishCatchSheetClose: {
    marginRight: -Spacing.xs,
  },
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
  fishOpenJournalBtnText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.textInverse,
  },
  });
}
