import {
  TripEvent,
  WeatherData,
  WaterFlowData,
  Location,
  LocationConditions,
  FishingType,
  FlyChangeData,
  CatchData,
  NextFlyRecommendation,
  Fly,
} from '@/src/types';
import { CLARITY_LABELS, CLARITY_DESCRIPTIONS } from '@/src/services/waterFlow';
import { flyPatternsMatch, nextFlyRecommendationConflictsCurrent, normalizeFlyPatternKey } from '@/src/utils/flyPatternCompare';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
/** Use the cheaper model for all AI calls to control cost */
const AI_MODEL = 'gpt-4o-mini';

export interface AIContext {
  location: Location | null;
  fishingType: FishingType;
  weather: WeatherData | null;
  waterFlow: WaterFlowData | null;
  currentFly: string | null;
  /** Second fly on rig (e.g. dropper); when set, angler is using a two-fly rig */
  currentFly2?: string | null;
  fishCount: number;
  recentEvents: TripEvent[];
  timeOfDay: string;
  season: string;
  /** User's fly box — prefer recommending from these when appropriate */
  userFlies?: Fly[] | null;
  /**
   * DriftGuide DB context: matched catalog waters + community & user catch aggregates.
   * Injected by enrichContextWithLocationCatchData before askAI when the user sends a chat message.
   */
  guideLocationCatchSummary?: string | null;
}

export function getSeason(date: Date): string {
  const month = date.getMonth();
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}

export function getTimeOfDay(date: Date): string {
  const hour = date.getHours();
  if (hour < 6) return 'pre-dawn';
  if (hour < 9) return 'early morning';
  if (hour < 12) return 'late morning';
  if (hour < 14) return 'midday';
  if (hour < 17) return 'afternoon';
  if (hour < 20) return 'evening';
  return 'night';
}

function buildTripSummary(events: TripEvent[]): string {
  const flyStints: { fly: string; catches: number; startIdx: number }[] = [];
  let currentFlyName = '';

  for (const event of events) {
    if (event.event_type === 'fly_change') {
      const data = event.data as FlyChangeData;
      const primary = `${data.pattern}${data.size ? ` #${data.size}` : ''}${data.color ? ` (${data.color})` : ''}`;
      currentFlyName = data.pattern2
        ? `${primary} / ${data.pattern2}${data.size2 ? ` #${data.size2}` : ''}${data.color2 ? ` (${data.color2})` : ''}`
        : primary;
      flyStints.push({ fly: currentFlyName, catches: 0, startIdx: flyStints.length });
    } else if (event.event_type === 'catch' && flyStints.length > 0) {
      flyStints[flyStints.length - 1].catches++;
    }
  }

  if (flyStints.length === 0) return 'No flies have been used yet.';

  const lines = flyStints.map((stint, i) => {
    const isCurrent = i === flyStints.length - 1;
    const label = isCurrent ? '(current)' : '';
    return `- ${stint.fly} ${label}: ${stint.catches} fish caught`;
  });

  return lines.join('\n');
}

