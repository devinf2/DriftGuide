import { TripEvent, WeatherData, WaterFlowData, Location, FishingType, FlyChangeData, CatchData, NextFlyRecommendation, Fly } from '@/src/types';
import { CLARITY_LABELS, CLARITY_DESCRIPTIONS } from '@/src/services/waterFlow';

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
}

function getSeason(date: Date): string {
  const month = date.getMonth();
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}

function getTimeOfDay(date: Date): string {
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
          { role: 'system', content: 'You are an expert fishing guide. Give concise, practical advice. Use the full trip context and conditions provided to tailor your response.' },
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

export async function getSmartFlyRecommendation(context: AIContext): Promise<NextFlyRecommendation> {
  const fallback = getFallbackRecommendation(
    context.fishingType,
    context.currentFly,
    context.weather,
    context.userFlies ?? null,
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
    return rec;
  } catch {
    return fallback;
  }
}

export function getFallbackRecommendation(
  fishingType: FishingType,
  currentFly: string | null,
  weather: WeatherData | null,
  userFlies?: Fly[] | null,
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

  if (currentFly && rec.pattern.toLowerCase() === currentFly.toLowerCase()) {
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

  if (userFlies && userFlies.length > 0) {
    const match = userFlies.find(
      (f) =>
        f.name.toLowerCase() === rec.pattern.toLowerCase() &&
        (f.size ?? null) === rec.size &&
        (f.color ?? null) === rec.color
    );
    if (match) {
      rec = {
        ...rec,
        pattern: match.name,
        size: match.size ?? rec.size,
        color: match.color ?? rec.color,
        fly_id: match.fly_id ?? undefined,
        fly_color_id: match.fly_color_id ?? undefined,
        fly_size_id: match.fly_size_id ?? undefined,
      };
    } else {
      const nameMatch = userFlies.find((f) => f.name.toLowerCase() === rec.pattern.toLowerCase());
      if (nameMatch) {
        rec = {
          ...rec,
          pattern: nameMatch.name,
          size: nameMatch.size ?? rec.size,
          color: nameMatch.color ?? rec.color,
          fly_id: nameMatch.fly_id ?? undefined,
          fly_color_id: nameMatch.fly_color_id ?? undefined,
          fly_size_id: nameMatch.fly_size_id ?? undefined,
        };
      }
    }
    if (rec.pattern2) {
      const match2 = userFlies.find(
        (f) =>
          f.name.toLowerCase() === (rec.pattern2 || '').toLowerCase() &&
          (f.size ?? null) === (rec.size2 ?? null) &&
          (f.color ?? null) === (rec.color2 ?? null)
      );
      if (match2) {
        rec = {
          ...rec,
          pattern2: match2.name,
          size2: match2.size ?? rec.size2,
          color2: match2.color ?? rec.color2,
          fly_id2: match2.fly_id ?? undefined,
          fly_color_id2: match2.fly_color_id ?? undefined,
          fly_size_id2: match2.fly_size_id ?? undefined,
        };
      } else {
        const nameMatch2 = userFlies.find((f) => f.name.toLowerCase() === (rec.pattern2 || '').toLowerCase());
        if (nameMatch2) {
          rec = {
            ...rec,
            pattern2: nameMatch2.name,
            size2: nameMatch2.size ?? rec.size2,
            color2: nameMatch2.color ?? rec.color2,
            fly_id2: nameMatch2.fly_id ?? undefined,
            fly_color_id2: nameMatch2.fly_color_id ?? undefined,
            fly_size_id2: nameMatch2.fly_size_id ?? undefined,
          };
        }
      }
    }
  }

  return rec;
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

  const lines = [
    'You are an expert fishing guide in Utah. Based on the current season, time of day, and REAL-TIME weather/water conditions below, recommend the top 3 places to fish right now.',
    '',
    `Season: ${season}`,
    `Time of day: ${timeOfDay}`,
    `Date: ${new Date().toLocaleDateString()}`,
    '',
    'Available locations with current conditions:',
    ...locationLines,
    '',
    'IMPORTANT: Strongly penalize locations with rain, thunderstorms, snow, or severe weather. Prefer locations with clear or partly cloudy skies and manageable wind. Also consider water clarity and flow — avoid blown-out or extremely high-flow spots.',
    '',
    'Factor the real-time conditions heavily into your rankings and mention weather in your reasoning.',
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
): Promise<SpotSuggestion[]> {
  if (!OPENAI_API_KEY || locations.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 500));
    return MOCK_SPOT_SUGGESTIONS;
  }

  const spots: LocationWithConditions[] = locations.map(loc => {
    const c = conditionsMap?.get(loc.id);
    return {
      name: loc.name,
      sky: c?.sky.condition,
      tempF: c?.temperature.temp_f,
      windMph: c?.wind.speed_mph,
      flowCfs: c?.water.flow_cfs,
      clarity: c ? String(c.water.clarity) : undefined,
    };
  });

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
          { role: 'system', content: 'You are an expert Utah fishing guide. Respond with ONLY valid JSON.' },
          { role: 'user', content: buildSpotSuggestionPrompt(spots, getSeason(now), getTimeOfDay(now)) },
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

export { getSeason, getTimeOfDay };
