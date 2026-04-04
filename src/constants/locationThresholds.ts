/**
 * If the map pin is farther than this from a chosen catalog place's coordinates,
 * we show the second step (name / type / save-as-new) so they can add a child spot.
 * Within this distance, picking that listed place attaches the **existing** location id
 * only — no new row in `locations` (see `isWithinPinParentReuseThreshold` in locationService).
 * 1 statute mile in kilometers.
 */
export const LOCATION_PIN_ADJUST_THRESHOLD_KM = 1 * 1.609344;

/**
 * Suggested root parent locations (Fish now, import, add-location) only within this radius.
 * ~100 statute miles. No farther “global fallback” list — empty means go straight to create-new.
 */
export const PARENT_CANDIDATE_MAX_RADIUS_KM = 100 * 1.609344;

/** How many nearby catalog pins to merge on the Fish now / import map (within {@link PARENT_CANDIDATE_MAX_RADIUS_KM}). */
export const PIN_PARENT_MAP_ROOT_CAP = 80;

/** How many nearest catalog rows to fetch for the step-1 suggestion list (by distance; includes child locations). */
export const STEP1_NEARBY_CATALOG_LIST_CAP = 3;
