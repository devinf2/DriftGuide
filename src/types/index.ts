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

/** Who can see trip-linked photos on your profile (not journal timeline). */
export type TripPhotoVisibility = 'private' | 'friends_only' | 'public';

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
  first_name?: string | null;
  last_name?: string | null;
  preferred_fishing_type: FishingType;
  created_at: string;
  /** Public Supabase Storage URL for profile image (photos bucket). */
  avatar_url?: string | null;
  /** US home state (full name or 2-letter code) for offline catalog snapshot. Kept for US backward-compat. */
  home_state?: string | null;
  /** Home country (full name or ISO 3166-1 alpha-2 code). Required at onboarding. */
  home_country?: string | null;
  /** Home region/state within the country (free text; US states also mirrored to home_state). */
  home_region?: string | null;
  /** Set when the user finishes first-run profile onboarding in the app. */
  onboarding_completed_at?: string | null;
  /** Set when the user closed their account (soft delete); app signs out and blocks use. */
  account_deleted_at?: string | null;
  /** Case-insensitive unique handle for friend lookup (optional). */
  friend_code?: string | null;
  /** Optional unique @handle for discovery (lowercase a–z, 0–9, underscore). */
  username?: string | null;
  /** Default visibility for trip photos on profile; per-trip can override. */
  default_trip_photo_visibility?: TripPhotoVisibility;
  /** Grants moderation/verification powers (approve businesses, verify guides, curate promotions). */
  is_admin?: boolean;
}

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

