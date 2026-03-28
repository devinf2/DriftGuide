export type FishingType = 'fly' | 'bait' | 'spin';
export type TripStatus = 'active' | 'completed' | 'planned';
export type EventType = 'fly_change' | 'catch' | 'note' | 'location_move' | 'ai_query' | 'ai_response' | 'bite' | 'got_off' | 'fish_on';
export type LocationType =
  | 'river'
  | 'lake'
  | 'reservoir'
  | 'stream'
  | 'pond'
  | 'access_point'
  | 'parking';
export type LocationStatus = 'verified' | 'community' | 'pending';
export type FlyType = 'fly' | 'bait' | 'lure';

/** How the fly is fished / behaves in the water (fly fishing terms). */
export type FlyPresentation = 'dry' | 'emerger' | 'wet' | 'nymph' | 'streamer';

export type SessionType = 'wade' | 'float' | 'shore';
export type PresentationMethod = 'dry' | 'nymph' | 'streamer' | 'wet' | 'other';
export type Structure = 'pool' | 'riffle' | 'run' | 'undercut_bank' | 'eddy' | 'other';
export type MoonPhase =
  | 'new'
  | 'waxing_crescent'
  | 'first_quarter'
  | 'waxing_gibbous'
  | 'full'
  | 'waning_gibbous'
  | 'last_quarter'
  | 'waning_crescent';

export interface Profile {
  id: string;
  display_name: string;
  preferred_fishing_type: FishingType;
  created_at: string;
}

export type AccessPointStatus = 'pending' | 'approved';

/** Trailhead / ramp / parking — tied to a location; user submissions start pending. */
export interface AccessPoint {
  id: string;
  location_id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: AccessPointStatus;
  created_by: string | null;
  created_at: string;
}

export interface Location {
  id: string;
  name: string;
  type: LocationType;
  parent_location_id: string | null;
  latitude: number | null;
  longitude: number | null;
  metadata: Record<string, unknown> | null;
  created_by?: string | null;
  status?: LocationStatus;
  usage_count?: number;
  /** When false, only the creator should see this location (RLS). Default true. */
  is_public?: boolean | null;
  /** Soft delete — null means active. Omitted on normal reads (RLS hides deleted rows). */
  deleted_at?: string | null;
  deleted_by?: string | null;
}

export interface NearbyLocationResult {
  id: string;
  name: string;
  type: LocationType;
  latitude: number;
  longitude: number;
  status: string;
  distance_km: number;
  name_similarity: number;
}

export interface Trip {
  id: string;
  user_id: string;
  location_id: string | null;
  /** Optional starting access (trailhead, ramp, etc.). */
  access_point_id?: string | null;
  location?: Location;
  status: TripStatus;
  fishing_type: FishingType;
  planned_date: string | null;
  start_time: string;
  end_time: string | null;
  total_fish: number;
  notes: string | null;
  ai_recommendation_cache: Record<string, unknown> | null;
  weather_cache: WeatherData | null;
  water_flow_cache: WaterFlowData | null;
  start_latitude?: number | null;
  start_longitude?: number | null;
  end_latitude?: number | null;
  end_longitude?: number | null;
  session_type?: SessionType | null;
  rating?: number | null;
  user_reported_clarity?: WaterClarity | null;
  created_at: string;
}

export interface TripEvent {
  id: string;
  trip_id: string;
  event_type: EventType;
  timestamp: string;
  data: FlyChangeData | CatchData | NoteData | AIQueryData | Record<string, unknown>;
  conditions_snapshot: EventConditionsSnapshot | null;
  latitude: number | null;
  longitude: number | null;
}

export interface FlyChangeData {
  pattern: string;
  size: number | null;
  color: string | null;
  /** Catalog fly (fly_catalog.id); when set, color/size may reference fly_colors/fly_sizes */
  fly_id?: string | null;
  fly_color_id?: string | null;
  fly_size_id?: string | null;
  /** Second fly (e.g. dropper); hopper-dropper rig */
  pattern2?: string | null;
  size2?: number | null;
  color2?: string | null;
  fly_id2?: string | null;
  fly_color_id2?: string | null;
  fly_size_id2?: string | null;
}

export interface CatchData {
  species: string | null;
  size_inches: number | null;
  note: string | null;
  photo_url: string | null;
  active_fly_event_id: string | null;
  /** Which fly on the rig caught the fish when using two flies */
  caught_on_fly?: 'primary' | 'dropper';
  quantity?: number | null;
  depth_ft?: number | null;
  presentation_method?: PresentationMethod | null;
  released?: boolean | null;
  structure?: Structure | null;
}

export interface NoteData {
  text: string;
}

export interface AIQueryData {
  question: string;
  response: string | null;
}

export interface EventConditionsSnapshot {
  weather: WeatherData | null;
  waterFlow: WaterFlowData | null;
  captured_at: string;
  moon_phase?: MoonPhase | null;
}

/** DB row: conditions_snapshots table. Referenced by catches for queryable/offline conditions. */
export interface ConditionsSnapshotRow {
  id: string;
  temperature_f: number | null;
  condition: string | null;
  cloud_cover: number | null;
  wind_speed_mph: number | null;
  wind_direction: string | null;
  barometric_pressure: number | null;
  humidity: number | null;
  flow_station_id: string | null;
  flow_station_name: string | null;
  flow_cfs: number | null;
  water_temp_f: number | null;
  gage_height_ft: number | null;
  turbidity_ntu: number | null;
  flow_clarity: string | null;
  flow_clarity_source: string | null;
  flow_timestamp: string | null;
  moon_phase: string | null;
  captured_at: string;
}

