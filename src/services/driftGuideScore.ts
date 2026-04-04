import type { LocationConditions } from '@/src/types';
import { getDriftGuideScore } from '@/src/services/conditions';
import { internalPillarEffective, internalSampleConfidenceN } from '@/src/utils/internalCatchScaling';

export type ExternalSignalInput = {
  /** 0-1 from Edge when grounded; null if missing/stale */
  fishingQualitySignal: number | null;
  /** ISO; if older than maxAgeDays, external treated as null */
  fetchedAt?: string | null;
};

const EXTERNAL_STALE_DAYS = 5;

function conditionsToNormalizedC(conditions: LocationConditions): number {
  const { stars } = getDriftGuideScore(conditions);
  return Math.max(0, Math.min(1, stars / 5));
}

function isExternalStale(fetchedAt?: string | null): boolean {
  if (!fetchedAt) return false;
  const t = new Date(fetchedAt).getTime();
  if (Number.isNaN(t)) return true;
  const ageMs = Date.now() - t;
  return ageMs > EXTERNAL_STALE_DAYS * 24 * 60 * 60 * 1000;
}

export type CompositeScoreResult = {
  stars: number;
  /** Sub-scores 0-1 for UI breakdown */
  conditionsNorm: number;
  internalRaw: number | null;
  internalEffective: number | null;
  externalNorm: number | null;
  communityN: number;
  labels: { conditions: string; internal: string; external: string };
};

/**
 * Composite 0-5 stars: conditions + internal (volume/recency as iRaw) + external signal.
 * Unknown pillars excluded and weights renormalized.
 */
export function computeDriftGuideCompositeScore(params: {
  conditions: LocationConditions;
  /** 0-1 from log activity heuristic; null if no logs */
  internalRaw: number | null;
  communityFishN: number;
  external: ExternalSignalInput | null;
}): CompositeScoreResult {
  const c = conditionsToNormalizedC(params.conditions);
  const n = Math.max(0, Math.floor(params.communityFishN));
  const iRaw = params.internalRaw;
  const s = internalSampleConfidenceN(n);
  const iEff = iRaw != null && s != null ? internalPillarEffective(iRaw, n) : null;

  let eVal: number | null = null;
  if (params.external?.fishingQualitySignal != null && Number.isFinite(params.external.fishingQualitySignal)) {
    if (!isExternalStale(params.external.fetchedAt)) {
      eVal = Math.max(0, Math.min(1, params.external.fishingQualitySignal));
    }
  }

  let wc = 0.45;
  let wi = 0.3;
  let we = 0.25;

  const hasI = iEff != null && s != null && iRaw != null;
  const hasE = eVal != null;

  if (!hasI && !hasE) {
    wc = 1;
    wi = 0;
    we = 0;
  } else if (!hasI && hasE) {
    wc = 0.55;
    wi = 0;
    we = 0.45;
  } else if (hasI && !hasE) {
    wc = 0.55;
    wi = 0.45;
    we = 0;
  }

  const iForBlend = hasI ? iEff! : 0;
  const eForBlend = hasE ? eVal! : 0;
  const blended = wc * c + wi * iForBlend + we * eForBlend;
  const stars = Math.max(0, Math.min(5, Math.round(blended * 5 * 10) / 10));

  return {
    stars: stars < 0.1 ? 0.5 : stars,
    conditionsNorm: c,
    internalRaw: iRaw,
    internalEffective: hasI ? iEff! : null,
    externalNorm: eVal,
    communityN: n,
    labels: {
      conditions: 'Conditions',
      internal: hasI ? `Community logs (N=${n})` : 'Community logs',
      external: hasE ? 'Reports & gauges' : 'Reports',
    },
  };
}

/** Map community total + in-window bucket share to a rough 0-1 internal raw score. */
export function internalRawFromCounts(totalFish: number, inBucket: number): number | null {
  if (totalFish <= 0) return null;
  const ratio = inBucket / Math.max(1, totalFish);
  const volumeBoost = Math.min(1, Math.log1p(totalFish) / Math.log1p(50));
  const timeBoost = 0.4 + 0.6 * Math.min(1, ratio * 2);
  return Math.max(0, Math.min(1, volumeBoost * timeBoost));
}
