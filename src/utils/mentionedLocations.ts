import type { Location } from '@/src/types';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';

const OR_SPLIT = /\s+(?:or|vs\.?|versus)\s+/i;

/** Split user text into phrases often used to name waters (e.g. "A or B"). */
export function extractComparisonPhrases(text: string): string[] {
  const cleaned = text.replace(/[?!.]/g, ' ').trim();
  if (!cleaned) return [];
  const chunks = cleaned.split(OR_SPLIT).flatMap((p) => p.split(',').map((x) => x.trim()));
  return chunks.filter((p) => p.length > 2);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function distanceKmToLocation(loc: Location, userLat: number, userLng: number): number | null {
  const la = loc.latitude;
  const lo = loc.longitude;
  if (la == null || lo == null) return null;
  return haversineKm(userLat, userLng, la, lo);
}

/**
 * Nearest catalog locations with coordinates (for "near me" fallback context).
 */
export function nearestCatalogLocations(
  locations: Location[],
  userLat: number,
  userLng: number,
  limit: number,
): Location[] {
  const scored = locations
    .map((loc) => {
      const d = distanceKmToLocation(loc, userLat, userLng);
      return d == null ? null : { loc, d };
    })
    .filter((x): x is { loc: Location; d: number } => x != null)
    .sort((a, b) => a.d - b.d);
  const out: Location[] = [];
  const seen = new Set<string>();
  for (const { loc } of scored) {
    if (seen.has(loc.id)) continue;
    seen.add(loc.id);
    out.push(loc);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Resolve locations from the user question using fuzzy DB name matching, optional distance sort.
 */
export function findMentionedLocations(
  question: string,
  allLocations: Location[],
  userLat?: number | null,
  userLng?: number | null,
): { locations: Location[]; usedProximityFallback: boolean } {
  const phrases = extractComparisonPhrases(question);
  const candidates = new Map<string, { loc: Location; score: number }>();

  const bump = (locs: Location[], baseScore: number) => {
    locs.forEach((loc, i) => {
      const rankScore = baseScore - i * 15;
      const prev = candidates.get(loc.id);
      if (!prev || prev.score < rankScore) candidates.set(loc.id, { loc, score: rankScore });
    });
  };

  for (const phrase of phrases) {
    bump(filterLocationsByQuery(allLocations, phrase), 1000);
  }
  bump(filterLocationsByQuery(allLocations, question), 200);

  const q = question.toLowerCase();
  for (const loc of allLocations) {
    const name = loc.name.toLowerCase();
    if (name.length >= 4 && q.includes(name)) {
      const score = 450 + Math.min(name.length, 40);
      const prev = candidates.get(loc.id);
      if (!prev || prev.score < score) candidates.set(loc.id, { loc, score });
    }
  }

  let ordered = [...candidates.values()].sort((a, b) => b.score - a.score).map((x) => x.loc);

  let usedProximityFallback = false;
  if (ordered.length === 0 && userLat != null && userLng != null) {
    ordered = nearestCatalogLocations(allLocations, userLat, userLng, 5);
    usedProximityFallback = true;
  } else if (userLat != null && userLng != null && ordered.length > 0) {
    ordered = [...ordered].sort((a, b) => {
      const da = distanceKmToLocation(a, userLat, userLng) ?? 1e9;
      const db = distanceKmToLocation(b, userLat, userLng) ?? 1e9;
      return da - db;
    });
  }

  return { locations: ordered.slice(0, 8), usedProximityFallback };
}