function buildPrompt(context: AIContext, question: string): string {
  const lines = [
    'You are an expert fishing guide assistant. Provide concise, actionable advice.',
    '',
    `Location: ${context.location?.name || 'Unknown'}`,
    `Fishing type: ${context.fishingType}`,
    `Time of day: ${context.timeOfDay}`,
    `Season: ${context.season}`,
    `Fish caught so far: ${context.fishCount}`,
  ];

  if (context.currentFly) {
    lines.push(`Currently using: ${context.currentFly2 ? `${context.currentFly} / ${context.currentFly2}` : context.currentFly}`);
  }

  if (context.userFlies && context.userFlies.length > 0) {
    lines.push(`Angler's fly box: ${context.userFlies.map(f => f.name + (f.size ? ` #${f.size}` : '') + (f.color ? ` (${f.color})` : '')).join(', ')}`);
  }

  if (context.weather) {
    lines.push('', '--- Weather ---');
    lines.push(`Temperature: ${context.weather.temperature_f}°F`);
    lines.push(`Conditions: ${context.weather.condition}`);
    lines.push(`Wind: ${context.weather.wind_speed_mph}mph ${context.weather.wind_direction}`);
    lines.push(`Barometric pressure: ${context.weather.barometric_pressure} inHg`);
    lines.push(`Cloud cover: ${context.weather.cloud_cover}%`);
    lines.push(`Humidity: ${context.weather.humidity}%`);
  }

  if (context.waterFlow) {
    lines.push('', '--- Water Conditions ---');
    lines.push(`Flow: ${context.waterFlow.flow_cfs} CFS`);
    if (context.waterFlow.water_temp_f !== null) {
      lines.push(`Water temp: ${context.waterFlow.water_temp_f}°F`);
    }
    if (context.waterFlow.gage_height_ft !== null) {
      lines.push(`Gage height: ${context.waterFlow.gage_height_ft} ft`);
    }
    lines.push(`Clarity: ${CLARITY_LABELS[context.waterFlow.clarity]} — ${CLARITY_DESCRIPTIONS[context.waterFlow.clarity]}`);
  }

  if (context.recentEvents.length > 0) {
    lines.push('', '--- Trip History ---');
    lines.push(buildTripSummary(context.recentEvents));
  }

  if (context.guideLocationCatchSummary?.trim()) {
    lines.push(
      '',
      '--- DriftGuide database (catalog waters + catch logs; use for comparisons and trends) ---',
      context.guideLocationCatchSummary.trim(),
    );
  }

  lines.push('', `Angler's question: ${question}`, '', 'Provide practical advice in 2-4 sentences.');
  return lines.join('\n');
}

function buildFlyRecommendationPrompt(context: AIContext): string {
  const lines = [
    'You are an expert fly fishing guide. Based on the following trip data and conditions, recommend either (A) the SINGLE best fly to try next, OR (B) a TWO-FLY RIG (e.g. dry + dropper, or point fly + dropper) when that would be better (e.g. morning/evening dry-dropper, or two nymphs).',
    '',
    `Location: ${context.location?.name || 'Unknown'}`,
    `Time of day: ${context.timeOfDay}`,
    `Season: ${context.season}`,
    `Total fish caught: ${context.fishCount}`,
  ];

  if (context.currentFly) {
    lines.push(`Currently using: ${context.currentFly2 ? `${context.currentFly} / ${context.currentFly2}` : context.currentFly}`);
  }

  lines.push(
    'CRITICAL: Recommend a pattern whose NAME is different from any fly already on the rig (compare names only; ignore hook sizes like #16 and ignore colors). The angler needs a distinct "try next" option, not a repeat of what is tied on.',
  );

  if (context.weather) {
    lines.push('', '--- Weather ---');
    lines.push(`Temperature: ${context.weather.temperature_f}°F, ${context.weather.condition}`);
    lines.push(`Wind: ${context.weather.wind_speed_mph}mph ${context.weather.wind_direction}`);
    lines.push(`Barometric pressure: ${context.weather.barometric_pressure} inHg`);
    lines.push(`Cloud cover: ${context.weather.cloud_cover}%, Humidity: ${context.weather.humidity}%`);
  }

  if (context.waterFlow) {
    lines.push('', '--- Water ---');
    lines.push(`Flow: ${context.waterFlow.flow_cfs} CFS`);
    if (context.waterFlow.water_temp_f !== null) lines.push(`Water temp: ${context.waterFlow.water_temp_f}°F`);
    lines.push(`Clarity: ${CLARITY_LABELS[context.waterFlow.clarity]}`);
  }

  if (context.recentEvents.length > 0) {
    lines.push('', '--- What has been tried this trip ---');
    lines.push(buildTripSummary(context.recentEvents));
    lines.push('');
    lines.push('IMPORTANT: If a fly was catching fish and the angler switched away from it and stopped catching, strongly consider recommending they go back to what was working (same pattern or similar). If nothing has worked, suggest something different from what has been tried.');
  }

  if (context.userFlies && context.userFlies.length > 0) {
    lines.push('', "--- Angler's fly box (ONLY recommend flies from this list; use closest match if no exact fit) ---");
    context.userFlies.forEach(f => {
      const parts = [f.name];
      if (f.size) parts.push(`#${f.size}`);
      if (f.color) parts.push(f.color);
      lines.push('- ' + parts.join(' '));
    });
    lines.push('');
  }

  lines.push('', 'Respond with ONLY valid JSON. For a single fly: {"pattern": "Name", "size": 18, "color": "Color", "reason": "Brief reason", "confidence": 0.8}');
  lines.push('For a two-fly rig add: "pattern2", "size2", "color2" (e.g. dry + dropper). Example: {"pattern": "Parachute Adams", "size": 16, "color": "Gray", "pattern2": "Zebra Midge", "size2": 20, "color2": "Black", "reason": "Dry-dropper for morning", "confidence": 0.85}');

  return lines.join('\n');
}

const MOCK_RESPONSES: Record<string, string> = {
  default: "Based on current conditions, try adjusting your depth. Fish tend to hold in different water columns throughout the day. If you're not getting strikes, go deeper or move to slower water near structure.",
  fly: "Consider switching to a smaller pattern. In clear water conditions, downsizing your fly by 2 sizes can make a big difference. Try a Zebra Midge or RS2 as a dropper.",
  deep: "Try fishing deeper runs and pools. Add split shot to get your rig down 2-3 feet. Focus on the seams where fast water meets slow water -- that's where fish like to sit and feed.",
  nothing: "Don't give up! Try changing your approach: move to a different section, switch to a completely different fly pattern, or adjust your retrieve speed. Sometimes a simple change in presentation is all it takes.",
  morning: "Early morning is prime time. Fish are often feeding near the surface in low light. Try a dry-dropper rig with a visible dry fly on top and a small nymph underneath.",
};

function getMockResponse(question: string): string {
  const q = question.toLowerCase();
  if (q.includes('fly') || q.includes('pattern') || q.includes('switch')) return MOCK_RESPONSES.fly;
  if (q.includes('deep') || q.includes('depth')) return MOCK_RESPONSES.deep;
  if (q.includes('nothing') || q.includes('not catching') || q.includes('no fish')) return MOCK_RESPONSES.nothing;
  if (q.includes('morning') || q.includes('early')) return MOCK_RESPONSES.morning;
  return MOCK_RESPONSES.default;
}

export async function askAI(context: AIContext, question: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    await new Promise(resolve => setTimeout(resolve, 800));
    return getMockResponse(question);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert fishing guide. Give concise, practical advice. Use the full trip context and conditions provided. When a "DriftGuide database" section lists catch counts by location, treat those as real aggregated logs from this app—cite them when comparing waters or times; if counts are zero or low, say data is limited.',
          },
          { role: 'user', content: buildPrompt(context, question) },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || getMockResponse(question);
  } catch {
    return getMockResponse(question);
  }
}

