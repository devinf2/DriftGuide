import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { Trip, TripEvent, FlyChangeData, CatchData, NoteData, FishingType, WeatherData, WaterFlowData, Location, NextFlyRecommendation, EventConditionsSnapshot, SessionType } from '@/src/types';
import { getMoonPhase } from '@/src/utils/moonPhase';
import * as ExpoLocation from 'expo-location';
import { syncTripToCloud, savePlannedTrip, fetchPlannedTripsFromCloud, deleteTripFromCloud } from '@/src/services/sync';
import { savePendingTrip, getPendingTrips, removePendingTrip } from '@/src/services/pendingSyncStorage';
import { getFallbackRecommendation, getSmartFlyRecommendation, getSeason, getTimeOfDay } from '@/src/services/ai';
import { fetchFlies, getFliesFromCache } from '@/src/services/flyService';
import { getWeather } from '@/src/services/weather';
import { getStreamFlow } from '@/src/services/waterFlow';
import { getCachedConditions } from '@/src/services/waterwayCache';

const IN_TRIP_SYNC_DEBOUNCE_MS = 5000;
let inTripSyncTimer: ReturnType<typeof setTimeout> | null = null;

interface TripState {
  activeTrip: Trip | null;
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

  planTrip: (userId: string, locationId: string, fishingType: FishingType, location: Location, plannedDate?: Date, sessionType?: SessionType | null) => Promise<string | null>;
  startPlannedTrip: (tripId: string) => Promise<string | null>;
  deletePlannedTrip: (tripId: string) => Promise<void>;
  deleteTrip: (tripId: string) => Promise<void>;
  fetchPlannedTrips: (userId: string) => Promise<void>;
  startTrip: (userId: string, locationId: string | null, fishingType: FishingType, location?: Location, sessionType?: SessionType | null) => Promise<string>;
  endTrip: () => Promise<{ synced: boolean }>;
  updateTripSurvey: (tripId: string, payload: { rating: number | null; user_reported_clarity: string | null; notes: string | null }) => Promise<boolean>;
  retryPendingSyncs: () => Promise<void>;
  isSyncingPending: boolean;
  isOnline: boolean;
  setOnlineStatus: (online: boolean) => void;
  scheduleInTripSync: () => void;
  addCatch: (data?: Partial<CatchData>, latitude?: number | null, longitude?: number | null) => string | undefined;
  updateEventPhotoUrl: (tripId: string, eventId: string, photoUrl: string) => void;
  removeCatch: () => void;
  changeFly: (primary: FlyChangeData, dropper?: FlyChangeData | null, latitude?: number | null, longitude?: number | null) => void;
  addNote: (text: string, latitude?: number | null, longitude?: number | null) => void;
  addBite: (latitude?: number | null, longitude?: number | null) => void;
  addFishOn: (latitude?: number | null, longitude?: number | null) => void;
  addAIQuery: (question: string, response: string) => void;
  updateWeatherCache: (weather: WeatherData) => void;
  updateNextFlyRecommendation: () => void;
  fetchConditions: () => Promise<void>;
  refreshSmartRecommendation: () => Promise<void>;
  clearActiveTrip: () => void;
}

function buildConditionsSnapshot(weather: WeatherData | null, waterFlow: WaterFlowData | null): EventConditionsSnapshot | null {
  if (!weather && !waterFlow) return null;
  return {
    weather,
    waterFlow,
    captured_at: new Date().toISOString(),
    moon_phase: getMoonPhase(new Date()),
  };
}