/** DB row: catches table. One per catch event; links to trip_events, conditions_snapshot, location. */
export interface CatchRow {
  id: string;
  user_id: string;
  trip_id: string;
  event_id: string;
  location_id: string | null;
  access_point_id?: string | null;
  latitude: number | null;
  longitude: number | null;
  timestamp: string;
  species: string | null;
  size_inches: number | null;
  quantity: number;
  released: boolean | null;
  depth_ft: number | null;
  structure: string | null;
  caught_on_fly: string | null;
  active_fly_event_id: string | null;
  presentation_method: string | null;
  note: string | null;
  photo_url: string | null;
  conditions_snapshot_id: string | null;
  fly_pattern: string | null;
  fly_size: number | null;
  fly_color: string | null;
  created_at?: string;
}

/** Anonymized catch for community/offline AI: no user_id, trip_id, event_id, photo_url. */
export interface CommunityCatchRow {
  id: string;
  location_id: string | null;
  latitude: number | null;
  longitude: number | null;
  timestamp: string;
  species: string | null;
  size_inches: number | null;
  quantity: number;
  released: boolean | null;
  depth_ft: number | null;
  structure: string | null;
  caught_on_fly: string | null;
  fly_pattern: string | null;
  fly_size: number | null;
  fly_color: string | null;
  presentation_method: string | null;
  conditions_snapshot_id: string | null;
  note: string | null;
}

/** Global fly catalog: pattern only (no user, size, color). */
export interface FlyCatalog {
  id: string;
  name: string;
  type: FlyType;
  photo_url: string | null;
  presentation: FlyPresentation | null;
  created_at?: string;
}

export interface FlyColor {
  id: string;
  name: string;
}

export interface FlySize {
  id: string;
  value: number;
}

/** User fly box row: catalog fly + color/size variant. */
export interface UserFlyBoxEntry {
  id: string;
  user_id: string;
  fly_id: string;
  fly_color_id: string | null;
  fly_size_id: string | null;
  created_at?: string;
  /** Joined for display */
  fly?: FlyCatalog | null;
  fly_color?: FlyColor | null;
  fly_size?: FlySize | null;
}

/** Display shape for a fly (user's fly box item or picker): catalog + color/size for display; ids for persistence. */
export interface Fly {
  id: string;
  user_id?: string;
  name: string;
  type: FlyType;
  size: number | null;
  color: string | null;
  photo_url: string | null;
  presentation?: FlyPresentation | null;
  use_count?: number;
  /** How many of this fly (pattern/size/color) the user has; can go up/down over time. */
  quantity?: number;
  /** Catalog and variant ids (when from user_fly_box) */
  fly_id?: string | null;
  fly_color_id?: string | null;
  fly_size_id?: string | null;
}

export interface WeatherData {
  temperature_f: number;
  condition: string;
  cloud_cover: number;
  wind_speed_mph: number;
  wind_direction: string;
  barometric_pressure: number;
  humidity: number;
}

/** Single 3-hour forecast slot from OpenWeatherMap forecast API */
export interface HourlyForecastItem {
  time: string;
  temp_f: number;
  condition: string;
  pop?: number;
  wind_speed_mph?: number;
  wind_direction?: string;
}

export type WaterClarity = 'clear' | 'slightly_stained' | 'stained' | 'murky' | 'blown_out' | 'unknown';

export interface WaterFlowData {
  station_id: string;
  station_name: string;
  flow_cfs: number;
  water_temp_f: number | null;
  gage_height_ft: number | null;
  turbidity_ntu: number | null;
  clarity: WaterClarity;
  clarity_source: 'sensor' | 'inferred' | 'mock';
  timestamp: string;
}

export interface NextFlyRecommendation {
  pattern: string;
  size: number;
  color: string;
  reason: string;
  confidence: number;
  /** Catalog/variant ids when recommendation matches catalog */
  fly_id?: string | null;
  fly_color_id?: string | null;
  fly_size_id?: string | null;
  /** Second fly for two-fly rig (e.g. hopper-dropper); when set, recommend as primary + dropper */
  pattern2?: string | null;
  size2?: number | null;
  color2?: string | null;
  fly_id2?: string | null;
  fly_color_id2?: string | null;
  fly_size_id2?: string | null;
}

export type ConditionRating = 'good' | 'fair' | 'poor';

export type FlowStatus = 'low' | 'normal' | 'high' | 'very_high' | 'extreme' | 'unknown';

export interface FlowStatusInfo {
  status: FlowStatus;
  ratio: number | null;
  baseline_cfs: number | null;
}

export interface LocationConditions {
  locationId: string;
  sky: { condition: string; label: string; rating: ConditionRating };
  wind: { speed_mph: number; rating: ConditionRating };
  temperature: { temp_f: number; rating: ConditionRating };
  water: { clarity: WaterClarity; flow_cfs: number | null; rating: ConditionRating };
  fetchedAt: string;
}

export interface FishingSpotSuggestion {
  locationName: string;
  locationId: string | null;
  reason: string;
  confidence: number;
}

/** Single photos table. Optional tie-ins: trip_id, species, fly (pattern/size/color or fly_id), captured_at. Date/location from trip when trip_id set. */
export interface Photo {
  id: string;
  user_id: string;
  trip_id: string | null;
  url: string;
  caption: string | null;
  species: string | null;
  fly_pattern: string | null;
  fly_size: string | null;
  fly_color: string | null;
  fly_id: string | null;
  captured_at: string | null;
  created_at: string;
}
