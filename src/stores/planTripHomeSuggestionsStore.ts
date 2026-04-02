import { create } from 'zustand';
import type { HomeHotSpotData } from '@/src/utils/homeHotSpots';

/**
 * Latest home-screen hot spot rows (AI + conditions) so Plan a Trip can reuse them
 * without calling getTopFishingSpots again when opened with ?fromHome=1.
 */
interface PlanTripHomeSuggestionsState {
  items: HomeHotSpotData[];
  setFromHomeHotSpots: (items: HomeHotSpotData[]) => void;
}

export const usePlanTripHomeSuggestionsStore = create<PlanTripHomeSuggestionsState>((set) => ({
  items: [],
  setFromHomeHotSpots: (items) => set({ items }),
}));
