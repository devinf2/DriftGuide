import { OFFLINE_FISHING_GUIDE_SUPPLEMENT } from '@/src/content/offlineFishingGuideLongForm';
import {
  buildActivityPaceForOffline,
  buildRigAndSavedDataParagraph,
  buildTopThreeUnifiedFliesParagraph,
  type GuideOfflinePackAggregates,
} from '@/src/services/offlineGuideLocalIntel';
import { CLARITY_LABELS } from '@/src/services/waterFlow';
import { fliesForSeason, waterBodyHint } from '@/src/utils/offlineGuideBasics';
import { questionWantsLocationRecommendation } from '@/src/utils/guideChatIntent';
import type { FishingType, Fly, FlyChangeData, Location, TripEvent, WaterFlowData, WeatherData } from '@/src/types';

/** Fields read by `buildOfflineGuideSections` (trip/spot pass full `AIContext`, which is structurally compatible). */
export type OfflineGuideSectionContext = {
  location: Location | null;
  fishingType: FishingType;
  weather: WeatherData | null;
  waterFlow: WaterFlowData | null;
  currentFly: string | null;
  currentFly2?: string | null;
  fishCount: number;
  recentEvents: TripEvent[];
  timeOfDay: string;
  season: string;
  userFlies?: Fly[] | null;
  guideLinkedSpots?: { id: string; name: string }[];
  guideLocationAmbiguous?: { extractedPhrase: string; candidates: { id: string; name: string }[] }[];
  guideOfflinePackAggregates?: GuideOfflinePackAggregates | null;
};

export type OfflineGuideSections = {
  currentSetup: string;
  bestTimes: string;
  fliesHowExtras: string;
  supplementText: string;
  fullReplyBeforeNormalize: string;
};

function questionSoundsFlyRelated(q: string): boolean {
  return (
    /\b(fly|flies|pattern|lure|bait|nymph|dry|streamer|midge|caddis|hopper|dropper|rig)\b/i.test(q) ||
    /\bwhat (should|to) (use|try|tie)\b/i.test(q) ||
    /\b(recommend|suggest)\b.*\b(fly|pattern)\b/i.test(q)
  );
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

export function buildOfflineGuideSections(
  context: OfflineGuideSectionContext,
  question: string,
): OfflineGuideSections {
  const q = question.trim();
  const ql = q.toLowerCase();
  const ordered: string[] = [];
  const setup: string[] = [];
  const times: string[] = [];
  const flies: string[] = [];

  const pushSetup = (text: string) => {
    ordered.push(text);
    setup.push(text);
  };
  const pushTimes = (text: string) => {
    ordered.push(text);
    times.push(text);
  };
  const pushFlies = (text: string) => {
    ordered.push(text);
    flies.push(text);
  };

  const intro =
    '**Offline guide** — using only data on this device (trip, saved catalog, cached conditions). Reconnect for live AI and fresh weather/flows.';
  pushSetup(intro);

  const agg = context.guideOfflinePackAggregates ?? null;
  const rigBlock = buildRigAndSavedDataParagraph(
    context.currentFly ?? null,
    context.currentFly2 ?? null,
    agg,
    context.weather
      ? { condition: context.weather.condition, temperature_f: context.weather.temperature_f }
      : null,
  );
  if (rigBlock) pushSetup(rigBlock);

  const topThree = buildTopThreeUnifiedFliesParagraph(agg);
  if (topThree) pushFlies(topThree);

  if (context.guideLocationAmbiguous?.length) {
    for (const amb of context.guideLocationAmbiguous) {
      const opts = amb.candidates.map((c) => `<<spot:${c.id}:${c.name}>>`).join(', ');
      pushSetup(`That could mean a few waters. Tap the one you mean: ${opts}.`);
    }
  }

  const wantPlace = questionWantsLocationRecommendation(q);
  const wantsFly = questionSoundsFlyRelated(ql);

  const linked: { id: string; name: string }[] = [...(context.guideLinkedSpots ?? [])];
  if (context.location?.id && context.location.name?.trim()) {
    const name = context.location.name.trim();
    if (!linked.some((s) => s.id === context.location!.id)) {
      linked.unshift({ id: context.location.id, name });
    }
  }

  const hasAmbiguity = Boolean(context.guideLocationAmbiguous?.length);
  if (wantPlace && linked.length > 0 && !hasAmbiguity) {
    const tagged = linked
      .slice(0, 4)
      .map((s) => `<<spot:${s.id}:${s.name}>>`)
      .join(', ');
    pushSetup(`From your offline catalog and this screen, good options to open or compare: ${tagged}.`);
  } else if (wantPlace && linked.length === 0 && !hasAmbiguity) {
    pushSetup(
      'For where to fish offline, open a saved trip or spot first so I can tie picks to a specific water in your download.',
    );
  }

  if (context.location?.type) {
    pushSetup(waterBodyHint(context.location.type));
  }

  const activity = buildActivityPaceForOffline(context.timeOfDay, agg?.bucketWeights ?? {});
  pushTimes(activity);

  const hasDataDrivenFlyHint =
    Boolean(rigBlock) || Boolean(topThree) || Boolean(agg?.topFlies?.length);
  if (wantsFly || (!wantPlace && ql.length > 0)) {
    if (!hasDataDrivenFlyHint) {
      const seasonFlies = fliesForSeason(context.season);
      pushFlies(`Common ${context.season} patterns to try: ${seasonFlies.slice(0, 5).join(', ')}.`);
    }
    if (context.currentFly) {
      pushSetup(
        context.currentFly2
          ? `On the water you're fishing ${context.currentFly} / ${context.currentFly2}. If it's gone quiet, change depth or try a contrasting size or color from the list.`
          : `You're on ${context.currentFly}. If it's slow, vary depth or switch to another pattern from the list.`,
      );
    }
  }

  if (context.weather) {
    const w = context.weather;
    pushTimes(
      `Cached weather: ${w.temperature_f}°F, ${w.condition}. Wind ${w.wind_speed_mph} mph ${w.wind_direction}.`,
    );
    if (typeof w.barometric_pressure === 'number' && Number.isFinite(w.barometric_pressure)) {
      pushTimes(
        `**Barometric pressure** (cached snapshot): **${w.barometric_pressure}** — compare across days when you’re back online; fish can respond to steady vs. moving pressure.`,
      );
    }
  }
  if (context.waterFlow) {
    pushSetup(
      `Cached flows: ${context.waterFlow.flow_cfs} CFS; clarity ${CLARITY_LABELS[context.waterFlow.clarity]}.`,
    );
  }

  if (context.recentEvents.length > 0 && (wantsFly || /\b(trip|caught|catch|working)\b/i.test(ql))) {
    const tripLine = buildTripSummary(context.recentEvents).replace(/\n/g, ' ');
    pushFlies(`This trip: ${tripLine}`);
  }

  const joinBlock = (a: string[]) => (a.length ? a.join('\n\n') : '');

  return {
    currentSetup: joinBlock(setup),
    bestTimes: joinBlock(times),
    fliesHowExtras: joinBlock(flies),
    supplementText: OFFLINE_FISHING_GUIDE_SUPPLEMENT,
    fullReplyBeforeNormalize: ordered.join('\n\n'),
  };
}