export const useTripStore = create<TripState>()(
  persist(
    (set, get) => ({
      activeTrip: null,
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

      planTrip: async (userId, locationId, fishingType, location, plannedDate, sessionType) => {
        const tripId = uuidv4();
        const trip: Trip = {
          id: tripId,
          user_id: userId,
          location_id: locationId,
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
        const { plannedTrips, weatherData, waterFlowData } = get();
        const planned = plannedTrips.find(t => t.id === tripId);
        if (!planned) return null;

        let startLat: number | null = null;
        let startLon: number | null = null;
        try {
          const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await ExpoLocation.getCurrentPositionAsync({
              accuracy: ExpoLocation.Accuracy.Balanced,
            });
            startLat = loc.coords.latitude;
            startLon = loc.coords.longitude;
          }
        } catch {
          // leave null
        }

        const startEvent: TripEvent = {
          id: uuidv4(),
          trip_id: tripId,
          event_type: 'note',
          timestamp: new Date().toISOString(),
          data: { text: 'Trip started' },
          conditions_snapshot: buildConditionsSnapshot(weatherData, waterFlowData),
          latitude: null,
          longitude: null,
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

        await syncTripToCloud(activatedTrip, [startEvent]);
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
        const tripId = uuidv4();
        let startLat: number | null = null;
        let startLon: number | null = null;
        try {
          const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await ExpoLocation.getCurrentPositionAsync({
              accuracy: ExpoLocation.Accuracy.Balanced,
            });
            startLat = loc.coords.latitude;
            startLon = loc.coords.longitude;
          }
        } catch {
          // leave null
        }
        const trip: Trip = {
          id: tripId,
          user_id: userId,
          location_id: locationId,
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
          latitude: null,
          longitude: null,
        };

        const recommendation = getFallbackRecommendation(fishingType, null, null);

        set({
          activeTrip: trip,
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

        await syncTripToCloud(trip, [startEvent]);
        return tripId;
      },

      endTrip: async (): Promise<{ synced: boolean }> => {
        const { activeTrip, events, fishCount, weatherData, waterFlowData, nextFlyRecommendation } = get();
        if (!activeTrip) return { synced: false };

        let endLat: number | null = null;
        let endLon: number | null = null;
        try {
          const { status } = await ExpoLocation.getForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await ExpoLocation.getCurrentPositionAsync({
              accuracy: ExpoLocation.Accuracy.Balanced,
            });
            endLat = loc.coords.latitude;
            endLon = loc.coords.longitude;
          }
        } catch {
          // leave null
        }

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

        const endEvent: TripEvent = {
          id: uuidv4(),
          trip_id: activeTrip.id,
          event_type: 'note',
          timestamp: new Date().toISOString(),
          data: { text: `Trip ended. Total fish: ${fishCount}` },
          conditions_snapshot: buildConditionsSnapshot(weatherData, waterFlowData),
          latitude: null,
          longitude: null,
        };

        const allEvents = [...events, endEvent];

        const synced = await syncTripToCloud(endedTrip, allEvents);

        if (!synced) {
          try {
            await savePendingTrip(activeTrip.id, endedTrip, allEvents);
          } catch (e) {
            console.error('Failed to save pending trip locally:', e);
          }
          set(state => ({
            pendingSyncTrips: [...state.pendingSyncTrips, activeTrip.id],
          }));
        }

        set({
          activeTrip: endedTrip,
          events: allEvents,
          currentFly: null,
          currentFlyEventId: null,
          fishCount: 0,
          nextFlyRecommendation: null,
          conditionsLoading: false,
          recommendationLoading: false,
        });
        return { synced };
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

      addCatch: (data, latitude, longitude): string | undefined => {
        const { activeTrip, currentFlyEventId, fishCount, weatherData, waterFlowData } = get();
        if (!activeTrip) return undefined;
        const qty = Math.max(1, data?.quantity ?? 1);
        const eventId = uuidv4();

        const catchEvent: TripEvent = {
          id: eventId,
          trip_id: activeTrip.id,
          event_type: 'catch',
          timestamp: new Date().toISOString(),
          data: {
            species: data?.species ?? null,
            size_inches: data?.size_inches ?? null,
            note: data?.note ?? null,
            photo_url: data?.photo_url ?? null,
            active_fly_event_id: currentFlyEventId,
            caught_on_fly: data?.caught_on_fly ?? 'primary',
            quantity: data?.quantity ?? 1,
            depth_ft: data?.depth_ft ?? null,
            presentation_method: data?.presentation_method ?? null,
            released: data?.released ?? null,
            structure: data?.structure ?? null,
          } as CatchData,
          conditions_snapshot: buildConditionsSnapshot(weatherData, waterFlowData),
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

      updateEventPhotoUrl: (tripId, eventId, photoUrl) => {
        const { activeTrip } = get();
        if (!activeTrip || activeTrip.id !== tripId) return;
        set((state) => ({
          events: state.events.map((e) =>
            e.id === eventId && e.event_type === 'catch'
              ? { ...e, data: { ...e.data, photo_url: photoUrl } }
              : e,
          ),
        }));
      },

      removeCatch: () => {
        const { events, fishCount } = get();
        if (fishCount <= 0) return;

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
        const { activeTrip, weatherData, waterFlowData } = get();
        if (!activeTrip) return;

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

      addNote: (text, latitude, longitude) => {
        const { activeTrip, weatherData, waterFlowData } = get();
        if (!activeTrip) return;

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
        const { activeTrip, weatherData, waterFlowData } = get();
        if (!activeTrip) return;

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
        const { activeTrip, weatherData, waterFlowData } = get();
        if (!activeTrip) return;

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

      addAIQuery: (question, response) => {
        const { activeTrip, weatherData, waterFlowData } = get();
        if (!activeTrip) return;

        const aiEvent: TripEvent = {
          id: uuidv4(),
          trip_id: activeTrip.id,
          event_type: 'ai_query',
          timestamp: new Date().toISOString(),
          data: { question, response },
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
        const { activeTrip, currentFly } = get();
        if (!activeTrip) return;

        const recommendation = getFallbackRecommendation(
          activeTrip.fishing_type,
          currentFly?.pattern ?? null,
          activeTrip.weather_cache,
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
          const dropperStr = currentFly2 ? `${currentFly2.pattern}${currentFly2.size ? ` #${currentFly2.size}` : ''}${currentFly2.color ? ` (${currentFly2.color})` : ''}` : null;
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
    }),
    {
      name: 'trip-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        activeTrip: state.activeTrip,
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
    }
  )
);