function getStintPrimaryPatternsWithCatches(events: TripEvent[]): { pattern: string; catches: number }[] {
  const stints: { pattern: string; catches: number }[] = [];
  for (const event of events) {
    if (event.event_type === 'fly_change') {
      const data = event.data as FlyChangeData;
      stints.push({ pattern: data.pattern, catches: 0 });
    } else if (event.event_type === 'catch' && stints.length > 0) {
      stints[stints.length - 1].catches++;
    }
  }
  return stints.filter(s => s.catches > 0).sort((a, b) => b.catches - a.catches);
}

function applyUserFlyCatalogToRecommendation(rec: NextFlyRecommendation, userFlies: Fly[] | null | undefined): NextFlyRecommendation {
  if (!userFlies || userFlies.length === 0) return rec;
  let out: NextFlyRecommendation = { ...rec };
  const match = userFlies.find(
    (f) =>
      f.name.toLowerCase() === out.pattern.toLowerCase() &&
      (f.size ?? null) === out.size &&
      (f.color ?? null) === out.color
  );
  if (match) {
    out = {
      ...out,
      pattern: match.name,
      size: match.size ?? out.size,
      color: match.color ?? out.color,
      fly_id: match.fly_id ?? undefined,
      fly_color_id: match.fly_color_id ?? undefined,
      fly_size_id: match.fly_size_id ?? undefined,
    };
  } else {
    const nameMatch = userFlies.find((f) => f.name.toLowerCase() === out.pattern.toLowerCase());
    if (nameMatch) {
      out = {
        ...out,
        pattern: nameMatch.name,
        size: nameMatch.size ?? out.size,
        color: nameMatch.color ?? out.color,
        fly_id: nameMatch.fly_id ?? undefined,
        fly_color_id: nameMatch.fly_color_id ?? undefined,
        fly_size_id: nameMatch.fly_size_id ?? undefined,
      };
    }
  }
  if (out.pattern2) {
    const match2 = userFlies.find(
      (f) =>
        f.name.toLowerCase() === (out.pattern2 || '').toLowerCase() &&
        (f.size ?? null) === (out.size2 ?? null) &&
        (f.color ?? null) === (out.color2 ?? null)
    );
    if (match2) {
      out = {
        ...out,
        pattern2: match2.name,
        size2: match2.size ?? out.size2,
        color2: match2.color ?? out.color2,
        fly_id2: match2.fly_id ?? undefined,
        fly_color_id2: match2.fly_color_id ?? undefined,
        fly_size_id2: match2.fly_size_id ?? undefined,
      };
    } else {
      const nameMatch2 = userFlies.find((f) => f.name.toLowerCase() === (out.pattern2 || '').toLowerCase());
      if (nameMatch2) {
        out = {
          ...out,
          pattern2: nameMatch2.name,
          size2: nameMatch2.size ?? out.size2,
          color2: nameMatch2.color ?? out.color2,
          fly_id2: nameMatch2.fly_id ?? undefined,
          fly_color_id2: nameMatch2.fly_color_id ?? undefined,
          fly_size_id2: nameMatch2.fly_size_id ?? undefined,
        };
      }
    }
  }
  return out;
}

/** If "try next" repeats the rig (ignoring size/color), swap using trip catch history, fly box, or generic alternates. */
function resolveTryNextIfConflictsRig(
  rec: NextFlyRecommendation,
  currentPrimaryLabel: string | null,
  currentSecondaryLabel: string | null,
  userFlies: Fly[] | null | undefined,
  recentEvents: TripEvent[] | null | undefined,
): NextFlyRecommendation {
  if (!nextFlyRecommendationConflictsCurrent(rec, currentPrimaryLabel, currentSecondaryLabel)) {
    return rec;
  }

  const exclude = new Set<string>();
  const p = normalizeFlyPatternKey(currentPrimaryLabel);
  const s = normalizeFlyPatternKey(currentSecondaryLabel);
  if (p) exclude.add(p);
  if (s) exclude.add(s);

  if (recentEvents?.length) {
    for (const { pattern } of getStintPrimaryPatternsWithCatches(recentEvents)) {
      const k = normalizeFlyPatternKey(pattern);
      if (!k || exclude.has(k)) continue;
      const next: NextFlyRecommendation = {
        pattern,
        size: rec.size,
        color: rec.color,
        reason: `${pattern} fooled fish earlier on this trip — worth switching to it.`,
        confidence: Math.min(0.88, rec.confidence + 0.05),
      };
      return applyUserFlyCatalogToRecommendation(next, userFlies ?? null);
    }
  }

  if (userFlies?.length) {
    for (const f of userFlies) {
      const k = normalizeFlyPatternKey(f.name);
      if (!k || exclude.has(k)) continue;
      const next: NextFlyRecommendation = {
        pattern: f.name,
        size: f.size ?? rec.size,
        color: f.color ?? rec.color,
        reason: `Try ${f.name} from your box — a clear change from what you have on.`,
        confidence: 0.72,
        fly_id: f.fly_id ?? undefined,
        fly_color_id: f.fly_color_id ?? undefined,
        fly_size_id: f.fly_size_id ?? undefined,
      };
      return next;
    }
  }

  const FALLBACK_ALTS: readonly { pattern: string; size: number; color: string; reason: string }[] = [
    { pattern: 'RS2', size: 22, color: 'Gray', reason: 'Different silhouette and profile — good when you need a real change.' },
    { pattern: 'Zebra Midge', size: 20, color: 'Black', reason: 'Small subsurface change-up that often draws strikes.' },
    { pattern: 'Pheasant Tail Nymph', size: 18, color: 'Natural', reason: 'Classic nymph profile as an alternative to what is on the line.' },
    { pattern: 'Copper John', size: 16, color: 'Copper', reason: 'Weight and flash — a distinct look from most dries and soft hackles.' },
  ];

  for (const alt of FALLBACK_ALTS) {
    if (exclude.has(normalizeFlyPatternKey(alt.pattern))) continue;
    return applyUserFlyCatalogToRecommendation(
      {
        pattern: alt.pattern,
        size: alt.size,
        color: alt.color,
        reason: alt.reason,
        confidence: 0.68,
      },
      userFlies ?? null,
    );
  }

  return applyUserFlyCatalogToRecommendation(
    {
      pattern: 'Soft Hackle',
      size: 16,
      color: 'Partridge',
      reason: 'Movement on the swing or a soft dead-drift can break a stale pattern.',
      confidence: 0.65,
    },
    userFlies ?? null,
  );
}

