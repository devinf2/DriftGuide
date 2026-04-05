import type { CatchDetailsSubmitAdd } from '@/src/components/catch/CatchDetailsModal';
import type { CatchData, FlyChangeData, Location, TripEvent, WeatherData } from '@/src/types';
import type { PhotoExifMetadata } from '@/src/utils/imageExif';
import { catchDataWithoutPhotoUri, normalizeCatchPhotoUrls } from '@/src/utils/catchPhotos';
import { applyCatchDetailsAddPayload } from '@/src/utils/importPastTrips/applyCatchPayload';
import {
  buildMinimalCatchPayloadForImport,
  orderPhotoIdsByTripOrder,
} from '@/src/utils/importPastTrips/minimalImportCatch';
import { format } from 'date-fns';
import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

export interface ImportPhoto {
  id: string;
  uri: string;
  meta: PhotoExifMetadata;
}

export type ImportPhotoState =
  | { kind: 'untagged' }
  | { kind: 'scenery' }
  | { kind: 'catch'; catchEventId: string };

export interface ImportTripGroup {
  id: string;
  draftTripId: string;
  photoIds: string[];
  /** yyyy-MM-dd */
  tripDateKey: string;
  locationId: string | null;
  location: Location | null;
  weatherCache: WeatherData | null;
  events: TripEvent[];
  currentFlyEventId: string | null;
  currentPrimary: FlyChangeData | null;
  currentDropper: FlyChangeData | null;
  photoStates: Record<string, ImportPhotoState>;
}

interface ImportPastTripsState {
  step: number;
  photos: ImportPhoto[];
  groups: ImportTripGroup[];
  /** multi-select for step 4 combine */
  selectedPhotoIdsForAction: string[];
  activeGroupIdForStep4: string | null;

  reset: () => void;
  setStep: (step: number) => void;
  appendPhotos: (more: ImportPhoto[]) => void;
  removePhoto: (photoId: string) => void;
  prepareStep2FromPhotos: () => void;
  splitGroup: (groupId: string, photoIdsToMove: string[]) => void;
  /** Moves all photos from `fromGroupId` into `intoGroupId`, then removes the source group. */
  mergeIntoGroup: (fromGroupId: string, intoGroupId: string) => void;
  setGroupTripDate: (groupId: string, tripDateKey: string) => void;
  setGroupLocation: (groupId: string, location: Location | null, locationId: string | null) => void;
  setGroupWeather: (groupId: string, weather: WeatherData | null) => void;
  setActiveGroupForStep4: (groupId: string | null) => void;
  togglePhotoSelectForCombine: (photoId: string) => void;
  clearPhotoSelection: () => void;
  assignScenery: (groupId: string, photoId: string) => void;
  /** Fish track vs scenery; detaches from catch when switching a catch photo to scenery. */
  setImportPhotoScenery: (groupId: string, photoId: string, isScenery: boolean) => void;
  addCatchFromPayload: (groupId: string, photoIds: string[], payload: CatchDetailsSubmitAdd) => void;
  /** One minimal catch (photos only) for the given photo IDs, in trip order. */
  addMinimalCatchForPhotoIds: (groupId: string, photoIds: string[]) => void;
  /** Turn every remaining untagged fish photo into its own minimal catch (for Review / import). */
  materializeMinimalCatchesForAllGroups: () => void;
  updateGroupEventsAfterEdit: (groupId: string, nextEvents: TripEvent[]) => void;
  deleteCatchAndResetPhotos: (groupId: string, catchEventId: string) => void;
  /** Rebuild photoStates catch links from events (after edit) */
  relinkPhotoStatesForGroup: (groupId: string) => void;
}

const initialState = {
  step: 1,
  photos: [] as ImportPhoto[],
  groups: [] as ImportTripGroup[],
  selectedPhotoIdsForAction: [] as string[],
  activeGroupIdForStep4: null as string | null,
};

function emptyPhotoStates(photoIds: string[]): Record<string, ImportPhotoState> {
  const o: Record<string, ImportPhotoState> = {};
  for (const id of photoIds) o[id] = { kind: 'untagged' };
  return o;
}

