import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Modal,
  Dimensions,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { TripEndpointPinModal, type TripEndpointKind } from '@/src/components/journal/TripEndpointPinModal';
import { fetchTripEvents, fetchTripsFromCloud, syncTripToCloud } from '@/src/services/sync';
import { fetchPhotos } from '@/src/services/photoService';
import { Trip, TripEvent, CatchData, FlyChangeData, NoteData, AIQueryData, WaterFlowData, NextFlyRecommendation, EventConditionsSnapshot, Photo } from '@/src/types';
import { getCatchHeroPhotoUrl } from '@/src/utils/catchPhotos';
import { formatTripDate, formatTripDuration, formatEventTime, formatFlowRate, formatTemperature } from '@/src/utils/formatters';
import { useAuthStore } from '@/src/stores/authStore';
import { useTripStore } from '@/src/stores/tripStore';
import { getFlowStatus, FLOW_STATUS_LABELS, FLOW_STATUS_COLORS } from '@/src/services/waterFlow';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { JournalTripRouteMapView, buildJournalWaypoints } from '@/src/components/map/JournalTripRouteMapView';
import { ConditionsTab } from '@/src/components/trip-tabs/ConditionsTab';
import { JournalFishingTimeline } from '@/src/components/journal/JournalFishingTimeline';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { tripStartEndDisplayCoords } from '@/src/utils/tripStartEndFromEvents';

type TabKey = 'fishing' | 'photos' | 'conditions' | 'ai' | 'map';