export async function getSmartFlyRecommendation(context: AIContext): Promise<NextFlyRecommendation> {
  const fallback = getFallbackRecommendation(
    context.fishingType,
    context.currentFly,
    context.weather,
    context.userFlies ?? null,
    context.currentFly2 ?? null,
  );

  if (!OPENAI_API_KEY) {
    return fallback;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are an expert fly fishing guide. Respond with ONLY valid JSON.' },
          { role: 'user', content: buildFlyRecommendationPrompt(context) },
        ],
        max_tokens: 250,
        temperature: 0.6,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return fallback;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]);
    const rec: NextFlyRecommendation = {
      pattern: parsed.pattern || fallback.pattern,
      size: Number(parsed.size) || fallback.size,
      color: parsed.color || fallback.color,
      reason: parsed.reason || fallback.reason,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.7)),
      fly_id: fallback.fly_id,
      fly_color_id: fallback.fly_color_id,
      fly_size_id: fallback.fly_size_id,
    };
    if (parsed.pattern2 != null && String(parsed.pattern2).trim()) {
      rec.pattern2 = String(parsed.pattern2).trim();
      rec.size2 = parsed.size2 != null ? Number(parsed.size2) : null;
      rec.color2 = parsed.color2 != null ? String(parsed.color2) : null;
      rec.fly_id2 = fallback.fly_id2 ?? undefined;
      rec.fly_color_id2 = fallback.fly_color_id2 ?? undefined;
      rec.fly_size_id2 = fallback.fly_size_id2 ?? undefined;
    }
    return resolveTryNextIfConflictsRig(rec, context.currentFly, context.currentFly2 ?? null, context.userFlies, context.recentEvents);
  } catch {
    return fallback;
  }
}

export function getFallbackRecommendation(
  fishingType: FishingType,
  currentFly: string | null,
  weather: WeatherData | null,
  userFlies?: Fly[] | null,
  currentFly2?: string | null,
): NextFlyRecommendation {
  const now = new Date();
  const season = getSeason(now);
  const timeOfDay = getTimeOfDay(now);

  const recommendations: Record<string, NextFlyRecommendation> = {
    'spring_early morning': { pattern: 'Blue Wing Olive', size: 18, color: 'Olive', reason: 'BWO hatches are common in spring mornings', confidence: 0.8 },
    'spring_late morning': { pattern: 'Pheasant Tail Nymph', size: 16, color: 'Natural', reason: 'Great subsurface pattern as activity picks up', confidence: 0.75 },
    'spring_afternoon': { pattern: 'Elk Hair Caddis', size: 14, color: 'Tan', reason: 'Caddis activity increases in spring afternoons', confidence: 0.7 },
    'summer_early morning': { pattern: 'Parachute Adams', size: 16, color: 'Gray', reason: 'Versatile morning dry fly', confidence: 0.75 },
    'summer_midday': { pattern: 'Copper John', size: 16, color: 'Copper', reason: 'Fish go deep midday in summer', confidence: 0.8 },
    'summer_evening': { pattern: 'Stimulator', size: 10, color: 'Yellow', reason: 'Evening stonefly and caddis activity', confidence: 0.7 },
    'fall_early morning': { pattern: 'Zebra Midge', size: 20, color: 'Black', reason: 'Fall midge hatches in the morning', confidence: 0.85 },
    'fall_afternoon': { pattern: 'San Juan Worm', size: 12, color: 'Red', reason: 'Effective fall pattern in deeper water', confidence: 0.7 },
    'winter_default': { pattern: 'Zebra Midge', size: 22, color: 'Black', reason: 'Midges are primary winter food source', confidence: 0.9 },
  };

  const key = `${season}_${timeOfDay}`;
  const seasonDefault = `${season}_default`;
  let rec = recommendations[key] || recommendations[seasonDefault] || recommendations['winter_default'];

  if (currentFly && flyPatternsMatch(rec.pattern, currentFly)) {
    rec = { pattern: 'RS2', size: 22, color: 'Gray', reason: 'Try this as an alternative to your current fly', confidence: 0.6 };
  }

  // Optional two-fly suggestion for early morning / evening
  if ((timeOfDay === 'early morning' || timeOfDay === 'evening') && season !== 'winter') {
    rec = {
      ...rec,
      pattern: rec.pattern,
      size: rec.size,
      color: rec.color,
      pattern2: 'Zebra Midge',
      size2: 20,
      color2: 'Black',
      reason: `${timeOfDay === 'early morning' ? 'Morning' : 'Evening'} dry-dropper: ${rec.pattern} on top, small midge below`,
      confidence: Math.min(0.85, rec.confidence + 0.05),
    };
  }

  rec = applyUserFlyCatalogToRecommendation(rec, userFlies);

  return resolveTryNextIfConflictsRig(rec, currentFly, currentFly2 ?? null, userFlies, null);
}

