import { create } from 'zustand';

/** True while Map tab add-location sheet is open — hides PlanTripFab so it does not cover the form. */
interface AddLocationFlowState {
  mapSheetActive: boolean;
  setMapSheetActive: (v: boolean) => void;
}

export const useAddLocationFlowStore = create<AddLocationFlowState>((set) => ({
  mapSheetActive: false,
  setMapSheetActive: (v) => set({ mapSheetActive: v }),
}));
