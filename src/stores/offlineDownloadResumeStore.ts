import { create } from 'zustand';
import type { FishingType, Location, SessionType } from '@/src/types';

export type PlanTripResumePayload = {
  userId: string;
  locationId: string;
  fishingType: FishingType;
  location: Location;
  plannedDateIso: string;
  sessionType: SessionType | null;
  accessPointId: string | null;
};

type OfflineDownloadResumeState = {
  fishNowLocation: Location | null;
  planTripResume: PlanTripResumePayload | null;
  setFishNowResume: (loc: Location | null) => void;
  setPlanTripResume: (p: PlanTripResumePayload | null) => void;
  clearFishNowResume: () => void;
  clearPlanTripResume: () => void;
};

export const useOfflineDownloadResumeStore = create<OfflineDownloadResumeState>((set) => ({
  fishNowLocation: null,
  planTripResume: null,
  setFishNowResume: (loc) => set({ fishNowLocation: loc }),
  setPlanTripResume: (p) => set({ planTripResume: p }),
  clearFishNowResume: () => set({ fishNowLocation: null }),
  clearPlanTripResume: () => set({ planTripResume: null }),
}));