export interface SpotSuggestion {
  locationName: string;
  reason: string;
  confidence: number;
}

/** Summary for a single spot's "fishing trip" view: report, top flies, best time to fish. */
export interface SpotFishingSummary {
  report: string;
  topFlies: string[];
  /** AI-derived best time window for today, e.g. "Early morning" or "4–7 PM" */
  bestTime: string;
}

const MOCK_SPOT_SUGGESTIONS: SpotSuggestion[] = [
  { locationName: 'Provo River - Middle Section', reason: 'Consistent BWO hatches this time of year with favorable flows', confidence: 0.85 },
  { locationName: 'Green River', reason: 'Excellent midge activity and stable water temps', confidence: 0.8 },
  { locationName: 'Weber River', reason: 'Lower pressure and good nymph fishing conditions', confidence: 0.75 },
];

interface LocationWithConditions {
  name: string;
  sky?: string;
  tempF?: number;
  windMph?: number;
  windDir?: string;
  flowCfs?: number | null;
  clarity?: string;
}

function buildSpotSuggestionPrompt(
  spots: LocationWithConditions[],
  season: string,
  timeOfDay: string,
  contextDate: Date,
  forPlannedTrip: boolean,
): string {
  const locationLines = spots.map(s => {
    const parts = [`- ${s.name}:`];
    if (s.sky) parts.push(s.sky);
    if (s.tempF !== undefined) parts.push(`${s.tempF}°F`);
    if (s.windMph !== undefined) parts.push(`Wind ${s.windMph}mph${s.windDir ? ' ' + s.windDir : ''}`);
    if (s.flowCfs !== undefined && s.flowCfs !== null) parts.push(`Flow ${s.flowCfs} CFS`);
    if (s.clarity) parts.push(`Water ${s.clarity}`);
    return parts.join(', ');
  });

  const intro = forPlannedTrip
    ? 'You are an expert fishing guide in Utah. Based on the planned date, season, time of day, and forecast (or current) weather plus current water flow/clarity below, recommend the top 3 places to fish for that trip.'
    : 'You are an expert fishing guide in Utah. Based on the current season, time of day, and REAL-TIME weather/water conditions below, recommend the top 3 places to fish right now.';

  const lines = [
    intro,
    '',
    `Season: ${season}`,
    `Time of day: ${timeOfDay}`,
    `Date: ${contextDate.toLocaleDateString()}`,
    '',
    forPlannedTrip
      ? 'Available locations with conditions (weather may be forecast for the planned time; flow is current):'
      : 'Available locations with current conditions:',
    ...locationLines,
    '',
    'IMPORTANT: Strongly penalize locations with rain, thunderstorms, snow, or severe weather. Prefer locations with clear or partly cloudy skies and manageable wind. Also consider water clarity and flow — avoid blown-out or extremely high-flow spots.',
    '',
    forPlannedTrip
      ? 'Factor forecast weather and current flow heavily into your rankings and mention conditions in your reasoning.'
      : 'Factor the real-time conditions heavily into your rankings and mention weather in your reasoning.',
    '',
    'Respond with ONLY valid JSON array in this exact format, no other text:',
    '[{"locationName": "Exact Location Name", "reason": "Brief reason factoring in weather & conditions", "confidence": 0.85}]',
    '',
    'Return exactly 3 suggestions ordered by confidence (highest first).',
  ];
  return lines.join('\n');
}

export async function getTopFishingSpots(
  locations: { id: string; name: string }[],
  conditionsMap?: Map<string, import('@/src/types').LocationConditions>,
  contextDate?: Date,
): Promise<SpotSuggestion[]> {
  if (!OPENAI_API_KEY || locations.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 500));
    return MOCK_SPOT_SUGGESTIONS;
  }

  const ref = contextDate ?? new Date();
  const forPlannedTrip = contextDate != null;

  const spots: LocationWithConditions[] = locations.map(loc => {
    const c = conditionsMap?.get(loc.id);
    const omitWeather = c?.plannedTimeWeatherUnavailable;
    return {
      name: loc.name,
      sky: omitWeather ? undefined : c?.sky.condition,
      tempF: omitWeather ? undefined : c?.temperature.temp_f,
      windMph: omitWeather ? undefined : c?.wind.speed_mph,
      flowCfs: c?.water.flow_cfs,
      clarity: c ? String(c.water.clarity) : undefined,
    };
  });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are an expert Utah fishing guide. Respond with ONLY valid JSON.' },
          {
            role: 'user',
            content: buildSpotSuggestionPrompt(
              spots,
              getSeason(ref),
              getTimeOfDay(ref),
              ref,
              forPlannedTrip,
            ),
          },
        ],
        max_tokens: 400,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return MOCK_SPOT_SUGGESTIONS;

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return MOCK_SPOT_SUGGESTIONS;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return MOCK_SPOT_SUGGESTIONS;

    return parsed.slice(0, 3).map((item: Record<string, unknown>) => ({
      locationName: String(item.locationName || 'Unknown'),
      reason: String(item.reason || ''),
      confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.7)),
    }));
  } catch {
    return MOCK_SPOT_SUGGESTIONS;
  }
}

