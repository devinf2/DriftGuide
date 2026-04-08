/**
 * Request/response shapes for the `guide-intel` Supabase Edge Function.
 * Keep in sync with supabase/functions/guide-intel/index.ts
 */

export type GuideIntelAction =
  | 'chat'
  | 'fly_recommendation'
  | 'hot_spots'
  | 'spot_summary'
  | 'hatch_briefing'
  | 'spot_detailed'
  | 'guide_greeting'
  | 'how_to_fish'
  | 'fly_of_the_day'
  | 'extract_locations';

/** Citation returned from Edge (USGS + model-attributed web-style refs). */
export type GuideIntelSource = {
  url: string;
  title: string;
  fetchedAt: string;
  excerpt: string;
};

export type GuideIntelSpotSummaryResult = {
  report: string;
  topFlies: string[];
  bestTime: string;
  sources: GuideIntelSource[];
  fishingQualitySignal: number | null;
  fetchedAt: string;
};

export type GuideIntelHotSpotSpot = {
  id: string;
  name: string;
  sky?: string;
  tempF?: number;
  windMph?: number;
  windDir?: string;
  flowCfs?: number | null;
  clarity?: string;
  omitWeather?: boolean;
  /** Community fish-equivalent count (60d) for internal weighting */
  communityFishN?: number;
  /** User saved this catalog location as a favorite (tie-break hint for ranking). */
  isUserFavorite?: boolean;
};

export type GuideIntelRequestBase = {
  action: GuideIntelAction;
  /** Region label for prompts, e.g. "Utah" or "Colorado" from reverse geocode */
  regionLabel: string;
};

/** Edge uses this to require web search when DriftGuide logs are thin. */
export type GuideIntelChatDataTier = 'sparse' | 'rich';

/** Structured cards when the guide recommends or compares catalog waters (from model JSON block). */
export type GuideLocationRecommendationSpot = {
  name: string;
  location_id: string;
  reason: string;
  top_flies: string[];
  /** 0–10 qualitative strength */
  confidence: number;
};

export type GuideLocationRecommendation = {
  type: 'location_recommendation';
  locations: GuideLocationRecommendationSpot[];
  summary: string;
};

export type GuideIntelChatPayload = GuideIntelRequestBase & {
  action: 'chat';
  question: string;
  contextLines: string[];
  internalCatchNote?: string;
  /** When `sparse`, OpenAI must run web search before answering (Responses API). */
  chatDataTier?: GuideIntelChatDataTier;
  /**
   * When true, the model must append a ```driftguide-location``` JSON block after the prose answer.
   * Edge strips the fence from `text` and returns `locationRecommendation` when valid.
   */
  includeLocationRecommendationJson?: boolean;
};

export type GuideIntelFlyRecPayload = GuideIntelRequestBase & {
  action: 'fly_recommendation';
  promptUser: string;
};

export type GuideIntelHotSpotsPayload = GuideIntelRequestBase & {
  action: 'hot_spots';
  spots: GuideIntelHotSpotSpot[];
  contextDateIso: string;
  forPlannedTrip: boolean;
};

export type GuideIntelSpotSummaryPayload = GuideIntelRequestBase & {
  action: 'spot_summary';
  locationName: string;
  conditionsSummary: string;
  season: string;
  timeOfDay: string;
  latitude?: number | null;
  longitude?: number | null;
  usgsSiteId?: string | null;
  communityFishN?: number;
};

export type GuideIntelHatchPayload = GuideIntelRequestBase & {
  action: 'hatch_briefing';
  waters: { name: string; conditionsLine: string }[];
  contextDateIso: string;
};

export type GuideIntelSpotTextPayload = GuideIntelRequestBase & {
  action: 'spot_detailed' | 'guide_greeting' | 'how_to_fish';
  locationName: string;
  conditionsSummary: string;
  season: string;
  timeOfDay: string;
};

export type GuideIntelFlyOfDayPayload = GuideIntelRequestBase & {
  action: 'fly_of_the_day';
  promptUser: string;
};

export type GuideIntelExtractLocationsPayload = GuideIntelRequestBase & {
  action: 'extract_locations';
  question: string;
};

export type GuideIntelRequestBody =
  | GuideIntelChatPayload
  | GuideIntelFlyRecPayload
  | GuideIntelHotSpotsPayload
  | GuideIntelSpotSummaryPayload
  | GuideIntelHatchPayload
  | GuideIntelSpotTextPayload
  | GuideIntelFlyOfDayPayload
  | GuideIntelExtractLocationsPayload;

export type GuideIntelErrorBody = { error: string; code?: string };

/** Normalized `guide-intel` `chat` success body. */
export type GuideIntelChatResultBody = {
  text: string;
  sources?: GuideIntelSource[];
  fetchedAt?: string;
  locationRecommendation?: GuideLocationRecommendation | null;
};
