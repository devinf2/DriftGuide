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