function buildSpotSummaryPrompt(
  locationName: string,
  conditionsSummary: string,
  season: string,
  timeOfDay: string,
): string {
  return [
    'You are an expert Utah fly fishing guide. For the following spot, provide a short fishing report, 6 top fly recommendations, and the best time to fish today.',
    '',
    `Location: ${locationName}`,
    `Season: ${season}, Time: ${timeOfDay}`,
    `Current conditions: ${conditionsSummary}`,
    '',
    'Respond with ONLY valid JSON in this exact format, no other text:',
    '{"report": "2-4 sentence fishing report for today.", "topFlies": ["Fly 1", "Fly 2", "Fly 3", "Fly 4", "Fly 5", "Fly 6"], "bestTime": "e.g. Early morning or 4–7 PM or Midday"}',
    'Return exactly 6 top flies. bestTime must be a short, data-driven recommendation for TODAY based on conditions (sun, temp, wind, hatches). Use a concise time window like "Early morning", "Late afternoon", "4–7 PM", "Midday–2 PM".',
  ].join('\n');
}

/** Fetch a short report and top fly list for a spot (for the spot fishing-trip view). */
export async function getSpotFishingSummary(
  locationName: string,
  conditions: import('@/src/types').LocationConditions,
): Promise<SpotFishingSummary> {
  const fallback: SpotFishingSummary = {
    report: `${locationName}: conditions are ${conditions.sky.label}, ${conditions.temperature.temp_f}°F, wind ${conditions.wind.speed_mph}mph. ${conditions.water.flow_cfs != null ? `Flow ${conditions.water.flow_cfs} CFS.` : ''} Check local regulations before you go.`,
    topFlies: ['Pheasant Tail #18', 'Parachute Adams #16', 'RS2 #20', 'BWO #18', 'Midge #20', 'Copper John #16'],
    bestTime: conditions.temperature.temp_f >= 45 && conditions.temperature.temp_f <= 75 ? 'Morning or evening' : 'Midday',
  };
  if (!OPENAI_API_KEY) return fallback;

  const parts: string[] = [
    `${conditions.sky.label}, ${conditions.temperature.temp_f}°F`,
    `Wind ${conditions.wind.speed_mph}mph`,
  ];
  if (conditions.water.flow_cfs != null) parts.push(`Flow ${conditions.water.flow_cfs} CFS`);
  parts.push(`Water ${conditions.water.clarity}`);
  const conditionsSummary = parts.join('; ');

  const now = new Date();
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are an expert Utah fly fishing guide. Respond with ONLY valid JSON.' },
          { role: 'user', content: buildSpotSummaryPrompt(locationName, conditionsSummary, getSeason(now), getTimeOfDay(now)) },
        ],
        max_tokens: 280,
        temperature: 0.6,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return fallback;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]);
    const report = typeof parsed.report === 'string' ? parsed.report : fallback.report;
    const rawFlies = Array.isArray(parsed.topFlies) ? parsed.topFlies : fallback.topFlies;
    const topFlies = rawFlies.slice(0, 6).map((f: unknown) => String(f ?? '')).filter(Boolean);
    const bestTime = typeof parsed.bestTime === 'string' && parsed.bestTime.trim()
      ? String(parsed.bestTime).trim()
      : fallback.bestTime;
    return { report, topFlies: topFlies.length ? topFlies : fallback.topFlies, bestTime };
  } catch {
    return fallback;
  }
}

function locationConditionsOneLine(c: LocationConditions): string {
  const parts: string[] = [
    `${c.sky.label}, ${c.temperature.temp_f}°F`,
    `Wind ${c.wind.speed_mph}mph`,
  ];
  if (c.water.flow_cfs != null) parts.push(`Flow ${c.water.flow_cfs} CFS`);
  parts.push(`Water ${c.water.clarity}`);
  return parts.join('; ');
}

export type RegionalHatchWaterInput = {
  name: string;
  conditions: LocationConditions;
};

export type HatchBriefRow = {
  insect: string;
  sizes: string;
  status: string;
  /** Drives status dot color: active=teal/green, starting=orange, waning=muted */
  tier: 'active' | 'starting' | 'waning' | 'other';
};

export type RegionalHatchBriefingResult = {
  rows: HatchBriefRow[];
};

function normalizeHatchTier(raw: unknown): HatchBriefRow['tier'] {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'active') return 'active';
  if (s === 'starting') return 'starting';
  if (s === 'waning') return 'waning';
  return 'other';
}

function staticHatchRows(season: string): HatchBriefRow[] {
  if (season === 'spring') {
    return [
      { insect: 'Blue-Winged Olive', sizes: '#18–20', status: 'Active', tier: 'active' },
      { insect: 'Midge', sizes: '#20–22', status: 'Starting', tier: 'starting' },
    ];
  }
  if (season === 'summer') {
    return [
      { insect: 'Pale Morning Dun', sizes: '#16–18', status: 'Active', tier: 'active' },
      { insect: 'Caddis', sizes: '#14–16', status: 'Starting', tier: 'starting' },
    ];
  }
  if (season === 'fall') {
    return [
      { insect: 'Blue-Winged Olive', sizes: '#18–20', status: 'Active', tier: 'active' },
      { insect: 'October Caddis', sizes: '#8–10', status: 'Waning', tier: 'waning' },
    ];
  }
  return [
    { insect: 'Midge', sizes: '#18–22', status: 'Active', tier: 'active' },
    { insect: 'Small BWO', sizes: '#20–22', status: 'Starting', tier: 'starting' },
  ];
}

/**
 * Single regional call: structured hatch rows for the home briefing UI.
 */