function buildGroupsFromPhotos(photos: ImportPhoto[]): ImportTripGroup[] {
  const buckets = new Map<string, string[]>();
  for (const p of photos) {
    const key = p.meta.takenAt ? format(p.meta.takenAt, 'yyyy-MM-dd') : '__unknown__';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(p.id);
  }
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === '__unknown__') return 1;
    if (b === '__unknown__') return -1;
    return a.localeCompare(b);
  });
  return keys.map((tripDateKey) => {
    const photoIds = buckets.get(tripDateKey)!;
    const draftTripId = uuidv4();
    const earliest = photoIds
      .map((id) => photos.find((p) => p.id === id)?.meta.takenAt)
      .filter(Boolean)
      .sort((a, b) => (a!.getTime() - b!.getTime()))[0];
    const defaultKey =
      tripDateKey !== '__unknown__'
        ? tripDateKey
        : earliest
          ? format(earliest, 'yyyy-MM-dd')
          : format(new Date(), 'yyyy-MM-dd');
    return {
      id: uuidv4(),
      draftTripId,
      photoIds,
      tripDateKey: tripDateKey === '__unknown__' ? defaultKey : tripDateKey,
      locationId: null,
      location: null,
      weatherCache: null,
      events: [],
      currentFlyEventId: null,
      currentPrimary: null,
      currentDropper: null,
      photoStates: emptyPhotoStates(photoIds),
    };
  });
}

