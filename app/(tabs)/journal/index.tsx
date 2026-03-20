import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl,
  ActivityIndicator, Modal, Dimensions,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Region } from 'react-native-maps';
import * as ExpoLocation from 'expo-location';
import { startOfWeek, startOfMonth, startOfYear, isAfter } from 'date-fns';
import { Colors, Spacing, FontSize, BorderRadius, LocationTypeColors } from '@/src/constants/theme';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchTripsFromCloud } from '@/src/services/sync';
import { Trip } from '@/src/types';
import type { LocationType } from '@/src/types';
import type { WaterFlowData } from '@/src/types';
import { formatTripDate, formatTripDuration, formatFishCount } from '@/src/utils/formatters';
import { MaterialIcons } from '@expo/vector-icons';

type ViewMode = 'list' | 'map';
type DateRange = 'all' | 'week' | 'month' | 'year';

const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
];

const US_CENTER: Region = {
  latitude: 39.8,
  longitude: -98.5,
  latitudeDelta: 25,
  longitudeDelta: 25,
};

const CLARITY_LABELS: Record<string, string> = {
  clear: 'Clear',
  slightly_stained: 'Slightly stained',
  stained: 'Stained',
  murky: 'Murky',
  blown_out: 'Blown out',
  unknown: '',
};

/** Short condition line for list cards: weather (temp + condition) or water (clarity / flow). */
function getTripInsight(trip: Trip): string | null {
  const w = trip.weather_cache;
  if (w) return `${Math.round(w.temperature_f)}° ${w.condition}`;
  const water = trip.water_flow_cache as WaterFlowData | null;
  if (water) {
    if (water.clarity && water.clarity !== 'unknown') {
      return CLARITY_LABELS[water.clarity] || null;
    }
    return `${Math.round(water.flow_cfs)} cfs`;
  }
  return null;
}

interface LocationGroup {
  locationId: string;
  locationName: string;
  latitude: number;
  longitude: number;
  trips: Trip[];
}