export async function getRegionalHatchBriefing(
  waters: RegionalHatchWaterInput[],
  contextDate: Date = new Date(),
): Promise<RegionalHatchBriefingResult> {
  const season = getSeason(contextDate);
  const timeOfDay = getTimeOfDay(contextDate);

  if (waters.length === 0) {
    return { rows: [] };
  }

  if (!OPENAI_API_KEY) {
    return { rows: staticHatchRows(season) };
  }

  const lines = waters.slice(0, 8).map((w) => `- ${w.name}: ${locationConditionsOneLine(w.conditions)}`);
  const userPrompt = [
    'You are an expert fly fishing guide for the Intermountain West (Utah and similar).',
    `Season: ${season}. Time of day now: ${timeOfDay}.`,
    'Waters and current conditions:',
    ...lines,
    '',
    'Respond with ONLY valid JSON in this exact format, no other text:',
    '{"rows":[{"insect":"Blue-Winged Olive","sizes":"#18-20","status":"Active","tier":"active"},{"insect":"Pale Morning Dun","sizes":"#16-18","status":"Starting","tier":"starting"}]}',
    'Provide 2 to 4 rows. insect = common hatch name (not Latin). sizes = fly sizes like #18-20. status = short label: Active, Starting, or Waning. tier must be exactly one of: active, starting, waning, other — match status (Active->active, Starting->starting, Waning->waning).',
  ].join('\n');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are an expert fly fishing guide. Respond with ONLY valid JSON.' },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 320,
        temperature: 0.55,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return { rows: staticHatchRows(season) };

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { rows: staticHatchRows(season) };

    const parsed = JSON.parse(jsonMatch[0]);
    const raw = Array.isArray(parsed.rows) ? parsed.rows : [];
    const rows: HatchBriefRow[] = [];
    for (const r of raw.slice(0, 6)) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const insect = typeof o.insect === 'string' ? o.insect.trim() : '';
      const sizes = typeof o.sizes === 'string' ? o.sizes.trim() : '';
      const status = typeof o.status === 'string' ? o.status.trim() : '';
      if (!insect) continue;
      rows.push({
        insect,
        sizes: sizes || '—',
        status: status || '—',
        tier: normalizeHatchTier(o.tier),
      });
    }
    return rows.length >= 1 ? { rows } : { rows: staticHatchRows(season) };
  } catch {
    return { rows: staticHatchRows(season) };
  }
}

function buildDetailedReportPrompt(
  locationName: string,
  conditionsSummary: string,
  season: string,
  timeOfDay: string,
): string {
  return [
    'You are an expert Utah fly fishing guide. Write a detailed fishing report for the following spot. Use 3–5 short paragraphs. Cover:',
    '1. Current conditions and what they mean for fishing (water, weather, visibility).',
    '2. Where to focus (sections, structure: pools, riffles, runs, banks) and why.',
    '3. Techniques and presentation (nymphing, dry fly, streamer, depth, drift) that match the conditions.',
    '4. Best time windows today and any seasonal notes.',
    '5. Brief safety or access reminders if relevant (e.g. flows, wading).',
    '',
    `Location: ${locationName}`,
    `Season: ${season}, Time: ${timeOfDay}`,
    `Current conditions: ${conditionsSummary}`,
    '',
    'Respond with plain text only. No JSON, no labels, no bullet points—just flowing paragraphs.',
  ].join('\n');
}

/** Fetch a longer, detailed report for a spot (for "More info" on the spot view). */
export async function getSpotDetailedReport(
  locationName: string,
  conditions: import('@/src/types').LocationConditions,
): Promise<string> {
  const fallback = `Detailed report for ${locationName}: conditions are ${conditions.sky.label}, ${conditions.temperature.temp_f}°F, wind ${conditions.wind.speed_mph}mph. Focus on familiar water and adjust technique to the conditions. Check local regulations and flow before you go.`;
  if (!OPENAI_API_KEY) return fallback;

  const parts: string[] = [
    `${conditions.sky.label}, ${conditions.temperature.temp_f}°F`,
    `Wind ${conditions.wind.speed_mph}mph`,
  ];
  if (conditions.water.flow_cfs != null) parts.push(`Flow ${conditions.water.flow_cfs} CFS`);
  parts.push(`Water ${conditions.water.clarity}`);
  const conditionsSummary = parts.join('; ');

  const now = new Date();
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are an expert Utah fly fishing guide. Write in clear, flowing paragraphs. No JSON.' },
          { role: 'user', content: buildDetailedReportPrompt(locationName, conditionsSummary, getSeason(now), getTimeOfDay(now)) },
        ],
        max_tokens: 650,
        temperature: 0.6,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    return content && content.length > 0 ? content : fallback;
  } catch {
    return fallback;
  }
}

function buildHowToFishPrompt(
  locationName: string,
  conditionsSummary: string,
  season: string,
  timeOfDay: string,
): string {
  return [
    'You are an expert Utah fly fishing guide. In 2–4 short sentences, describe how to fish this spot right now.',
    'Cover: typical depth (e.g. 4–8 ft under indicator, tight to the bank), technique (e.g. indicator nymphing, euro, dry, streamer), and any presentation tip (e.g. slow drift, strip pause).',
    'Be specific and actionable. No JSON, no labels—just a short paragraph.',
    '',
    `Location: ${locationName}`,
    `Season: ${season}, Time: ${timeOfDay}`,
    `Current conditions: ${conditionsSummary}`,
    '',
    'Respond with plain text only.',
  ].join('\n');
}

function buildGuideGreetingPrompt(
  locationName: string,
  conditionsSummary: string,
  season: string,
  timeOfDay: string,
): string {
  return [
    'You are a friendly, expert fishing guide. Write a single short opening message (3–5 sentences) as if you are greeting the angler for the first time today.',
    'Include: (1) A brief greeting like "Hey, I\'m your fishing guide today!" (2) For this location, the best time to fish right now. (3) The top flies to have. (4) A clear recommendation: which one fly to start with and how to fish it (e.g. depth, indicator, technique).',
    'Sound conversational and helpful. No bullet points, no JSON—one flowing paragraph.',
    '',
    `Location: ${locationName}`,
    `Season: ${season}, Time: ${timeOfDay}`,
    `Current conditions: ${conditionsSummary}`,
    '',
    'Respond with plain text only.',
  ].join('\n');
}