export const useImportPastTripsStore = create<ImportPastTripsState>((set, get) => ({
  ...initialState,

  reset: () => set({ ...initialState }),

  setStep: (step) => set({ step }),

  appendPhotos: (more) =>
    set((state) => ({
      photos: [...state.photos, ...more],
    })),

  removePhoto: (photoId) =>
    set((state) => ({
      photos: state.photos.filter((p) => p.id !== photoId),
    })),

  prepareStep2FromPhotos: () => {
    const { photos } = get();
    set({
      groups: buildGroupsFromPhotos(photos),
      selectedPhotoIdsForAction: [],
      activeGroupIdForStep4: null,
    });
  },

  splitGroup: (groupId, photoIdsToMove) => {
    if (photoIdsToMove.length === 0) return;
    set((state) => {
      const idx = state.groups.findIndex((g) => g.id === groupId);
      if (idx === -1) return state;
      const g = state.groups[idx];
      const move = new Set(photoIdsToMove);
      const stay = g.photoIds.filter((id) => !move.has(id));
      const moved = g.photoIds.filter((id) => move.has(id));
      if (stay.length === 0 || moved.length === 0) return state;
      const newGroup: ImportTripGroup = {
        id: uuidv4(),
        draftTripId: uuidv4(),
        photoIds: moved,
        tripDateKey: g.tripDateKey,
        locationId: null,
        location: null,
        weatherCache: null,
        events: [],
        currentFlyEventId: null,
        currentPrimary: null,
        currentDropper: null,
        photoStates: emptyPhotoStates(moved),
      };
      const nextStates = { ...g.photoStates };
      for (const id of moved) delete nextStates[id];
      const updated: ImportTripGroup = {
        ...g,
        photoIds: stay,
        photoStates: nextStates,
        events: [],
        currentFlyEventId: null,
        currentPrimary: null,
        currentDropper: null,
        locationId: null,
        location: null,
        weatherCache: null,
      };
      const groups = [...state.groups.slice(0, idx), updated, newGroup, ...state.groups.slice(idx + 1)];
      return { groups };
    });
  },

  mergeIntoGroup: (fromGroupId, intoGroupId) => {
    if (fromGroupId === intoGroupId) return;
    set((state) => {
      const from = state.groups.find((g) => g.id === fromGroupId);
      const into = state.groups.find((g) => g.id === intoGroupId);
      if (!from || !into) return state;
      const mergedPhotoIds = [...into.photoIds, ...from.photoIds];
      const merged: ImportTripGroup = {
        ...into,
        photoIds: mergedPhotoIds,
        locationId: null,
        location: null,
        weatherCache: null,
        events: [],
        currentFlyEventId: null,
        currentPrimary: null,
        currentDropper: null,
        photoStates: emptyPhotoStates(mergedPhotoIds),
      };
      const groups = state.groups
        .filter((g) => g.id !== fromGroupId)
        .map((g) => (g.id === intoGroupId ? merged : g));
      return { groups };
    });
  },

  setGroupTripDate: (groupId, tripDateKey) => {
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, tripDateKey } : g)),
    }));
  },

  setGroupLocation: (groupId, location, locationId) => {
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId ? { ...g, location, locationId: locationId ?? location?.id ?? null } : g,
      ),
    }));
  },

  setGroupWeather: (groupId, weather) => {
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, weatherCache: weather } : g)),
    }));
  },

  setActiveGroupForStep4: (groupId) => set({ activeGroupIdForStep4: groupId, selectedPhotoIdsForAction: [] }),

  togglePhotoSelectForCombine: (photoId) => {
    set((state) => {
      const sel = state.selectedPhotoIdsForAction;
      const has = sel.includes(photoId);
      return {
        selectedPhotoIdsForAction: has ? sel.filter((id) => id !== photoId) : [...sel, photoId],
      };
    });
  },

  clearPhotoSelection: () => set({ selectedPhotoIdsForAction: [] }),

  setImportPhotoScenery: (groupId, photoId, isScenery) =>
    set((state) => {
      const gi = state.groups.findIndex((g) => g.id === groupId);
      if (gi === -1) return state;
      const g = state.groups[gi];
      const st = g.photoStates[photoId];
      const photo = state.photos.find((p) => p.id === photoId);
      if (!st || !photo) return state;

      if (isScenery) {
        if (st.kind === 'scenery') return state;
        if (st.kind === 'untagged') {
          return {
            groups: state.groups.map((gr, i) =>
              i !== gi
                ? gr
                : {
                    ...gr,
                    photoStates: { ...gr.photoStates, [photoId]: { kind: 'scenery' } },
                  },
            ),
          };
        }
        if (st.kind === 'catch') {
          const ev = g.events.find((e) => e.id === st.catchEventId && e.event_type === 'catch');
          if (!ev) {
            return {
              groups: state.groups.map((gr, i) =>
                i !== gi
                  ? gr
                  : {
                      ...gr,
                      photoStates: { ...gr.photoStates, [photoId]: { kind: 'scenery' } },
                    },
              ),
            };
          }
          const nextData = catchDataWithoutPhotoUri(ev.data as CatchData, photo.uri);
          const remaining = normalizeCatchPhotoUrls(nextData);
          const photoStates: Record<string, ImportPhotoState> = { ...g.photoStates };
          photoStates[photoId] = { kind: 'scenery' };
          if (remaining.length === 0) {
            const events = g.events.filter((e) => e.id !== ev.id);
            for (const pid of g.photoIds) {
              const s = photoStates[pid];
              if (s?.kind === 'catch' && s.catchEventId === ev.id) {
                photoStates[pid] = { kind: 'untagged' };
              }
            }
            photoStates[photoId] = { kind: 'scenery' };
            const groups = [...state.groups];
            groups[gi] = { ...g, events, photoStates };
            return { groups };
          }
          const events = g.events.map((e) =>
            e.id === ev.id ? { ...e, data: nextData as CatchData } : e,
          );
          const groups = [...state.groups];
          groups[gi] = { ...g, events, photoStates };
          return { groups };
        }
        return state;
      }

      if (st.kind !== 'scenery') return state;
      return {
        groups: state.groups.map((gr, i) =>
          i !== gi
            ? gr
            : {
                ...gr,
                photoStates: { ...gr.photoStates, [photoId]: { kind: 'untagged' } },
              },
        ),
      };
    }),

  assignScenery: (groupId, photoId) => {
    get().setImportPhotoScenery(groupId, photoId, true);
  },

  addCatchFromPayload: (groupId, photoIds, payload) => {
    set((state) => {
      const gi = state.groups.findIndex((g) => g.id === groupId);
      if (gi === -1) return state;
      const g = state.groups[gi];
      const applied = applyCatchDetailsAddPayload({
        tripId: g.draftTripId,
        events: g.events,
        currentFlyEventId: g.currentFlyEventId,
        currentPrimary: g.currentPrimary,
        currentDropper: g.currentDropper,
        payload,
      });
      const photoStates = { ...g.photoStates };
      for (const pid of photoIds) {
        photoStates[pid] = { kind: 'catch', catchEventId: applied.catchEventId };
      }
      const groups = [...state.groups];
      groups[gi] = {
        ...g,
        events: applied.events,
        currentFlyEventId: applied.currentFlyEventId,
        currentPrimary: applied.currentPrimary,
        currentDropper: applied.currentDropper,
        photoStates,
      };
      return { groups, selectedPhotoIdsForAction: [] };
    });
  },

  addMinimalCatchForPhotoIds: (groupId, photoIds) => {
    if (photoIds.length === 0) return;
    set((state) => {
      const gi = state.groups.findIndex((g) => g.id === groupId);
      if (gi === -1) return state;
      const g = state.groups[gi];
      const ordered = orderPhotoIdsByTripOrder(g, photoIds);
      if (ordered.length === 0) return state;
      const payload = buildMinimalCatchPayloadForImport(g, state.photos, ordered);
      const applied = applyCatchDetailsAddPayload({
        tripId: g.draftTripId,
        events: g.events,
        currentFlyEventId: g.currentFlyEventId,
        currentPrimary: g.currentPrimary,
        currentDropper: g.currentDropper,
        payload,
      });
      const photoStates = { ...g.photoStates };
      for (const pid of ordered) {
        photoStates[pid] = { kind: 'catch', catchEventId: applied.catchEventId };
      }
      const groups = [...state.groups];
      groups[gi] = {
        ...g,
        events: applied.events,
        currentFlyEventId: applied.currentFlyEventId,
        currentPrimary: applied.currentPrimary,
        currentDropper: applied.currentDropper,
        photoStates,
      };
      return { groups, selectedPhotoIdsForAction: [] };
    });
  },

  materializeMinimalCatchesForAllGroups: () =>
    set((state) => {
      const photos = state.photos;
      const groups = state.groups.map((g) => {
        const untaggedOrdered = g.photoIds.filter((pid) => {
          const st = g.photoStates[pid];
          return !st || st.kind === 'untagged';
        });
        let next = g;
        for (const pid of untaggedOrdered) {
          const payload = buildMinimalCatchPayloadForImport(next, photos, [pid]);
          const applied = applyCatchDetailsAddPayload({
            tripId: next.draftTripId,
            events: next.events,
            currentFlyEventId: next.currentFlyEventId,
            currentPrimary: next.currentPrimary,
            currentDropper: next.currentDropper,
            payload,
          });
          next = {
            ...next,
            events: applied.events,
            currentFlyEventId: applied.currentFlyEventId,
            currentPrimary: applied.currentPrimary,
            currentDropper: applied.currentDropper,
            photoStates: {
              ...next.photoStates,
              [pid]: { kind: 'catch', catchEventId: applied.catchEventId },
            },
          };
        }
        return next;
      });
      return { groups };
    }),

  updateGroupEventsAfterEdit: (groupId, nextEvents) => {
    set((state) => ({
      groups: state.groups.map((g) => {
        if (g.id !== groupId) return g;
        const flies = nextEvents.filter((e) => e.event_type === 'fly_change');
        const lastFly = [...flies].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        ).pop();
        const fd = lastFly?.data as FlyChangeData | undefined;
        const currentDropper: FlyChangeData | null =
          fd && fd.pattern2?.trim()
            ? {
                pattern: fd.pattern2,
                size: fd.size2 ?? null,
                color: fd.color2 ?? null,
                fly_id: fd.fly_id2 ?? null,
                fly_color_id: fd.fly_color_id2 ?? null,
                fly_size_id: fd.fly_size_id2 ?? null,
              }
            : null;
        const currentPrimary: FlyChangeData | null = fd
          ? {
              pattern: fd.pattern,
              size: fd.size ?? null,
              color: fd.color ?? null,
              fly_id: fd.fly_id ?? null,
              fly_color_id: fd.fly_color_id ?? null,
              fly_size_id: fd.fly_size_id ?? null,
            }
          : g.currentPrimary;
        return {
          ...g,
          events: nextEvents,
          currentFlyEventId: lastFly?.id ?? g.currentFlyEventId,
          currentPrimary,
          currentDropper,
        };
      }),
    }));
    get().relinkPhotoStatesForGroup(groupId);
  },

  deleteCatchAndResetPhotos: (groupId, catchEventId) => {
    set((state) => ({
      groups: state.groups.map((g) => {
        if (g.id !== groupId) return g;
        const events = g.events.filter((e) => e.id !== catchEventId);
        const photoStates: Record<string, ImportPhotoState> = { ...g.photoStates };
        for (const pid of Object.keys(photoStates)) {
          const st = photoStates[pid];
          if (st.kind === 'catch' && st.catchEventId === catchEventId) {
            photoStates[pid] = { kind: 'untagged' };
          }
        }
        return { ...g, events, photoStates };
      }),
    }));
  },

  relinkPhotoStatesForGroup: (groupId) => {
    set((state) => ({
      groups: state.groups.map((g) => {
        if (g.id !== groupId) return g;
        const photoStates: Record<string, ImportPhotoState> = { ...g.photoStates };
        const catchEvents = g.events.filter((e) => e.event_type === 'catch');
        for (const pid of g.photoIds) {
          const st = photoStates[pid];
          if (st.kind !== 'catch') continue;
          const ev = catchEvents.find((e) => e.id === st.catchEventId);
          if (!ev) {
            photoStates[pid] = { kind: 'untagged' };
            continue;
          }
          const data = ev.data as { photo_urls?: string[] | null; photo_url?: string | null };
          const urls = [...(data.photo_urls ?? []), data.photo_url].filter(Boolean) as string[];
          const photo = state.photos.find((p) => p.id === pid);
          if (photo && !urls.some((u) => u === photo.uri)) {
            photoStates[pid] = { kind: 'untagged' };
          }
        }
        return { ...g, photoStates };
      }),
    }));
  },
}));
