import type { Location } from '@/src/types';

export type ExtractedLocationMention = {
  name: string;
  type?: string | null;
};

export type MentionResolution =
  | { kind: 'resolved'; mention: string; location: Location; score: number }
  | { kind: 'ambiguous'; mention: string; candidates: { location: Location; score: number }[] }
  | { kind: 'unresolved'; mention: string };

/** Below this, do not auto-link to catalog (avoid wrong water). */
const MIN_RESOLVE_SCORE = 480;
/** If #1 and #2 are closer than this, treat as ambiguous. */
const AMBIGUOUS_GAP = 95;
const MAX_AMBIGUOUS_CANDIDATES = 4;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const rows = b.length + 1;
  const cols = a.length + 1;
  const matrix = new Array<number>(rows * cols);
  for (let i = 0; i < rows; i++) matrix[i * cols] = i;
  for (let j = 0; j < cols; j++) matrix[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      const del = matrix[(i - 1) * cols + j] + 1;
      const ins = matrix[i * cols + (j - 1)] + 1;
      const sub = matrix[(i - 1) * cols + (j - 1)] + cost;
      matrix[i * cols + j] = Math.min(del, ins, sub);
    }
  }
  return matrix[(rows - 1) * cols + (cols - 1)];
}

/** Score 0–1000: higher = stronger match between user phrase and catalog row. */
export function scoreMentionAgainstLocation(mention: string, loc: Location): number {
  const m = normalize(mention);
  const n = normalize(loc.name);
  if (!m || !n) return 0;
  if (n === m) return 1000;
  if (n.includes(m) || m.includes(n)) return 930;

  const meta = loc.metadata as Record<string, unknown> | null | undefined;
  const aliases = meta?.aliases;
  if (Array.isArray(aliases)) {
    for (const a of aliases) {
      const an = normalize(String(a ?? ''));
      if (!an) continue;
      if (an === m || an.includes(m) || m.includes(an)) return 920;
    }
  }

  const wordsM = m.split(/\s+/).filter((w) => w.length >= 2);
  const wordsN = n.split(/[\s,/]+/).filter(Boolean);
  let best = 0;
  for (const wm of wordsM) {
    if (wm.length < 3) continue;
    for (const wn of wordsN) {
      if (wn.length < 3) continue;
      if (wn.includes(wm) || wm.includes(wn)) best = Math.max(best, 880);
      if (wm.length <= 8 && wn.length <= 14) {
        const d = levenshtein(wm, wn);
        if (d <= 2) best = Math.max(best, 820 - d * 35);
      }
    }
  }

  if (m.length <= 24) {
    const d = levenshtein(m, n);
    const maxLen = Math.max(m.length, n.length);
    if (maxLen > 0 && d <= Math.ceil(maxLen * 0.38)) {
      best = Math.max(best, Math.round(720 * (1 - d / maxLen)));
    }
  }

  return best;
}

/**
 * Map LLM-extracted place strings to catalog `Location` rows (fuzzy).
 * Low confidence → ambiguous (ask user); no match → unresolved (never invent).
 */
export function resolveExtractedMentionsToCatalog(
  mentions: ExtractedLocationMention[],
  catalog: Location[],
): MentionResolution[] {
  if (catalog.length === 0 || mentions.length === 0) return [];

  const seen = new Set<string>();
  const out: MentionResolution[] = [];

  for (const row of mentions) {
    const raw = row.name?.trim();
    if (!raw || raw.length < 2) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const scored = catalog
      .map((loc) => ({ location: loc, score: scoreMentionAgainstLocation(raw, loc) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];

    if (!best || best.score < MIN_RESOLVE_SCORE) {
      out.push({ kind: 'unresolved', mention: raw });
      continue;
    }

    if (second && best.score - second.score < AMBIGUOUS_GAP) {
      out.push({
        kind: 'ambiguous',
        mention: raw,
        candidates: scored.slice(0, MAX_AMBIGUOUS_CANDIDATES),
      });
      continue;
    }

    out.push({
      kind: 'resolved',
      mention: raw,
      location: best.location,
      score: best.score,
    });
  }

  return out;
}