export default function JournalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const mapRef = useRef<MapView>(null);
  const filterButtonRef = useRef<View>(null);

  const [allTrips, setAllTrips] = useState<Trip[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [showFilterPopup, setShowFilterPopup] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [mapRegion, setMapRegion] = useState<Region>(US_CENTER);
  const [selectedGroup, setSelectedGroup] = useState<LocationGroup | null>(null);

  const loadTrips = useCallback(async () => {
    if (!user) return;
    const data = await fetchTripsFromCloud(user.id);
    setAllTrips(data.filter(t => t.status === 'completed'));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  // Reload when screen gains focus (e.g. after deleting an entry and going back)
  useFocusEffect(
    useCallback(() => {
      loadTrips();
    }, [loadTrips]),
  );

  useEffect(() => {
    (async () => {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        setMapRegion({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 4,
          longitudeDelta: 4,
        });
      }
    })();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTrips();
    setRefreshing(false);
  }, [loadTrips]);

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

  const handleMarkerPress = useCallback(
    (group: LocationGroup) => {
      if (group.trips.length === 1) {
        router.push(`/journal/${group.trips[0].id}`);
      } else {
        setSelectedGroup(group);
      }
    },
    [router],
  );

  const renderTrip = ({ item }: { item: Trip }) => {
    const locationType = item.location?.type as LocationType | undefined;
    const accent = locationType && LocationTypeColors[locationType]
      ? LocationTypeColors[locationType]
      : Colors.primary;
    return (
      <Pressable
        style={styles.tripCard}
        onPress={() => router.push(`/journal/${item.id}`)}
      >
        <View style={[styles.tripCardAccent, { backgroundColor: accent }]} />
        <View style={styles.tripCardContent}>
          <View style={styles.tripHeader}>
            <View style={styles.tripLocationRow}>
              <MaterialIcons name="place" size={18} color={accent} style={styles.tripLocationIcon} />
              <Text style={styles.tripLocation} numberOfLines={1}>
                {item.location?.name || 'Unknown Location'}
              </Text>
            </View>
            <Text style={styles.tripDate}>{formatTripDate(item.start_time)}</Text>
          </View>
          <View style={styles.tripMeta}>
            <View style={[styles.tripMetaPill, { backgroundColor: `${accent}18` }]}>
              <Text style={[styles.tripStat, { color: accent }]}>
                {formatFishCount(item.total_fish)}
              </Text>
            </View>
            <Text style={styles.tripDivider}>·</Text>
            <Text style={styles.tripStat}>
              {formatTripDuration(item.start_time, item.end_time)}
            </Text>
            {getTripInsight(item) && (
              <>
                <Text style={styles.tripDivider}>·</Text>
                <Text style={styles.tripStat} numberOfLines={1}>
                  {getTripInsight(item)}
                </Text>
              </>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading trips...</Text>
      </View>
    );
  }

  const headerInactive = 'rgba(255,255,255,0.85)';
  const headerActiveIcon = Colors.primary;

  return (
    <View style={styles.container}>
      {/* Blue safe area + header (List/Map + filter) */}
      <View style={[styles.journalHeaderWrap, { paddingTop: insets.top, paddingLeft: Spacing.xl + insets.left, paddingRight: Spacing.xl + insets.right }]}>
        <View style={styles.controlsBar}>
          <View style={styles.viewToggle}>
            <Pressable
              style={[styles.toggleButton, viewMode === 'list' && styles.toggleButtonActive]}
              onPress={() => { setViewMode('list'); setSelectedGroup(null); }}
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
                    <MaterialIcons name="check" size={20} color={Colors.primary} />
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
          renderItem={renderTrip}
          keyExtractor={(item) => item.id}
          contentContainerStyle={
            filteredTrips.length === 0
              ? styles.centered
              : [styles.list, { paddingLeft: Spacing.xl + insets.left, paddingRight: Spacing.xl + insets.right }]
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="menu-book" size={48} color={Colors.textTertiary} />
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
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={mapRegion}
            showsUserLocation
            showsMyLocationButton
            mapType="standard"
            onPress={() => setSelectedGroup(null)}
          >
            {locationGroups.map(group => (
              <Marker
                key={group.locationId}
                coordinate={{ latitude: group.latitude, longitude: group.longitude }}
                pinColor="transparent"
                onPress={() => handleMarkerPress(group)}
              >
                <View style={styles.markerContainer}>
                  <View style={styles.markerBadge}>
                    <Text style={styles.markerBadgeText}>{group.trips.length}</Text>
                  </View>
                  <View style={styles.markerBubble}>
                    <MaterialIcons name="place" size={20} color={Colors.textInverse} />
                  </View>
                  <Text style={styles.markerLabel} numberOfLines={1}>
                    {group.locationName}
                  </Text>
                </View>
              </Marker>
            ))}
          </MapView>

          {filteredTrips.length === 0 && (
            <View style={styles.mapEmptyOverlay} pointerEvents="none">
              <View style={styles.mapEmptyBubble}>
                <Text style={styles.mapEmptyText}>
                  {dateRange === 'all' ? 'No trips with locations yet' : 'No trips in this period'}
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
            <Pressable
              style={styles.entryModalOverlay}
              onPress={() => setSelectedGroup(null)}
            >
              <View
                style={[styles.entryModalSheet, { paddingBottom: insets.bottom + Spacing.lg }]}
                onStartShouldSetResponder={() => true}
              >
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
                        <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
                      </Pressable>
                    </View>
                    <FlatList
                      data={selectedGroup.trips}
                      renderItem={({ item }) => (
                        <Pressable
                          style={styles.selectedTripCard}
                          onPress={() => {
                            setSelectedGroup(null);
                            router.push(`/journal/${item.id}`);
                          }}
                        >
                          <View style={styles.selectedTripRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.selectedTripDate}>{formatTripDate(item.start_time)}</Text>
                              <Text style={styles.selectedTripMeta}>
                                {formatFishCount(item.total_fish)} · {formatTripDuration(item.start_time, item.end_time)}
                              </Text>
                            </View>
                            <MaterialIcons name="chevron-right" size={20} color={Colors.textTertiary} />
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
            </Pressable>
          </Modal>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  loadingText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },

  journalHeaderWrap: {
    backgroundColor: Colors.primary,
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
    backgroundColor: Colors.textInverse,
    borderColor: Colors.textInverse,
  },
  filterOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  filterDropdown: {
    position: 'absolute',
    backgroundColor: Colors.surface,
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
    color: Colors.textSecondary,
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
    backgroundColor: Colors.borderLight,
  },
  filterOptionText: {
    fontSize: FontSize.md,
    color: Colors.text,
    fontWeight: '500',
  },
  filterOptionTextActive: {
    color: Colors.primary,
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
    backgroundColor: Colors.textInverse,
  },
  toggleText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },
  toggleTextActive: {
    color: Colors.primary,
  },

  // List view
  list: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: 6,
  },
  tripCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    minHeight: 88,
    marginBottom: 6,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 3,
  },
  tripCardAccent: {
    width: 5,
    borderTopLeftRadius: BorderRadius.lg,
    borderBottomLeftRadius: BorderRadius.lg,
  },
  tripCardContent: {
    flex: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  tripHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  tripLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  tripLocationIcon: {
    marginRight: Spacing.xs,
  },
  tripLocation: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
  },
  tripDate: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginLeft: Spacing.xs,
  },
  tripMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  tripMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    gap: 4,
  },
  tripStat: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  tripDivider: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
  },
  empty: {
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: FontSize.xl,
    fontWeight: '600',
    color: Colors.text,
    marginTop: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
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
  markerContainer: {
    alignItems: 'center',
    width: 80,
  },
  markerBadge: {
    backgroundColor: Colors.accent,
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
    color: Colors.textInverse,
    fontSize: 11,
    fontWeight: '700',
  },
  markerBubble: {
    backgroundColor: Colors.primary,
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
    color: Colors.text,
    marginTop: 2,
    textAlign: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
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
  entryModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  entryModalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    maxHeight: '50%',
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
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  selectedPanelTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  selectedPanelSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  selectedTripList: {
    flexGrow: 0,
    paddingHorizontal: Spacing.lg,
  },
  selectedTripListContent: {
    paddingBottom: Spacing.xl,
    paddingTop: Spacing.xs,
  },
  selectedTripCard: {
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  selectedTripRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectedTripDate: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  selectedTripMeta: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
});
