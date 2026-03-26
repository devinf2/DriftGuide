import type { Location } from '@/src/types';

/** Levenshtein distance for typo-tolerant matching. */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const rows = b.length + 1;
  const cols = a.length + 1;
  const matrix: number[] = new Array(rows * cols);
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

function maxTypoDistance(queryLen: number): number {
  if (queryLen <= 3) return 1;
  if (queryLen <= 6) return 2;
  return 3;
}

/** Higher = better match. 0 = no match. */
function tokenMatchScore(token: string, name: string): number {
  const t = token.trim().toLowerCase();
  const n = name.toLowerCase();
  if (!t) return 0;
  if (n.includes(t)) return 1000;
  const words = n.split(/[\s,/]+/).filter(Boolean);
  for (const w of words) {
    if (w.startsWith(t)) return 950;
  }
  const maxDist = maxTypoDistance(t.length);
  const distWhole = levenshtein(t, n);
  if (distWhole <= maxDist) return 800 - distWhole * 15;
  let best = Infinity;
  for (const w of words) {
    if (w.length < Math.max(2, t.length - 3)) continue;
    const d = levenshtein(t, w);
    if (d < best) best = d;
  }
  if (best <= maxDist) return 700 - best * 15;
  return 0;
}

/**
 * Saved locations ranked by fuzzy match to the query (substring, prefix, light typos).
 */
export function filterLocationsByQuery(locations: Location[], query: string): Location[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  return locations
    .map((loc) => {
      const name = loc.name;
      if (tokens.length === 1) {
        return { loc, score: tokenMatchScore(tokens[0], name) };
      }
      const scores = tokens.map((tok) => tokenMatchScore(tok, name));
      const minScore = Math.min(...scores);
      if (minScore === 0) return { loc, score: 0 };
      return { loc, score: scores.reduce((a, b) => a + b, 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.loc);
}