/** One row per pair (profile_min < profile_max). */
export interface FriendshipRow {
  profile_min: string;
  profile_max: string;
  status: FriendshipStatus;
  requested_by: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Social feed (WS-H). Posts reuse the TripPhotoVisibility vocabulary.
// ---------------------------------------------------------------------------

/** Reaction kinds — must match the post_reactions CHECK in migration 117. */
export type PostReaction = 'fire' | 'fish' | 'like' | 'net' | 'wow';
// Reactions offered in the quick-react row. `net` (🥅) is retired from the UI but kept in the
// union above so any legacy rows already stored stay valid.
export const POST_REACTIONS: PostReaction[] = ['fire', 'fish', 'like', 'wow'];

/** DB row: posts table. */
export interface PostRow {
  id: string;
  author_id: string;
  trip_id: string | null;
  catch_event_id: string | null;
  caption: string | null;
  species: string | null;
  size_inches: number | null;
  fly_name: string | null;
  /** Denormalized catch facts captured at publish time; display-only. */
  depth_ft: number | null;
  presentation: string | null;
  /** Water/location name — only set when the author opts in to share location. */
  location_name: string | null;
  /** From catches.caught_by_user_id (115); null = the author caught it. */
  caught_by_user_id: string | null;
  /** Array of remote https photo urls captured at publish time. */
  media: string[];
  visibility: TripPhotoVisibility;
  created_at: string;
  deleted_at?: string | null;
}

/** One aggregated reaction bucket for a post (from post_reactions_summary RPC). */
export interface PostReactionSummary {
  post_id: string;
  reaction: PostReaction;
  count: number;
  reacted_by_me: boolean;
}

/** A post plus the author profile + reaction summary, assembled client-side for the feed UI. */
export interface FeedPost {
  post: PostRow;
  author: Profile | null;
  reactions: PostReactionSummary[];
  /** Live comment count on this post (visible comments only). */
  commentCount?: number;
  /** Up to 2 most-recent comments (oldest-first), for the Instagram-style card preview. */
  recentComments?: PostComment[];
}

/** DB row: post_comments table, plus the author profile joined client-side. */
export interface PostComment {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: Profile | null;
}

export type SessionMemberRole = 'owner' | 'member';

export interface SharedSession {
  id: string;
  created_by: string;
  title: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface SessionMember {
  shared_session_id: string;
  user_id: string;
  role: SessionMemberRole;
  joined_at: string;
}

export type SessionInviteStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface SessionInvite {
  id: string;
  shared_session_id: string;
  inviter_id: string;
  invitee_id: string;
  status: SessionInviteStatus;
  token: string;
  created_at: string;
  expires_at: string;
  /** Trip the inviter sent the invite from (optional). */
  inviter_trip_id?: string | null;
  /** Inviter trip start (or equivalent); invitee UI filters linkable trips to ±5 days. */
  merge_window_anchor_at?: string | null;
  /** Set when the invite is sent; legacy rows infer from inviter trip at link time. */
  invite_kind?: 'upcoming' | 'past' | null;
}

/** Trip timeline event with attribution for merged Group view. */
export interface TripEventWithSource extends TripEvent {
  source_user_id: string;
  source_display_name: string;
  /** Child trip this row came from (session parent = trips.shared_session_id). */
  source_trip_id: string;
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
  /** USPS 2-letter state code (e.g. 'UT', 'FL'). Null = unknown / non-US. */
  state?: string | null;
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

/** Outfitters, lodges, fly shops — commercial listings, standalone from the fishing-spot catalog. */
export type BusinessCategory = 'outfitter' | 'lodge' | 'fly_shop' | 'guide_service' | 'other';

/** Provenance/moderation state, mirrors LocationStatus. User submissions start 'pending'. */
export type BusinessStatus = 'verified' | 'community' | 'pending';

/** Per-day open/close, free-form (e.g. { mon: { open: '08:00', close: '18:00' } }). */
export type BusinessHours = Partial<
  Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { open: string; close: string } | null>
>;

export interface Business {
  id: string;
  name: string;
  category: BusinessCategory;
  latitude: number;
  longitude: number;
  /** Optional explicit tie to a water; surfaces on that location's Report. */
  location_id?: string | null;
  address?: string | null;
  state?: string | null;
  description?: string | null;
  website_url?: string | null;
  phone?: string | null;
  email?: string | null;
  hours?: BusinessHours | null;
  logo_url?: string | null;
  cover_url?: string | null;
  status: BusinessStatus;
  created_by?: string | null;
  usage_count?: number;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
}

export interface BusinessPhoto {
  id: string;
  business_id: string;
  photo_url: string;
  sort_order: number;
  created_by?: string | null;
  created_at: string;
}

/** Partner organization (e.g. Uinta Life Fishing Collective) with a community link. */
export interface Partner {
  id: string;
  name: string;
  community_url?: string | null;
  logo_url?: string | null;
  description?: string | null;
  created_at: string;
}

/** A discount/offer on a business, linking members to the partner community. */
export interface BusinessDeal {
  id: string;
  business_id: string;
  partner_id?: string | null;
  title: string;
  detail?: string | null;
  /** Falls back (in app) to the partner's community_url when null. */
  cta_url?: string | null;
  active: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  created_by?: string | null;
  created_at: string;
}

export type PromotionSubject = 'business' | 'deal' | 'guide';
export type PromotionPlacement = 'home_featured';

export interface Promotion {
  id: string;
  subject_type: PromotionSubject;
  subject_id: string;
  placement: PromotionPlacement;
  priority: number;
  active: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  created_at: string;
}

/** A resolved featured item for the home rail (promotion joined to its business/deal/partner). */
export interface FeaturedBusinessCard {
  promotionId: string;
  businessId: string;
  businessName: string;
  category: BusinessCategory;
  logoUrl?: string | null;
  coverUrl?: string | null;
  dealTitle?: string | null;
  /** Where the deal CTA sends the user (partner community, etc.). */
  ctaUrl?: string | null;
  partnerName?: string | null;
}

// --- Guide / Pro marketplace ---

export type GuideStatus = 'pending' | 'approved' | 'suspended';
export type GuideBookingStatus = 'requested' | 'accepted' | 'declined' | 'completed' | 'cancelled';

/** 1:1 extension of a profile for anglers who sell guiding services. Verified = verified_at set. */
export interface GuideProfile {
  profile_id: string;
  bio?: string | null;
  home_water?: string | null;
  years_experience?: number | null;
  rates?: Record<string, unknown> | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  booking_url?: string | null;
  status: GuideStatus;
  verified_at?: string | null;
  verified_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

/** Guide profile joined with the underlying profile's display fields (for screens). */
export interface GuideProfileWithProfile extends GuideProfile {
  profile?: Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'username'> | null;
}

/** 'booking' = a guided trip (date/times, quantity); 'download' = a PDF guide book. */
export type GuideOfferingType = 'booking' | 'download';

/** A guide's offering. Payment for both types is arranged off-app (Venmo/contact) for now. */
export interface GuideService {
  id: string;
  guide_id: string;
  offering_type: GuideOfferingType;
  title: string;
  location_id?: string | null;
  price_cents?: number | null;
  duration_label?: string | null;
  description?: string | null;
  /** 'booking' only: optional cap on spots/quantity. */
  quantity_available?: number | null;
  /** 'download' only: PDF location once paid delivery ships (deferred). */
  download_url?: string | null;
  active: boolean;
  created_at: string;
}

export interface GuideBooking {
  id: string;
  guide_id: string;
  requester_id: string;
  service_id?: string | null;
  requested_date?: string | null;
  party_size?: number | null;
  message?: string | null;
  status: GuideBookingStatus;
  created_at: string;
}

export interface GuideReview {
  id: string;
  guide_id: string;
  reviewer_id: string;
  trip_id?: string | null;
  rating: number;
  body?: string | null;
  created_at: string;
}

/** Review joined with the reviewer's display fields (for the reviews list). */
export interface GuideReviewWithReviewer extends GuideReview {
  reviewer?: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> | null;
}

export interface GuidePublicStats {
  avg_rating: number;
  review_count: number;
  trips_completed: number;
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
  /** True when created via Import Past Trips (not a live timed session). */
  imported?: boolean | null;
  /** Active trip time in ms, excluding pauses; set when trip completes. */
  active_fishing_ms?: number | null;
  created_at: string;
  /** Soft delete — excluded from location usage checks when set. */
  deleted_at?: string | null;
  /** When set, this trip is part of a shared fishing session (group timeline). */
  shared_session_id?: string | null;
  /**
   * Local, offline-safe roster of friends attributed catches on this trip (via "Caught by"),
   * plus any explicitly added. Client-only — rides the trip bundle, NOT a server membership and
   * NOT included in tripToUpsertPayload. Reconstructable from catch attributions + session members.
   */
  participant_user_ids?: string[] | null;
  /** Override profile default for album photos on profile; null = use profile default. */
  trip_photo_visibility?: TripPhotoVisibility | null;
  /** Set on successful server sync when a survey rating was included. */
  survey_submitted_at?: string | null;
  /** Last full bundle sync to the server (client clock). */
  last_full_sync_at?: string | null;
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
  /** User fly box row (user_fly_box.id) for stable photo/metadata lookup */
  user_fly_box_id?: string | null;
  /** Snapshot of resolved photo at time of fly change (historical accuracy) */
  photo_url?: string | null;
  /** Second fly (e.g. dropper); hopper-dropper rig */
  pattern2?: string | null;
  size2?: number | null;
  color2?: string | null;
  fly_id2?: string | null;
  fly_color_id2?: string | null;
  fly_size_id2?: string | null;
  user_fly_box_id2?: string | null;
  photo_url2?: string | null;
}

export interface CatchData {
  species: string | null;
  size_inches: number | null;
  /** Whole pounds; use with weight_oz 0–15. */
  weight_lb?: number | null;
  weight_oz?: number | null;
  note: string | null;
  /** Hero / map pin; kept in sync as first entry of photo_urls when set. */
  photo_url: string | null;
  /** Ordered gallery (remote https or local file URIs before upload). */
  photo_urls?: string[] | null;
  active_fly_event_id: string | null;
  /** Which fly on the rig caught the fish when using two flies; null if not chosen yet */
  caught_on_fly?: 'primary' | 'dropper' | null;
  quantity?: number | null;
  depth_ft?: number | null;
  presentation_method?: PresentationMethod | null;
  released?: boolean | null;
  structure?: Structure | null;
  /** Friend this catch is attributed to; null/undefined = me (the trip owner). Display-only — the row stays under my user_id (RLS). */
  caught_by_user_id?: string | null;
  /** Cached pointer to the attributed friend's trip in a shared session, when known. Grouping only; never moves ownership. */
  caught_for_trip_id?: string | null;
}

export interface NoteData {
  text: string;
}

/** Optional web citations saved with AI guide replies (trip timeline). */
export interface AIQueryWebSource {
  url: string;
  title: string;
  fetchedAt?: string;
  excerpt?: string;
}

export interface AIQueryData {
  question: string;
  response: string | null;
  /** Optional second assistant bubble (e.g. offline bundled guide). */
  supplementResponse?: string | null;
  webSources?: AIQueryWebSource[];
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
  weight_lb?: number | null;
  weight_oz?: number | null;
  quantity: number;
  released: boolean | null;
  depth_ft: number | null;
  structure: string | null;
  caught_on_fly: string | null;
  active_fly_event_id: string | null;
  presentation_method: string | null;
  note: string | null;
  photo_url: string | null;
  /** From trip_events JSON when merged; optional on legacy rows. */
  photo_urls?: string[] | null;
  conditions_snapshot_id: string | null;
  fly_pattern: string | null;
  fly_size: number | null;
  fly_color: string | null;
  /** Friend this catch is attributed to; null = me (the trip owner). */
  caught_by_user_id?: string | null;
  /** Cached pointer to the attributed friend's trip in a shared session, when known. */
  caught_for_trip_id?: string | null;
  created_at?: string;
  deleted_at?: string | null;
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
  weight_lb?: number | null;
  weight_oz?: number | null;
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
  /** Denormalized from trips at sync time (no free-text trip notes). */
  trip_fishing_type?: string | null;
  trip_session_type?: string | null;
  trip_planned_date?: string | null;
  trip_start_time?: string | null;
  trip_end_time?: string | null;
  trip_status?: string | null;
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
  /** Slot start (local device TZ used only for display grouping) */
  timestamp_ms: number;
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
  /** Full weather snapshot when coordinates existed (for UI tabs without a second fetch). */
  rawWeather?: WeatherData | null;
  /** USGS (or mock) flow row when a station id was present. */
  rawWaterFlow?: WaterFlowData | null;
  /** Set on plan-a-trip when sky/wind/temp come from OpenWeather forecast for the selected time. */
  weatherIsForecastForPlannedTime?: boolean;
  /** Forecast API does not cover the selected date (~5 day horizon). Water/flow are still current. */
  plannedTimeWeatherUnavailable?: boolean;
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
  /** Same id as catches.id / trip_events.id for that catch. */
  catch_id?: string | null;
  display_order?: number | null;
  url: string;
  caption: string | null;
  species: string | null;
  fly_pattern: string | null;
  fly_size: string | null;
  fly_color: string | null;
  fly_id: string | null;
  captured_at: string | null;
  created_at: string;
  deleted_at?: string | null;
}

/** Coarse land-ownership bucket the Public/Private Land overlay styles + access copy key off of. */
export type LandOwnershipType =
  | 'private'
  | 'federal'
  | 'state'
  | 'tribal'
  | 'local'
  | 'water'
  | 'unknown';

/** Result of tapping the map with the land overlay on (RPC: land_ownership_at_point). */
export interface LandOwnershipInfo {
  ownership_type: LandOwnershipType;
  agency: string | null;
  owner_name: string | null;
  access_status: 'public' | 'restricted' | 'unknown';
  admin_unit: string | null;
}
