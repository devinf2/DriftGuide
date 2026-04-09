import { edgeFunctionInvokeHeaders, supabase } from '@/src/services/supabase';
import type {
  GuideIntelChatResultBody,
  GuideIntelRequestBody,
  GuideIntelSource,
  GuideIntelSpotSummaryResult,
  GuideLocationRecommendation,
} from '@/src/services/guideIntelContract';
import {
  parseGuideLocationRecommendationJson,
  parseGuideLocationRecommendationUnknown,
  stripDriftguideLocationFence,
} from '@/src/utils/guideLocationRecommendationJson';
import { FunctionsHttpError } from '@supabase/functions-js';
import NetInfo from '@react-native-community/netinfo';
import { effectiveIsAppOnline } from '@/src/utils/netReachability';

const DISABLE_EDGE = process.env.EXPO_PUBLIC_USE_GUIDE_INTEL_EDGE === '0';

export async function isOnlineForGuideIntel(): Promise<boolean> {
  try {
    const s = await NetInfo.fetch();
    // Only skip when the OS explicitly says we're offline. `isInternetReachable === false`
    // is often wrong on iOS Simulator / some Wi‑Fi setups while other requests still work.
    if (s.isConnected === false) return effectiveIsAppOnline(false);
    if (s.isInternetReachable === false) return effectiveIsAppOnline(false);
    return effectiveIsAppOnline(true);
  } catch {
    return effectiveIsAppOnline(true);
  }
}

export async function invokeGuideIntel(body: GuideIntelRequestBody): Promise<unknown | null> {
  if (DISABLE_EDGE) return null;
  if (!(await isOnlineForGuideIntel())) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return null;

  try {
    // React Native + supabase-js often does not forward the session JWT to Edge Functions unless
    // Authorization is set explicitly (see authStore softDeleteAccount → delete-closed-auth-user).
    const { data, error } = await supabase.functions.invoke('guide-intel', {
      body,
      headers: edgeFunctionInvokeHeaders(accessToken),
    });
    if (error) {
      let detail = error.message;
      if (error instanceof FunctionsHttpError && error.context) {
        const status = error.context.status;
        try {
          const j = (await error.context.clone().json()) as { error?: string; code?: string };
          if (typeof j?.error === 'string') detail = `${detail}: ${j.error}`;
          if (typeof j?.code === 'string') detail = `${detail} (${j.code})`;
        } catch {
          /* ignore */
        }
        if (status) detail = `${detail} [HTTP ${status}]`;
      }
      console.warn('[guide-intel]', detail);
      return null;
    }
    return data ?? null;
  } catch (e) {
    console.warn('[guide-intel]', e);
    return null;
  }
}

/** Parsed `{ mentions: [{ name, type? }] }` from `extract_locations` Edge action. */
export function parseExtractLocationsResponse(data: unknown): { name: string; type?: string | null }[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.mentions)) return [];
  const out: { name: string; type?: string | null }[] = [];
  for (const m of d.mentions.slice(0, 16)) {
    if (!m || typeof m !== 'object') continue;
    const o = m as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (name.length < 2) continue;
    out.push({
      name,
      type: typeof o.type === 'string' ? o.type : null,
    });
  }
  return out;
}

/** Normalized `guide-intel` `chat` success body (Edge may omit `sources`). */
export function parseGuideIntelChatResponse(data: unknown): GuideIntelChatResultBody | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const rawText = typeof d.text === 'string' ? d.text.trim() : '';
  if (!rawText) return null;
  const fetchedAt = typeof d.fetchedAt === 'string' ? d.fetchedAt : undefined;
  let sources: GuideIntelSource[] | undefined;
  if (Array.isArray(d.sources)) {
    const out: GuideIntelSource[] = [];
    const now = new Date().toISOString();
    for (const s of d.sources.slice(0, 16)) {
      if (!s || typeof s !== 'object') continue;
      const o = s as Record<string, unknown>;
      const url = typeof o.url === 'string' ? o.url.trim() : '';
      if (!url) continue;
      out.push({
        url,
        title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : url,
        fetchedAt: typeof o.fetchedAt === 'string' ? o.fetchedAt : fetchedAt ?? now,
        excerpt: typeof o.excerpt === 'string' ? o.excerpt : '',
      });
    }
    if (out.length > 0) sources = out;
  }

  const { text: prose, fenceBody } = stripDriftguideLocationFence(rawText);
  let text = prose;

  let locationRecommendation: GuideLocationRecommendation | null | undefined;
  if (d.locationRecommendation != null && typeof d.locationRecommendation === 'object') {
    locationRecommendation = parseGuideLocationRecommendationUnknown(d.locationRecommendation);
  }
  if (locationRecommendation == null && fenceBody) {
    locationRecommendation = parseGuideLocationRecommendationJson(fenceBody);
  }

  if (!text.trim() && locationRecommendation?.summary) {
    text = locationRecommendation.summary;
  }
  if (!text.trim()) return null;

  return {
    text,
    sources,
    fetchedAt,
    ...(locationRecommendation ? { locationRecommendation } : {}),
  };
}

export function parseSpotSummaryEdgeResponse(data: unknown): GuideIntelSpotSummaryResult | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const raw = typeof d.raw === 'string' ? d.raw : null;
  const fetchedAt = typeof d.fetchedAt === 'string' ? d.fetchedAt : new Date().toISOString();
  if (!raw) return null;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const report = typeof parsed.report === 'string' ? parsed.report : '';
    const topFlies = Array.isArray(parsed.topFlies)
      ? parsed.topFlies.slice(0, 8).map((x) => String(x ?? '')).filter(Boolean)
      : [];
    const bestTime = typeof parsed.bestTime === 'string' ? parsed.bestTime : '';
    let fishingQualitySignal: number | null = null;
    if (parsed.fishingQualitySignal != null && Number.isFinite(Number(parsed.fishingQualitySignal))) {
      fishingQualitySignal = Math.max(0, Math.min(1, Number(parsed.fishingQualitySignal)));
    }
    const sources: GuideIntelSource[] = [];
    if (Array.isArray(parsed.sources)) {
      for (const s of parsed.sources.slice(0, 8)) {
        if (!s || typeof s !== 'object') continue;
        const o = s as Record<string, unknown>;
        const url = typeof o.url === 'string' ? o.url : '';
        const title = typeof o.title === 'string' ? o.title : '';
        if (!url && !title) continue;
        sources.push({
          url: url || 'https://www.weather.gov/',
          title: title || 'Source',
          fetchedAt: typeof o.fetchedAt === 'string' ? o.fetchedAt : fetchedAt,
          excerpt: typeof o.excerpt === 'string' ? o.excerpt : '',
        });
      }
    }
    if (!report || topFlies.length === 0) return null;
    return {
      report,
      topFlies,
      bestTime: bestTime || 'Morning or evening',
      sources,
      fishingQualitySignal,
      fetchedAt,
    };
  } catch {
    return null;
  }
}