/** Single greeting from the AI Guide: best time, top flies, and recommend one fly + how to fish. Shown as the first "message" in the Guide tab. */
export async function getGuideGreeting(
  locationName: string,
  conditions: import('@/src/types').LocationConditions,
): Promise<string> {
  const fallback = `Hey, I'm your fishing guide today! For ${locationName}, the best time to fish is morning or evening. Top flies: Pheasant Tail #18, Parachute Adams #16, RS2 #20. I'd recommend starting with a Pheasant Tail under an indicator, 4–6 feet deep, and fishing slow drifts in the seams.`;
  if (!OPENAI_API_KEY) return fallback;

  const parts: string[] = [
    `${conditions.sky.label}, ${conditions.temperature.temp_f}°F`,
    `Wind ${conditions.wind.speed_mph}mph`,
  ];
  if (conditions.water.flow_cfs != null) parts.push(`Flow ${conditions.water.flow_cfs} CFS`);
  parts.push(`Water ${conditions.water.clarity}`);
  const conditionsSummary = parts.join('; ');

  const now = new Date();
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are a friendly Utah fly fishing guide. Write one short, conversational paragraph. No JSON.' },
          { role: 'user', content: buildGuideGreetingPrompt(locationName, conditionsSummary, getSeason(now), getTimeOfDay(now)) },
        ],
        max_tokens: 280,
        temperature: 0.6,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    return content && content.length > 0 ? content : fallback;
  } catch {
    return fallback;
  }
}

/** Fetch "how to fish it" paragraph (depth, indicator, technique) for Strategy tab. */
export async function getSpotHowToFish(
  locationName: string,
  conditions: import('@/src/types').LocationConditions,
): Promise<string> {
  const fallback = `At ${locationName}, match depth and technique to the flow and clarity. Indicator nymphing is often effective; adjust weight and depth as conditions change.`;
  if (!OPENAI_API_KEY) return fallback;

  const parts: string[] = [
    `${conditions.sky.label}, ${conditions.temperature.temp_f}°F`,
    `Wind ${conditions.wind.speed_mph}mph`,
  ];
  if (conditions.water.flow_cfs != null) parts.push(`Flow ${conditions.water.flow_cfs} CFS`);
  parts.push(`Water ${conditions.water.clarity}`);
  const conditionsSummary = parts.join('; ');

  const now = new Date();
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are an expert Utah fly fishing guide. Write a short, actionable paragraph. No JSON.' },
          { role: 'user', content: buildHowToFishPrompt(locationName, conditionsSummary, getSeason(now), getTimeOfDay(now)) },
        ],
        max_tokens: 200,
        temperature: 0.6,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    return content && content.length > 0 ? content : fallback;
  } catch {
    return fallback;
  }
}

/** Options for fly-of-the-day (home screen when no active trip). */
export interface FlyOfTheDayOptions {
  locationName?: string;
  /** One-line summary of current conditions (temp, flow, clarity, etc.) */
  conditionsSummary?: string;
  /** From getLocationSuccessSummary e.g. "Recent success: Pheasant Tail #18; 12 fish in last 7 days" */
  locationSuccessSummary?: string;
  userFlies?: Fly[] | null;
}

/** Get a single "fly of the day" recommendation for the home screen using location, conditions, and local success. Uses gpt-4o-mini. */
export async function getFlyOfTheDay(
  userId: string,
  options?: FlyOfTheDayOptions,
): Promise<NextFlyRecommendation> {
  const fallback = getFallbackRecommendation('fly', null, null, options?.userFlies ?? null);
  if (!OPENAI_API_KEY) {
    return fallback;
  }

  const now = new Date();
  const season = getSeason(now);
  const timeOfDay = getTimeOfDay(now);

  const lines = [
    'You are an expert fly fishing guide. Recommend the single best "fly of the day" for right now.',
    '',
    `Season: ${season}`,
    `Time of day: ${timeOfDay}`,
    `Date: ${now.toLocaleDateString()}`,
  ];
  if (options?.locationName) {
    lines.push(`Location: ${options.locationName}`);
  }
  if (options?.conditionsSummary) {
    lines.push(`Current conditions: ${options.conditionsSummary}`);
  }
  if (options?.locationSuccessSummary) {
    lines.push(`Local success: ${options.locationSuccessSummary}`);
  }
  if (options?.userFlies && options.userFlies.length > 0) {
    lines.push('', "Angler's fly box (ONLY recommend from this list):");
    options.userFlies.forEach(f => {
      lines.push(`- ${f.name}${f.size ? ` #${f.size}` : ''}${f.color ? ` (${f.color})` : ''}`);
    });
  }
  lines.push('', 'Respond with ONLY valid JSON: {"pattern": "Name", "size": 18, "color": "Color", "reason": "Brief reason", "confidence": 0.8}');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are an expert fly fishing guide. Respond with ONLY valid JSON.' },
          { role: 'user', content: lines.join('\n') },
        ],
        max_tokens: 150,
        temperature: 0.6,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return fallback;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      pattern: parsed.pattern || fallback.pattern,
      size: Number(parsed.size) || fallback.size,
      color: parsed.color || fallback.color,
      reason: parsed.reason || fallback.reason,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.7)),
    };
  } catch {
    return fallback;
  }
}
