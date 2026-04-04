import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import {
  Trip,
  TripEvent,
  FlyChangeData,
  CatchData,
  NoteData,
  FishingType,
  WeatherData,
  WaterFlowData,
  Location,
  NextFlyRecommendation,
  EventConditionsSnapshot,
  SessionType,
  type AIQueryWebSource,
} from '@/src/types';
import { getMoonPhase } from '@/src/utils/moonPhase';
import { captureTripBookmarkCoords, captureTripBookmarkCoordsFast } from '@/src/utils/tripGps';
import { syncTripToCloud, savePlannedTrip, fetchPlannedTripsFromCloud, deleteTripFromCloud } from '@/src/services/sync';
import { savePendingTrip, getPendingTrips, removePendingTrip } from '@/src/services/pendingSyncStorage';
import { getFallbackRecommendation, getSmartFlyRecommendation, getSeason, getTimeOfDay } from '@/src/services/ai';
import { fetchFlies, getFliesFromCache } from '@/src/services/flyService';
import { getWeather } from '@/src/services/weather';
import { getStreamFlow } from '@/src/services/waterFlow';
import { getCachedConditions } from '@/src/services/waterwayCache';
import { latestFlyChangeRigFromEvents, totalFishFromEvents } from '@/src/utils/journalTimeline';
import { buildEventConditionsSnapshot } from '@/src/utils/eventConditionsSnapshot';
import {
  catchDataWithAppendedPhotoUrl,
  normalizeCatchPhotoUrls,
} from '@/src/utils/catchPhotos';

const IN_TRIP_SYNC_DEBOUNCE_MS = 5000;
let inTripSyncTimer: ReturnType<typeof setTimeout> | null = null;

interface TripState {
  activeTrip: Trip | null;
  /** Milliseconds of active fishing time (excludes paused intervals). */
  fishingElapsedMs: number;
  /** ISO start of the current running segment; null while paused. */
  fishingSegmentStartedAt: string | null;
  isTripPaused: boolean;
  events: TripEvent[];
  currentFly: FlyChangeData | null;
  currentFly2: FlyChangeData | null;
  currentFlyEventId: string | null;
  fishCount: number;
  nextFlyRecommendation: NextFlyRecommendation | null;
  weatherData: WeatherData | null;
  waterFlowData: WaterFlowData | null;
  conditionsLoading: boolean;
  recommendationLoading: boolean;
  pendingSyncTrips: string[];
  isSyncingPending: boolean;
  plannedTrips: Trip[];
  plannedTripsLoading: boolean;

  planTrip: (
    userId: string,
    locationId: string,
    fishingType: FishingType,
    location: Location,
    plannedDate?: Date,
    sessionType?: SessionType | null,
    accessPointId?: string | null,
  ) => Promise<string | null>;
  startPlannedTrip: (tripId: string) => Promise<string | null>;
  deletePlannedTrip: (tripId: string) => Promise<void>;
  deleteTrip: (tripId: string) => Promise<void>;
  fetchPlannedTrips: (userId: string) => Promise<void>;
  startTrip: (userId: string, locationId: string | null, fishingType: FishingType, location?: Location, sessionType?: SessionType | null) => Promise<string>;
  pauseTrip: () => Promise<void>;
  resumeTrip: () => Promise<void>;
  endTrip: () => Promise<{ synced: boolean }>;
  updateTripSurvey: (tripId: string, payload: { rating: number | null; user_reported_clarity: string | null; notes: string | null }) => Promise<boolean>;
  retryPendingSyncs: () => Promise<void>;
  isOnline: boolean;
  setOnlineStatus: (online: boolean) => void;
  scheduleInTripSync: () => void;
  addCatch: (
    data?: Partial<CatchData>,
    latitude?: number | null,
    longitude?: number | null,
    /** Stable client id for offline-first sync (omit to assign a new uuid). */
    clientEventId?: string | null,
    options?: {
      timestampIso?: string;
      conditionsSnapshot?: EventConditionsSnapshot | null;
    },
  ) => string | undefined;
  appendCatchEventPhotoUrl: (tripId: string, eventId: string, photoUrl: string) => void;
  /** After a pending upload: swap local file URI for remote URL in catch photo_urls (or append if not found). */
  resolveCatchEventPhotoUpload: (tripId: string, eventId: string, localUri: string, remoteUrl: string) => void;
  removeCatch: () => void;
  changeFly: (primary: FlyChangeData, dropper?: FlyChangeData | null, latitude?: number | null, longitude?: number | null) => void;
  /** Update an existing fly_change row (timeline edit). Syncs current rig if that event is active. */
  updateFlyChangeEvent: (eventId: string, primary: FlyChangeData, dropper?: FlyChangeData | null) => void;
  addNote: (text: string, latitude?: number | null, longitude?: number | null) => void;
  addBite: (latitude?: number | null, longitude?: number | null) => void;
  addFishOn: (latitude?: number | null, longitude?: number | null) => void;
  addAIQuery: (question: string, response: string, webSources?: AIQueryWebSource[]) => void;
  updateWeatherCache: (weather: WeatherData) => void;
  updateNextFlyRecommendation: () => void;
  fetchConditions: () => Promise<void>;
  refreshSmartRecommendation: () => Promise<void>;
  clearActiveTrip: () => void;
  replaceActiveTripEvents: (events: TripEvent[]) => void;
}