export default function TripSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { deleteTrip } = useTripStore();
  const { isConnected } = useNetworkStatus();
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
  const [tripPinModal, setTripPinModal] = useState<TripEndpointKind | null>(null);
  /** Map tab: catch pin tapped when there is no photo (full-screen flow uses `fullScreenPhoto`) */
  const [mapCatchDetailEvent, setMapCatchDetailEvent] = useState<TripEvent | null>(null);

  useEffect(() => {
    setJournalEditMode(false);
    setTripPinModal(null);
  }, [id]);

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

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
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
          <Pressable style={styles.backButton} onPress={() => router.back()}>
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
              router.back();
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
                  <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
                </Pressable>
              </View>
              {(() => {
                const d = mapCatchDetailEvent.data as CatchData;
                return (
                  <>
                    {d.size_inches != null ? (
                      <Text style={styles.mapCatchModalRow}>
                        <MaterialCommunityIcons name="ruler" size={16} color={Colors.textSecondary} /> {d.size_inches}
                        {'"'}{' '}
                        {d.quantity != null && d.quantity > 1 ? `· ×${d.quantity}` : ''}
                      </Text>
                    ) : d.quantity != null && d.quantity > 1 ? (
                      <Text style={styles.mapCatchModalRow}>
                        <MaterialCommunityIcons name="fish" size={16} color={Colors.textSecondary} /> ×{d.quantity}
                      </Text>
                    ) : null}
                    {d.released ? (
                      <Text style={styles.mapCatchModalRow}>
                        <MaterialCommunityIcons name="water" size={16} color={Colors.textSecondary} /> Released
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

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.md }]}>
        <Pressable onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.textInverse} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Summary
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setJournalEditMode((v) => !v)}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
            hitSlop={8}
          >
            <MaterialIcons
              name={journalEditMode ? 'check' : 'edit'}
              size={22}
              color={Colors.textInverse}
            />
          </Pressable>
          <Pressable
            onPress={handleDeleteTrip}
            disabled={deleting}
            style={({ pressed }) => [{ opacity: (pressed || deleting) ? 0.6 : 1 }]}
            hitSlop={8}
          >
            <MaterialIcons name="delete-outline" size={22} color={Colors.textInverse} />
          </Pressable>
        </View>
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
            {formatTripDuration(trip.start_time, trip.end_time, { imported: trip.imported })}
          </Text>
          <Text style={styles.statLabel}>Duration</Text>
        </View>
      </View>

      {/* Tab Bar — same 5 tabs as active trip: Fishing, Photos, Conditions, AI Guide, Map */}
      <View style={styles.tabBar}>
        {([
          { key: 'fishing' as TabKey, label: 'Fishing' },
          { key: 'photos' as TabKey, label: 'Photos' },
          { key: 'conditions' as TabKey, label: 'Conditions' },
          { key: 'ai' as TabKey, label: 'AI Guide' },
          { key: 'map' as TabKey, label: 'Map' },
        ]).map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Tab Content */}
      {activeTab === 'fishing' && user && trip && (
        <JournalFishingTimeline
          trip={trip}
          events={events}
          userId={user.id}
          isConnected={isConnected}
          editMode={journalEditMode}
          onEventsChange={setEvents}
          onTripPatch={(patch) => setTrip((t) => (t ? { ...t, ...patch } : null))}
          onCatchPhotoPress={handleCatchPhotoPress}
          onRequestEditTripPin={(kind) => setTripPinModal(kind)}
        />
      )}
      {activeTab === 'photos' && (
        <SummaryPhotosTab
          tripPhotos={tripPhotos}
          loading={tripPhotosLoading}
          onPhotoPress={handleTripPhotoPress}
        />
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
                        <Text style={styles.snapshotEventType}>{getEventDescription(event)}</Text>
                      </View>
                      <View style={styles.snapshotGrid}>
                        {snapWeather && (
                          <>
                            <View style={styles.snapshotGridItem}>
                              <MaterialIcons name="thermostat" size={14} color={Colors.textTertiary} />
                              <Text style={styles.snapshotGridValue}>{snapWeather.temperature_f}°F</Text>
                            </View>
                            <View style={styles.snapshotGridItem}>
                              <MaterialIcons name="air" size={14} color={Colors.textTertiary} />
                              <Text style={styles.snapshotGridValue}>{snapWeather.wind_speed_mph} mph</Text>
                            </View>
                          </>
                        )}
                        {snapWater && (
                          <>
                            <View style={styles.snapshotGridItem}>
                              <MaterialIcons name="waves" size={14} color={Colors.water} />
                              <Text style={styles.snapshotGridValue}>{formatFlowRate(snapWater.flow_cfs)}</Text>
                            </View>
                            {snapWater.water_temp_f !== null && (
                              <View style={styles.snapshotGridItem}>
                                <MaterialIcons name="opacity" size={14} color={Colors.water} />
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
      {activeTab === 'ai' && <AIGuideTab trip={trip} events={events} />}
      {activeTab === 'map' && (
        <SummaryMapTab
          trip={trip}
          events={events}
          editMode={journalEditMode}
          onRequestEditTripPin={(kind) => setTripPinModal(kind)}
          onCatchWaypointPress={handleMapCatchWaypointPress}
        />
      )}

      {user && (
        <TripEndpointPinModal
          visible={tripPinModal != null}
          kind={tripPinModal ?? 'start'}
          trip={trip}
          events={events}
          isConnected={isConnected}
          onClose={() => setTripPinModal(null)}
          onPersist={persistTripPins}
        />
      )}
    </SafeAreaView>
  );
}

/* ─── AI Guide Tab (read-only) ─── */

function AIGuideTab({ trip, events }: { trip: Trip; events: TripEvent[] }) {
  const aiRecommendation = trip.ai_recommendation_cache as NextFlyRecommendation | null;
  const aiQueries = events.filter(e => e.event_type === 'ai_query');
  const hasAIData = aiRecommendation || aiQueries.length > 0;

  return (
    <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabContentInner}>
      {!hasAIData && (
        <View style={styles.emptyCard}>
          <MaterialIcons name="smart-toy" size={32} color={Colors.textTertiary} />
          <Text style={styles.emptyCardText}>No AI data for this trip</Text>
          <Text style={styles.emptyHint}>AI recommendations and queries are saved when used during a trip.</Text>
        </View>
      )}

      {aiRecommendation && aiRecommendation.pattern && (
        <View style={styles.aiRecCard}>
          <View style={styles.aiRecCardHeader}>
            <MaterialIcons name="auto-awesome" size={16} color={Colors.accent} />
            <Text style={styles.aiRecCardLabel}>AI Fly Recommendation</Text>
          </View>
          <Text style={styles.aiRecFly}>
            {aiRecommendation.pattern}
            {aiRecommendation.size ? ` #${aiRecommendation.size}` : ''}
          </Text>
          {aiRecommendation.color && (
            <Text style={styles.aiRecColor}>{aiRecommendation.color}</Text>
          )}
          {aiRecommendation.reason && (
            <Text style={styles.aiRecReason}>{aiRecommendation.reason}</Text>
          )}
          {aiRecommendation.confidence > 0 && (
            <View style={styles.confidenceBadge}>
              <Text style={styles.confidenceText}>
                {Math.round(aiRecommendation.confidence * 100)}% confidence
              </Text>
            </View>
          )}
        </View>
      )}

      {aiQueries.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI Conversations</Text>
          {aiQueries.map((event) => {
            const data = event.data as AIQueryData;
            return (
              <View key={event.id} style={styles.aiQAItem}>
                <View style={styles.aiQuestion}>
                  <MaterialIcons name="person" size={14} color={Colors.primary} />
                  <Text style={styles.aiQuestionText}>{data.question}</Text>
                </View>
                {data.response && (
                  <View style={styles.aiAnswer}>
                    <MaterialIcons name="smart-toy" size={14} color={Colors.accent} />
                    <Text style={styles.aiAnswerText}>{data.response}</Text>
                  </View>
                )}
                {data.webSources && data.webSources.length > 0 ? (
                  <View style={styles.aiSourcesWrap}>
                    <Text style={styles.aiSourcesLabel}>Web sources</Text>
                    {data.webSources.slice(0, 10).map((s, i) => (
                      <Pressable key={`${s.url}-${i}`} onPress={() => void Linking.openURL(s.url)}>
                        <Text style={styles.aiSourceLink} numberOfLines={2}>
                          {s.title || s.url}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Text style={styles.aiQATime}>{formatEventTime(event.timestamp)}</Text>
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
}: {
  tripPhotos: Photo[];
  loading: boolean;
  onPhotoPress?: (photo: Photo) => void;
}) {
  return (
    <ScrollView style={styles.summaryPhotosScroll} contentContainerStyle={styles.summaryPhotosContent}>
      <View style={styles.summaryPhotosHeader}>
        <Text style={styles.summaryPhotosTitle}>Trip photos</Text>
      </View>
      {loading ? (
        <View style={styles.summaryPhotosPlaceholder}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : tripPhotos.length === 0 ? (
        <View style={styles.summaryPhotosEmpty}>
          <MaterialIcons name="photo-library" size={40} color={Colors.textTertiary} />
          <Text style={styles.summaryPhotosEmptyText}>No photos for this trip</Text>
        </View>
      ) : (
        <View style={styles.summaryPhotosGrid}>
          {tripPhotos.map((photo) => (
            <Pressable key={photo.id} onPress={() => onPhotoPress?.(photo)}>
              <Image source={{ uri: photo.url }} style={styles.summaryPhotoThumb} />
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

/* ─── Map Tab (read-only: route + pins; line snaps to nearby trails when possible) ─── */

function SummaryMapTab({
  trip,
  events,
  editMode,
  onRequestEditTripPin,
  onCatchWaypointPress,
}: {
  trip: Trip;
  events: TripEvent[];
  editMode: boolean;
  onRequestEditTripPin: (kind: TripEndpointKind) => void;
  onCatchWaypointPress: (catchEventId: string) => void;
}) {
  const waypoints = useMemo(() => buildJournalWaypoints(trip, events), [trip, events]);
  const hasMapData = waypoints.length > 0;

  const coordSummary = useMemo(() => tripStartEndDisplayCoords(trip, events), [trip, events]);

  if (!hasMapData && !editMode) {
    return (
      <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabContentInner}>
        <View style={styles.summaryMapEmpty}>
          <MaterialIcons name="map" size={40} color={Colors.textTertiary} />
          <Text style={styles.summaryMapEmptyText}>No map data saved for this trip</Text>
          <Text style={styles.emptyHint}>
            Start and end GPS and catch locations appear here when recorded during the trip.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.summaryMapTabRoot}>
      <JournalTripRouteMapView
        trip={trip}
        events={events}
        containerStyle={styles.summaryMapNative}
        onCatchWaypointPress={onCatchWaypointPress}
      />
      <ScrollView
        style={styles.summaryMapLegendScroll}
        contentContainerStyle={styles.summaryMapLegendContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.summaryMapLegendTitle}>Trip route</Text>
        <Text style={styles.emptyHint}>
          The teal line follows Mapbox walking paths near your track (trails and river corridors when
          available). If no path matches, a straight line connects your points.
        </Text>
        {editMode ? (
          <View style={styles.summaryMapEditPins}>
            <Text style={styles.summaryMapEditPinsHint}>Adjust start and end pins for this trip.</Text>
            <View style={styles.summaryMapEditPinsRow}>
              <Pressable style={styles.summaryMapEditPinBtn} onPress={() => onRequestEditTripPin('start')}>
                <MaterialIcons name="place" size={18} color={Colors.primary} />
                <Text style={styles.summaryMapEditPinBtnText}>Start pin</Text>
              </Pressable>
              <Pressable style={styles.summaryMapEditPinBtn} onPress={() => onRequestEditTripPin('end')}>
                <MaterialIcons name="flag" size={18} color={Colors.secondary} />
                <Text style={styles.summaryMapEditPinBtnText}>End pin</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {coordSummary.startLat != null && coordSummary.startLon != null && (
          <View style={styles.summaryMapRow}>
            <MaterialIcons name="place" size={18} color={Colors.primary} />
            <Text style={styles.summaryMapLabel}>Start</Text>
            <Text style={styles.summaryMapCoords}>
              {coordSummary.startLat.toFixed(5)}, {coordSummary.startLon.toFixed(5)}
            </Text>
          </View>
        )}
        {coordSummary.endLat != null && coordSummary.endLon != null && (
          <View style={styles.summaryMapRow}>
            <MaterialIcons name="flag" size={18} color={Colors.secondary} />
            <Text style={styles.summaryMapLabel}>End</Text>
            <Text style={styles.summaryMapCoords}>
              {coordSummary.endLat.toFixed(5)}, {coordSummary.endLon.toFixed(5)}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/* ─── Helpers ─── */

function getEventDescription(event: TripEvent): string {
  switch (event.event_type) {
    case 'catch': {
      const data = event.data as CatchData;
      const parts: string[] = [];
      if (data.species) parts.push(data.species);
      if (data.size_inches != null) parts.push(`${data.size_inches}"`);
      const qty = data.quantity != null && data.quantity > 1 ? data.quantity : 1;
      return parts.length ? `Caught ${parts.join(' · ')}${qty > 1 ? ` (×${qty})` : ''}` : (qty > 1 ? `${qty} fish caught!` : 'Fish caught!');
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
      return `Asked: ${data.question}`;
    }
    default:
      return 'Event';
  }
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
    gap: Spacing.md,
  },
  loadingText: {
    fontSize: FontSize.lg,
    color: Colors.textSecondary,
  },
  backButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  backButtonText: {
    color: Colors.textInverse,
    fontWeight: '600',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.primary,
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
    color: Colors.textInverse,
  },

  dateLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  dateLocationName: {
    flex: 1,
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
    marginRight: Spacing.sm,
  },
  dateLocationDate: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },

  statsCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.lg,
    gap: Spacing.lg,
    shadowColor: Colors.shadow,
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
    color: Colors.primary,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },

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
  tabLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textTertiary,
  },
  tabLabelActive: {
    color: Colors.primary,
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
  summaryMapNative: {
    flex: 1,
    minHeight: 280,
  },
  summaryMapLegendScroll: {
    maxHeight: 200,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  summaryMapLegendContent: {
    padding: Spacing.lg,
    gap: Spacing.sm,
    paddingBottom: Spacing.xl,
  },
  summaryMapLegendTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.text,
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
    color: Colors.text,
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
    color: Colors.textSecondary,
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
    backgroundColor: Colors.borderLight,
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
    color: Colors.textSecondary,
  },
  summaryMapCard: {
    backgroundColor: Colors.surface,
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
    color: Colors.text,
    minWidth: 40,
  },
  summaryMapCoords: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  summaryMapEditPins: {
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  summaryMapEditPinsHint: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
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
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  summaryMapEditPinBtnText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
  },

  // Conditions summary
  summaryCard: {
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
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryCardText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 24,
  },
  conditionsNote: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    fontStyle: 'italic',
    marginTop: Spacing.sm,
  },

  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
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
    color: Colors.textInverse,
    marginBottom: Spacing.xs,
  },
  fullScreenPhotoCaption: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
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
    backgroundColor: Colors.surface,
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
    color: Colors.text,
  },
  mapCatchModalSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  mapCatchModalRow: {
    fontSize: FontSize.md,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  mapCatchModalNote: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: 22,
  },

  conditionCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    shadowColor: Colors.shadow,
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
    color: Colors.text,
  },
  conditionMainStat: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  conditionMainValue: {
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    color: Colors.primary,
  },
  conditionMainLabel: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  conditionGridLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  conditionGridValue: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
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
    color: Colors.text,
  },
  statusBadgeDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 20,
  },

  emptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    gap: Spacing.sm,
  },
  emptyCardText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  emptyHint: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    textAlign: 'center',
  },

  aiRecCard: {
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
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aiRecFly: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  aiRecColor: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  aiRecReason: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  confidenceBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs,
    marginTop: Spacing.sm,
  },
  confidenceText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
  },

  aiQAItem: {
    backgroundColor: Colors.surface,
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
    color: Colors.text,
    flex: 1,
  },
  aiAnswer: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  aiAnswerText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
  aiSourcesWrap: {
    marginTop: Spacing.xs,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    gap: Spacing.xs,
  },
  aiSourcesLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aiSourceLink: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    textDecorationLine: 'underline',
  },
  aiQATime: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    textAlign: 'right',
  },

  snapshotCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.water,
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
    color: Colors.primary,
  },
  snapshotEventType: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  snapshotGridValue: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.text,
  },
});
