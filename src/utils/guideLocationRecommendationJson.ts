/**
 * Optional structured block appended to guide chat when recommending or comparing catalog waters.
 * Model emits a fenced ```driftguide-location ... ``` block; Edge/client strip it from visible prose.
 */

import type { GuideLocationRecommendation } from '@/src/services/guideIntelContract';

const FENCE_RE = /```\s*driftguide-location\s*([\s\S]*?)```/i;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function stripDriftguideLocationFence(raw: string): { text: string; fenceBody: string | null } {
  const m = raw.match(FENCE_RE);
  if (!m) return { text: raw.trim(), fenceBody: null };
  return { text: raw.replace(FENCE_RE, '').trim(), fenceBody: m[1].trim() };
}

function asStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, max)
    .map((x) => String(x ?? '').trim())
    .filter((s) => s.length > 0);
}

/** Parse and validate a decoded JSON object; returns null if type is none or invalid. */
export function parseGuideLocationRecommendationUnknown(parsed: unknown): GuideLocationRecommendation | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  const type = typeof o.type === 'string' ? o.type.trim() : '';
  if (type === 'none') return null;
  if (type !== 'location_recommendation') return null;
  const summary = typeof o.summary === 'string' ? o.summary.trim() : '';
  if (!summary) return null;
  if (!Array.isArray(o.locations) || o.locations.length === 0) return null;

  const locations: GuideLocationRecommendation['locations'] = [];
  for (const item of o.locations.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const location_id = typeof row.location_id === 'string' ? row.location_id.trim() : '';
    const reason = typeof row.reason === 'string' ? row.reason.trim() : '';
    if (!name || !location_id || !reason) continue;
    if (!UUID_RE.test(location_id)) continue;
    let confidence = Number(row.confidence);
    if (!Number.isFinite(confidence)) confidence = 5;
    confidence = Math.max(0, Math.min(10, confidence));
    locations.push({
      name,
      location_id,
      reason,
      top_flies: asStringArray(row.top_flies, 6),
      confidence,
    });
  }
  if (locations.length === 0) return null;
  return { type: 'location_recommendation', locations, summary };
}

/** Parse and validate model JSON string; returns null if type is none or invalid. */
export function parseGuideLocationRecommendationJson(body: string): GuideLocationRecommendation | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  return parseGuideLocationRecommendationUnknown(parsed);
}

export function extractLocationRecommendationFromModelText(
  raw: string,
): { text: string; locationRecommendation: GuideLocationRecommendation | null } {
  const { text, fenceBody } = stripDriftguideLocationFence(raw);
  if (!fenceBody) return { text, locationRecommendation: null };
  return { text, locationRecommendation: parseGuideLocationRecommendationJson(fenceBody) };
}
