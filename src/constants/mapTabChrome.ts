import { Spacing } from '@/src/constants/theme';

/** Approximate tab bar content height (icons + label); keep in sync with PlanTripFab menu positioning. */
export const TAB_BAR_EXTRA = 52;

/** Bottom inset for map controls / scroll padding above the tab bar (fish control lives in the bar). */
export const PLAN_TRIP_FAB_MAP_CLEARANCE = TAB_BAR_EXTRA + Spacing.md;