function buildConditionsSnapshot(
  weather: WeatherData | null,
  waterFlow: WaterFlowData | null,
  capturedAt?: Date,
): EventConditionsSnapshot | null {
  return buildEventConditionsSnapshot(weather, waterFlow, capturedAt ?? new Date());
}

export const useTripStore = create<TripState>()(
  persist(
    (set, get) => {
      const addTripToPendingIfNeeded = (tripId: string, trip: Trip, events: TripEvent[]) => {
        void savePendingTrip(tripId, trip, events)
          .then(() => {
            set((s) => ({
              pendingSyncTrips: s.pendingSyncTrips.includes(tripId)
                ? s.pendingSyncTrips
                : [...s.pendingSyncTrips, tripId],
            }));
          })
          .catch((e) => console.error('savePendingTrip failed:', e));
      };

      const syncNewTripInBackground = (tripId: string) => {
        void (async () => {
          const refined = await captureTripBookmarkCoords();
          let trip = get().activeTrip;
          let events = get().events;
          if (!trip || trip.id !== tripId) return;

          if (refined) {
            const te = events[0];
            if (te?.trip_id === tripId) {
              const patchedTrip = {
                ...trip,
                start_latitude: refined.latitude,
                start_longitude: refined.longitude,
              };
              const patchedEv = {
                ...te,
                latitude: refined.latitude,
                longitude: refined.longitude,
              };
              const patchedEvents = [patchedEv, ...events.slice(1)];
              set({ activeTrip: patchedTrip, events: patchedEvents });
              trip = get().activeTrip!;
              events = get().events;
            }
          }

          if (!get().isOnline) {
            addTripToPendingIfNeeded(tripId, trip, events);
            return;
          }
          const ok = await syncTripToCloud(trip, events);
          if (!ok) {
            addTripToPendingIfNeeded(tripId, trip, events);
          }
        })();
      };

      return {
      activeTrip: null,
      fishingElapsedMs: 0,
      fishingSegmentStartedAt: null,
      isTripPaused: false,
      events: [],
      currentFly: null,
      currentFly2: null,
      currentFlyEventId: null,
      fishCount: 0,
      nextFlyRecommendation: null,
      weatherData: null,
      waterFlowData: null,
      conditionsLoading: false,
      recommendationLoading: false,
      pendingSyncTrips: [],
      isSyncingPending: false,
      isOnline: true,
      plannedTrips: [],
      plannedTripsLoading: false,

      planTrip: async (userId, locationId, fishingType, location, plannedDate, sessionType, accessPointId) => {
        const tripId = uuidv4();
        const trip: Trip = {
          id: tripId,
          user_id: userId,
          location_id: locationId,
          access_point_id: accessPointId ?? null,
          location,
          status: 'planned',
          fishing_type: fishingType,
          planned_date: plannedDate ? plannedDate.toISOString() : new Date().toISOString(),
          start_time: new Date().toISOString(),
          end_time: null,
          total_fish: 0,
          notes: null,
          ai_recommendation_cache: null,
          weather_cache: null,
          water_flow_cache: null,
          start_latitude: null,
          start_longitude: null,
          end_latitude: null,
          end_longitude: null,
          session_type: sessionType ?? null,
          rating: null,
          user_reported_clarity: null,
          created_at: new Date().toISOString(),
        };

        const saved = await savePlannedTrip(trip);
        if (!saved) return null;
        set(state => ({
          plannedTrips: [trip, ...state.plannedTrips],
        }));
        return tripId;
      },

      startPlannedTrip: async (tripId) => {
        if (get().activeTrip?.status === 'active') return null;
        const { plannedTrips, weatherData, waterFlowData } = get();
        const planned = plannedTrips.find(t => t.id === tripId);
        if (!planned) return null;

        const startCoords = await captureTripBookmarkCoordsFast();
        const startLat = startCoords?.latitude ?? null;
        const startLon = startCoords?.longitude ?? null;

        const startEvent: TripEvent = {
          id: uuidv4(),
          trip_id: tripId,
          event_type: 'note',
          timestamp: new Date().toISOString(),
          data: { text: 'Trip started' },
          conditions_snapshot: buildConditionsSnapshot(weatherData, waterFlowData),
          latitude: startLat,
          longitude: startLon,
        };

        const activatedTrip: Trip = {
          ...planned,
          status: 'active',
          start_time: new Date().toISOString(),
          start_latitude: startLat,
          start_longitude: startLon,
          end_latitude: planned.end_latitude ?? null,
          end_longitude: planned.end_longitude ?? null,
          session_type: planned.session_type ?? null,
          rating: planned.rating ?? null,
          user_reported_clarity: planned.user_reported_clarity ?? null,
        };

        const recommendation = getFallbackRecommendation(activatedTrip.fishing_type, null, null);

        set(state => ({
          activeTrip: activatedTrip,
          fishingElapsedMs: 0,
          fishingSegmentStartedAt: activatedTrip.start_time,
          isTripPaused: false,
          events: [startEvent],
          currentFly: null,
          currentFly2: null,
          currentFlyEventId: null,
          fishCount: 0,
          nextFlyRecommendation: recommendation,
          weatherData: null,
          waterFlowData: null,
          conditionsLoading: false,
          recommendationLoading: false,
          plannedTrips: state.plannedTrips.filter(t => t.id !== tripId),
        }));

        syncNewTripInBackground(tripId);
        return tripId;
      },

      deletePlannedTrip: async (tripId) => {
        set(state => ({
          plannedTrips: state.plannedTrips.filter(t => t.id !== tripId),
        }));
        await deleteTripFromCloud(tripId);
      },

      deleteTrip: async (tripId) => {
        await deleteTripFromCloud(tripId);
      },

      fetchPlannedTrips: async (userId) => {
        set({ plannedTripsLoading: true });
        try {
          const trips = await fetchPlannedTripsFromCloud(userId);
          set({ plannedTrips: trips, plannedTripsLoading: false });
        } catch {
          set({ plannedTripsLoading: false });
        }
      },

      startTrip: async (userId, locationId, fishingType, location, sessionType) => {
        const existing = get().activeTrip;
        if (existing?.status === 'active') return existing.id;

        const tripId = uuidv4();
        const startCoords = await captureTripBookmarkCoordsFast();
        const startLat = startCoords?.latitude ?? null;
        const startLon = startCoords?.longitude ?? null;
        const trip: Trip = {
          id: tripId,
          user_id: userId,
          location_id: locationId,
          access_point_id: null,
          location: location,
          status: 'active',
          fishing_type: fishingType,
          planned_date: null,
          start_time: new Date().toISOString(),
          end_time: null,
          total_fish: 0,
          notes: null,
          ai_recommendation_cache: null,
          weather_cache: null,
          water_flow_cache: null,
          start_latitude: startLat,
          start_longitude: startLon,
          end_latitude: null,
          end_longitude: null,
          session_type: sessionType ?? null,
          rating: null,
          user_reported_clarity: null,
          created_at: new Date().toISOString(),
        };

        const startEvent: TripEvent = {
          id: uuidv4(),
          trip_id: tripId,
          event_type: 'note',
          timestamp: new Date().toISOString(),
          data: { text: 'Trip started' },
          conditions_snapshot: null,
          latitude: startLat,
          longitude: startLon,
        };

        const recommendation = getFallbackRecommendation(fishingType, null, null);

        set({
          activeTrip: trip,
          fishingElapsedMs: 0,
          fishingSegmentStartedAt: trip.start_time,
          isTripPaused: false,
          events: [startEvent],
          currentFly: null,
          currentFly2: null,
          currentFlyEventId: null,
          fishCount: 0,
          nextFlyRecommendation: recommendation,
          weatherData: null,
          waterFlowData: null,
          conditionsLoading: false,
          recommendationLoading: false,
        });

        syncNewTripInBackground(tripId);
        return tripId;
      },

      pauseTrip: async () => {
        const {
          activeTrip,
          events,
          weatherData,
          waterFlowData,
          fishingElapsedMs,
          fishingSegmentStartedAt,
          isTripPaused,
        } = get();
        if (!activeTrip || activeTrip.status !== 'active' || isTripPaused) return;

        const now = Date.now();
        const segmentIso = fishingSegmentStartedAt ?? activeTrip.start_time;
        const segmentStart = new Date(segmentIso).getTime();
        const nextElapsed = (fishingElapsedMs ?? 0) + Math.max(0, now - segmentStart);

        const pauseEventId = uuidv4();
        const pauseTripId = activeTrip.id;
        const pauseEvent: TripEvent = {
          id: pauseEventId,
          trip_id: pauseTripId,
          event_type: 'note',
          timestamp: new Date().toISOString(),
          data: { text: 'Trip paused' },
          conditions_snapshot: buildConditionsSnapshot(weatherData, waterFlowData),
          latitude: null,
          longitude: null,
        };

        const nextEvents = [...events, pauseEvent];
        set({
          fishingElapsedMs: nextElapsed,
          fishingSegmentStartedAt: null,
          isTripPaused: true,
          events: nextEvents,
        });
        get().scheduleInTripSync();
        if (get().isOnline) {
          syncTripToCloud(activeTrip, nextEvents).catch(() => {});
        }

        void (async () => {
          const c = await captureTripBookmarkCoords();
          if (!c) return;
          const s = get();
          const idx = s.events.findIndex(e => e.id === pauseEventId);
          if (idx === -1 || s.events[idx].trip_id !== pauseTripId) return;
          const evs = [...s.events];
          evs[idx] = { ...evs[idx], latitude: c.latitude, longitude: c.longitude };
          set({ events: evs });
          get().scheduleInTripSync();
          const trip = get().activeTrip;
          if (trip && trip.id === pauseTripId && get().isOnline) {
            syncTripToCloud(trip, evs).catch(() => {});
          }
        })();
      },

      resumeTrip: async () => {
        const { activeTrip, events, weatherData, waterFlowData, isTripPaused } = get();
        if (!activeTrip || activeTrip.status !== 'active' || !isTripPaused) return;

        const resumeEventId = uuidv4();
        const resumeTripId = activeTrip.id;
        const resumeEvent: TripEvent = {
          id: resumeEventId,
          trip_id: resumeTripId,
          event_type: 'note',
          timestamp: new Date().toISOString(),
          data: { text: 'Trip resumed' },
          conditions_snapshot: buildConditionsSnapshot(weatherData, waterFlowData),
          latitude: null,
          longitude: null,
        };
        const nextEvents = [...events, resumeEvent];
        set({
          fishingSegmentStartedAt: new Date().toISOString(),
          isTripPaused: false,
          events: nextEvents,
        });
        get().scheduleInTripSync();
        if (get().isOnline) {
          syncTripToCloud(activeTrip, nextEvents).catch(() => {});
        }

        void (async () => {
          const c = await captureTripBookmarkCoords();
          if (!c) return;
          const s = get();
          const idx = s.events.findIndex(e => e.id === resumeEventId);
          if (idx === -1 || s.events[idx].trip_id !== resumeTripId) return;
          const evs = [...s.events];
          evs[idx] = { ...evs[idx], latitude: c.latitude, longitude: c.longitude };
          set({ events: evs });
          get().scheduleInTripSync();
          const trip = get().activeTrip;
          if (trip && trip.id === resumeTripId && get().isOnline) {
            syncTripToCloud(trip, evs).catch(() => {});
          }
        })();
      },

      endTrip: async (): Promise<{ synced: boolean }> => {
        const { activeTrip, events, fishCount, weatherData, waterFlowData, nextFlyRecommendation } = get();
        if (!activeTrip) return { synced: false };

        const tripId = activeTrip.id;
        const fastCoords = await captureTripBookmarkCoordsFast();
        const endLat = fastCoords?.latitude ?? null;
        const endLon = fastCoords?.longitude ?? null;

        const endedTrip: Trip = {
          ...activeTrip,
          status: 'completed',
          end_time: new Date().toISOString(),
          end_latitude: endLat,
          end_longitude: endLon,
          total_fish: fishCount,
          weather_cache: weatherData || activeTrip.weather_cache,
          water_flow_cache: waterFlowData || activeTrip.water_flow_cache,
          ai_recommendation_cache: nextFlyRecommendation
            ? (nextFlyRecommendation as unknown as Record<string, unknown>)
            : activeTrip.ai_recommendation_cache,
        };

        const endEventId = uuidv4();
        const endEvent: TripEvent = {
          id: endEventId,
          trip_id: activeTrip.id,
          event_type: 'note',
          timestamp: new Date().toISOString(),
          data: { text: `Trip ended. Total fish: ${fishCount}` },
          conditions_snapshot: buildConditionsSnapshot(weatherData, waterFlowData),
          latitude: endLat,
          longitude: endLon,
        };

        const allEvents = [...events, endEvent];

        set({
          activeTrip: endedTrip,
          fishingElapsedMs: 0,
          fishingSegmentStartedAt: null,
          isTripPaused: false,
          events: allEvents,
          currentFly: null,
          currentFlyEventId: null,
          fishCount: 0,
          nextFlyRecommendation: null,
          conditionsLoading: false,
          recommendationLoading: false,
        });

        if (!get().isOnline) {
          try {
            const t = get().activeTrip;
            const ev = get().events;
            if (t && ev.length) {
              await savePendingTrip(tripId, t, ev);
              set((s) => ({
                pendingSyncTrips: s.pendingSyncTrips.includes(tripId)
                  ? s.pendingSyncTrips
                  : [...s.pendingSyncTrips, tripId],
              }));
            }
          } catch (e) {
            console.error('Failed to save pending trip locally:', e);
          }
          return { synced: false };
        }

        void (async () => {
          const refined = await captureTripBookmarkCoords();
          let trip = get().activeTrip;
          let evs = get().events;
          if (!trip || trip.id !== tripId || trip.status !== 'completed') return;

          if (refined) {
            const patchedTrip = {
              ...trip,
              end_latitude: refined.latitude,
              end_longitude: refined.longitude,
            };
            const patchedEvs = evs.map((e) =>
              e.id === endEventId
                ? { ...e, latitude: refined.latitude, longitude: refined.longitude }
                : e,
            );
            set({ activeTrip: patchedTrip, events: patchedEvs });
            trip = get().activeTrip!;
            evs = get().events;
          }

          const synced = await syncTripToCloud(trip, evs);
          if (!synced) {
            try {
              await savePendingTrip(tripId, trip, evs);
              set((s) => ({
                pendingSyncTrips: s.pendingSyncTrips.includes(tripId)
                  ? s.pendingSyncTrips
                  : [...s.pendingSyncTrips, tripId],
              }));
            } catch (e) {
              console.error('Failed to save pending trip locally:', e);
            }
          }
        })();

        return { synced: true };
      },

      updateTripSurvey: async (tripId, payload): Promise<boolean> => {
        const { activeTrip, events } = get();
        if (!activeTrip || activeTrip.id !== tripId) return false;
        const updatedTrip: Trip = {
          ...activeTrip,
          rating: payload.rating,
          user_reported_clarity: payload.user_reported_clarity as Trip['user_reported_clarity'],
          notes: payload.notes ?? activeTrip.notes,
        };
        const synced = await syncTripToCloud(updatedTrip, events);
        if (!synced) {
          try {
            await savePendingTrip(tripId, updatedTrip, events);
          } catch (e) {
            console.error('Failed to save pending trip locally:', e);
          }
          set(state => ({
            pendingSyncTrips: [...state.pendingSyncTrips, tripId],
          }));
        }
        set({
          activeTrip: null,
          fishingElapsedMs: 0,
          fishingSegmentStartedAt: null,
          isTripPaused: false,
          events: [],
          currentFly: null,
          currentFly2: null,
          currentFlyEventId: null,
          fishCount: 0,
          nextFlyRecommendation: null,
          weatherData: null,
          waterFlowData: null,
        });
        return synced;
      },

      retryPendingSyncs: async () => {
        const { pendingSyncTrips } = get();
        if (pendingSyncTrips.length === 0) return;
        set({ isSyncingPending: true });
        try {
          const pending = await getPendingTrips();
          for (const tripId of pendingSyncTrips) {
            const payload = pending[tripId];
            if (!payload) continue;
            const ok = await syncTripToCloud(payload.trip, payload.events);
            if (ok) {
              await removePendingTrip(tripId);
              set(state => ({
                pendingSyncTrips: state.pendingSyncTrips.filter((id) => id !== tripId),
              }));
            }
          }
        } finally {
          set({ isSyncingPending: false });
        }
      },

      setOnlineStatus: (online) => set({ isOnline: online }),

      scheduleInTripSync: () => {
        if (inTripSyncTimer) clearTimeout(inTripSyncTimer);
        inTripSyncTimer = setTimeout(() => {
          inTripSyncTimer = null;
          const { activeTrip, events, isOnline } = get();
          if (activeTrip && events && isOnline) {
            syncTripToCloud(activeTrip, events).catch(() => {});
          }
        }, IN_TRIP_SYNC_DEBOUNCE_MS);
      },

      addCatch: (data, latitude, longitude, clientEventId, options): string | undefined => {
        const { activeTrip, currentFlyEventId, fishCount, weatherData, waterFlowData, isTripPaused } = get();
        if (!activeTrip || isTripPaused) return undefined;
        const qty = Math.max(1, data?.quantity ?? 1);
        const eventId =
          typeof clientEventId === 'string' && clientEventId.trim().length > 0
            ? clientEventId.trim()
            : uuidv4();

        const timestamp =
          options?.timestampIso && !Number.isNaN(Date.parse(options.timestampIso))
            ? options.timestampIso
            : new Date().toISOString();

        const conditions_snapshot =
          options?.conditionsSnapshot !== undefined
            ? options.conditionsSnapshot
            : buildConditionsSnapshot(weatherData, waterFlowData);

        const photoSeed: CatchData = {
          species: null,
          size_inches: null,
          note: null,
          photo_url: data?.photo_url ?? null,
          photo_urls: data?.photo_urls ?? null,
          active_fly_event_id: null,
        };
        const orderedPhotoUrls = normalizeCatchPhotoUrls(photoSeed);

        const catchEvent: TripEvent = {
          id: eventId,
          trip_id: activeTrip.id,
          event_type: 'catch',
          timestamp,
          data: {
            species: data?.species ?? null,
            size_inches: data?.size_inches ?? null,
            note: data?.note ?? null,
            photo_url: orderedPhotoUrls[0] ?? null,
            photo_urls: orderedPhotoUrls.length ? orderedPhotoUrls : null,
            active_fly_event_id: currentFlyEventId,
            caught_on_fly: data?.caught_on_fly ?? 'primary',
            quantity: data?.quantity ?? 1,
            depth_ft: data?.depth_ft ?? null,
            presentation_method: data?.presentation_method ?? null,
            released: data?.released ?? null,
            structure: data?.structure ?? null,
          } as CatchData,
          conditions_snapshot,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
        };

        set(state => ({
          events: [...state.events, catchEvent],
          fishCount: fishCount + qty,
          activeTrip: state.activeTrip
            ? { ...state.activeTrip, total_fish: fishCount + qty }
            : null,
        }));

        setTimeout(() => get().refreshSmartRecommendation(), 100);
        get().scheduleInTripSync();
        return eventId;
      },

      appendCatchEventPhotoUrl: (tripId, eventId, photoUrl) => {
        const { activeTrip, isTripPaused } = get();
        if (!activeTrip || activeTrip.id !== tripId || isTripPaused) return;
        set((state) => ({
          events: state.events.map((e) =>
            e.id === eventId && e.event_type === 'catch'
              ? {
                  ...e,
                  data: catchDataWithAppendedPhotoUrl(e.data as CatchData, photoUrl),
                }
              : e,
          ),
        }));
      },

      resolveCatchEventPhotoUpload: (tripId, eventId, localUri, remoteUrl) => {
        const { activeTrip, isTripPaused } = get();
        if (!activeTrip || activeTrip.id !== tripId || isTripPaused) return;
        set((state) => ({
          events: state.events.map((e) => {
            if (e.id !== eventId || e.event_type !== 'catch') return e;
            const d = e.data as CatchData;
            const urls = normalizeCatchPhotoUrls(d);
            const idx = urls.findIndex((u) => u === localUri);
            if (idx === -1) {
              return {
                ...e,
                data: catchDataWithAppendedPhotoUrl(d, remoteUrl),
              };
            }
            const next = [...urls];
            next[idx] = remoteUrl.trim();
            return {
              ...e,
              data: {
                ...d,
                photo_urls: next,
                photo_url: next[0] ?? null,
              },
            };
          }),
        }));
      },

      replaceActiveTripEvents: (events) => {
        const { activeTrip, isTripPaused } = get();
        if (!activeTrip || isTripPaused) return;
        const fishCount = totalFishFromEvents(events);
        const rig = latestFlyChangeRigFromEvents(events);
        set({
          events,
          fishCount,
          activeTrip: { ...activeTrip, total_fish: fishCount },
          currentFly: rig.primary,
          currentFly2: rig.dropper,
          currentFlyEventId: rig.eventId,
        });
        setTimeout(() => get().refreshSmartRecommendation(), 100);
        get().scheduleInTripSync();
      },

      removeCatch: () => {
        const { events, fishCount, isTripPaused } = get();
        if (fishCount <= 0 || isTripPaused) return;

        const lastCatchIndex = [...events].reverse().findIndex(e => e.event_type === 'catch');
        if (lastCatchIndex === -1) return;

        const actualIndex = events.length - 1 - lastCatchIndex;
        const newEvents = events.filter((_, i) => i !== actualIndex);

        set(state => ({
          events: newEvents,
          fishCount: fishCount - 1,
          activeTrip: state.activeTrip
            ? { ...state.activeTrip, total_fish: fishCount - 1 }
            : null,
        }));
      },

      changeFly: (primary, dropper, latitude, longitude) => {
        const { activeTrip, weatherData, waterFlowData, isTripPaused } = get();
        if (!activeTrip || isTripPaused) return;

        const eventId = uuidv4();
        const flyData: FlyChangeData = {
          ...primary,
          fly_id: primary.fly_id ?? undefined,
          fly_color_id: primary.fly_color_id ?? undefined,
          fly_size_id: primary.fly_size_id ?? undefined,
          ...(dropper && {
            pattern2: dropper.pattern,
            size2: dropper.size ?? null,
            color2: dropper.color ?? null,
            fly_id2: dropper.fly_id ?? null,
            fly_color_id2: dropper.fly_color_id ?? null,
            fly_size_id2: dropper.fly_size_id ?? null,
          }),
        };
        const flyEvent: TripEvent = {
          id: eventId,
          trip_id: activeTrip.id,
          event_type: 'fly_change',
          timestamp: new Date().toISOString(),
          data: flyData,
          conditions_snapshot: buildConditionsSnapshot(weatherData, waterFlowData),
          latitude: latitude ?? null,
          longitude: longitude ?? null,
        };

        const recommendation = getFallbackRecommendation(
          activeTrip.fishing_type,
          primary.pattern,
          activeTrip.weather_cache,
          undefined,
          dropper?.pattern ?? null,
        );

        set(state => ({
          events: [...state.events, flyEvent],
          currentFly: primary,
          currentFly2: dropper ?? null,
          currentFlyEventId: eventId,
          nextFlyRecommendation: recommendation,
        }));

        setTimeout(() => get().refreshSmartRecommendation(), 100);
        get().scheduleInTripSync();
      },

      updateFlyChangeEvent: (eventId, primary, dropper) => {
        const { activeTrip, events, currentFlyEventId, isTripPaused } = get();
        if (!activeTrip || isTripPaused) return;
        const target = events.find((e) => e.id === eventId && e.event_type === 'fly_change');
        if (!target) return;

        const flyData: FlyChangeData = {
          pattern: primary.pattern,
          size: primary.size ?? null,
          color: primary.color ?? null,
          fly_id: primary.fly_id ?? undefined,
          fly_color_id: primary.fly_color_id ?? undefined,
          fly_size_id: primary.fly_size_id ?? undefined,
          ...(dropper
            ? {
                pattern2: dropper.pattern,
                size2: dropper.size ?? null,
                color2: dropper.color ?? null,
                fly_id2: dropper.fly_id ?? null,
                fly_color_id2: dropper.fly_color_id ?? null,
                fly_size_id2: dropper.fly_size_id ?? null,
              }
            : {}),
        };

        set((state) => {
          const nextEvents = state.events.map((e) =>
            e.id === eventId && e.event_type === 'fly_change' ? { ...e, data: flyData } : e,
          );
          const patchCurrent =
            eventId === state.currentFlyEventId
              ? { currentFly: primary, currentFly2: dropper ?? null }
              : {};
          return { events: nextEvents, ...patchCurrent };
        });

        setTimeout(() => get().refreshSmartRecommendation(), 100);
        get().scheduleInTripSync();
      },

      addNote: (text, latitude, longitude) => {
        const { activeTrip, weatherData, waterFlowData, isTripPaused } = get();
        if (!activeTrip || isTripPaused) return;

        const noteEvent: TripEvent = {
          id: uuidv4(),
          trip_id: activeTrip.id,
          event_type: 'note',
          timestamp: new Date().toISOString(),
          data: { text } as NoteData,
          conditions_snapshot: buildConditionsSnapshot(weatherData, waterFlowData),
          latitude: latitude ?? null,
          longitude: longitude ?? null,
        };

        set(state => ({
          events: [...state.events, noteEvent],
        }));
        get().scheduleInTripSync();
      },

      addBite: (latitude, longitude) => {
        const { activeTrip, weatherData, waterFlowData, isTripPaused } = get();
        if (!activeTrip || isTripPaused) return;

        const event: TripEvent = {
          id: uuidv4(),
          trip_id: activeTrip.id,
          event_type: 'bite',
          timestamp: new Date().toISOString(),
          data: {},
          conditions_snapshot: buildConditionsSnapshot(weatherData, waterFlowData),
          latitude: latitude ?? null,
          longitude: longitude ?? null,
        };

        set(state => ({
          events: [...state.events, event],
        }));
      },

      addFishOn: (latitude, longitude) => {
        const { activeTrip, weatherData, waterFlowData, isTripPaused } = get();
        if (!activeTrip || isTripPaused) return;

        const event: TripEvent = {
          id: uuidv4(),
          trip_id: activeTrip.id,
          event_type: 'fish_on',
          timestamp: new Date().toISOString(),
          data: {},
          conditions_snapshot: buildConditionsSnapshot(weatherData, waterFlowData),
          latitude: latitude ?? null,
          longitude: longitude ?? null,
        };

        set(state => ({
          events: [...state.events, event],
        }));
      },

      addAIQuery: (question, response, webSources) => {
        const { activeTrip, weatherData, waterFlowData, isTripPaused } = get();
        if (!activeTrip || isTripPaused) return;

        const aiEvent: TripEvent = {
          id: uuidv4(),
          trip_id: activeTrip.id,
          event_type: 'ai_query',
          timestamp: new Date().toISOString(),
          data: {
            question,
            response,
            ...(webSources && webSources.length > 0 ? { webSources } : {}),
          },
          conditions_snapshot: buildConditionsSnapshot(weatherData, waterFlowData),
          latitude: null,
          longitude: null,
        };

        set(state => ({
          events: [...state.events, aiEvent],
        }));
      },

      updateWeatherCache: (weather) => {
        set(state => ({
          activeTrip: state.activeTrip
            ? { ...state.activeTrip, weather_cache: weather }
            : null,
        }));
      },

      updateNextFlyRecommendation: () => {
        const { activeTrip, currentFly, currentFly2 } = get();
        if (!activeTrip) return;

        const recommendation = getFallbackRecommendation(
          activeTrip.fishing_type,
          currentFly?.pattern ?? null,
          activeTrip.weather_cache,
          undefined,
          currentFly2?.pattern ?? null,
        );

        set({ nextFlyRecommendation: recommendation });
        get().refreshSmartRecommendation();
      },

      fetchConditions: async () => {
        const { activeTrip, isOnline } = get();
        if (!activeTrip) return;

        set({ conditionsLoading: true });

        try {
          if (!isOnline) {
            const location = activeTrip.location;
            const locationId = location?.id;
            const parentId = location?.parent_location_id ?? undefined;
            const cached = locationId ? await getCachedConditions(locationId, parentId) : null;
            const weather = cached?.weather ?? null;
            const waterFlow = cached?.waterFlow ?? null;
            set(state => ({
              weatherData: weather,
              waterFlowData: waterFlow,
              conditionsLoading: false,
              activeTrip: state.activeTrip
                ? {
                    ...state.activeTrip,
                    ...(weather && { weather_cache: weather }),
                    ...(waterFlow && { water_flow_cache: waterFlow }),
                  }
                : null,
            }));
            return;
          }

          const location = activeTrip.location;
          const lat = location?.latitude;
          const lng = location?.longitude;
          const stationId = (location?.metadata as Record<string, string> | null)?.usgs_station_id;

          const promises: [Promise<WeatherData | null>, Promise<WaterFlowData | null>] = [
            lat && lng ? getWeather(lat, lng) : Promise.resolve(null),
            stationId ? getStreamFlow(stationId) : Promise.resolve(null),
          ];

          const [weather, waterFlow] = await Promise.all(promises);

          set(state => ({
            weatherData: weather,
            waterFlowData: waterFlow,
            conditionsLoading: false,
            activeTrip: state.activeTrip
              ? {
                  ...state.activeTrip,
                  ...(weather && { weather_cache: weather }),
                  ...(waterFlow && { water_flow_cache: waterFlow }),
                }
              : null,
          }));
        } catch {
          set({ conditionsLoading: false });
        }
      },

      refreshSmartRecommendation: async () => {
        const { activeTrip, events, currentFly, currentFly2, fishCount, weatherData, waterFlowData, isOnline } = get();
        if (!activeTrip) {
          set({ recommendationLoading: false });
          return;
        }

        set({ recommendationLoading: true });

        try {
          const now = new Date();
          const primaryStr = currentFly ? `${currentFly.pattern}${currentFly.size ? ` #${currentFly.size}` : ''}${currentFly.color ? ` (${currentFly.color})` : ''}` : null;
          const dropperStr = currentFly2 ? `${currentFly2.pattern}${currentFly2.size ? ` #${currentFly2.size}` : ''}${currentFly2.color ? ` (${currentFly2.color})` : ''}` : null;

          if (!isOnline) {
            const location = activeTrip.location;
            const locationId = location?.id;
            const parentId = location?.parent_location_id ?? undefined;
            const cached = locationId ? await getCachedConditions(locationId, parentId) : null;
            const cachedWeather = cached?.weather ?? weatherData ?? null;
            const userFlies = await getFliesFromCache(activeTrip.user_id);
            const recommendation = getFallbackRecommendation(
              activeTrip.fishing_type,
              primaryStr,
              cachedWeather,
              userFlies.length > 0 ? userFlies : null,
              dropperStr,
            );
            set({ nextFlyRecommendation: recommendation, recommendationLoading: false });
            return;
          }

          let userFlies: Awaited<ReturnType<typeof fetchFlies>> = [];
          try {
            userFlies = await fetchFlies(activeTrip.user_id);
          } catch {
            // non-blocking: recommendations still work without fly box
          }
          const recommendation = await getSmartFlyRecommendation({
            location: activeTrip.location || null,
            fishingType: activeTrip.fishing_type,
            weather: weatherData,
            waterFlow: waterFlowData,
            currentFly: primaryStr,
            currentFly2: dropperStr ?? null,
            fishCount,
            recentEvents: events,
            timeOfDay: getTimeOfDay(now),
            season: getSeason(now),
            userFlies: userFlies.length > 0 ? userFlies : null,
          });

          set({ nextFlyRecommendation: recommendation, recommendationLoading: false });
        } catch {
          set({ recommendationLoading: false });
        }
      },

      clearActiveTrip: () => {
        set({
          activeTrip: null,
          fishingElapsedMs: 0,
          fishingSegmentStartedAt: null,
          isTripPaused: false,
          events: [],
          currentFly: null,
          currentFly2: null,
          currentFlyEventId: null,
          fishCount: 0,
          nextFlyRecommendation: null,
          weatherData: null,
          waterFlowData: null,
          conditionsLoading: false,
          recommendationLoading: false,
        });
      },
    };
    },
    {
      name: 'trip-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        activeTrip: state.activeTrip,
        fishingElapsedMs: state.fishingElapsedMs,
        fishingSegmentStartedAt: state.fishingSegmentStartedAt,
        isTripPaused: state.isTripPaused,
        events: state.events,
        currentFly: state.currentFly,
        currentFly2: state.currentFly2,
        currentFlyEventId: state.currentFlyEventId,
        fishCount: state.fishCount,
        nextFlyRecommendation: state.nextFlyRecommendation,
        weatherData: state.weatherData,
        waterFlowData: state.waterFlowData,
        pendingSyncTrips: state.pendingSyncTrips,
        plannedTrips: state.plannedTrips,
      }),
      merge: (persistedState, currentState) => {
        const p = persistedState as Partial<TripState>;
        const merged = { ...currentState, ...p };
        if (merged.activeTrip?.status === 'active' && !merged.isTripPaused && merged.fishingSegmentStartedAt == null) {
          merged.fishingSegmentStartedAt = merged.activeTrip.start_time;
        }
        merged.fishingElapsedMs = merged.fishingElapsedMs ?? 0;
        merged.isTripPaused = merged.isTripPaused ?? false;
        return merged;
      },
    }
  )
);
