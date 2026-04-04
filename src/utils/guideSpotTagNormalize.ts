const UUID =
  '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

function dedupeEntries(entries: { id: string; name: string }[]): { id: string; name: string }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const e of entries) {
    const k = `${e.id.toLowerCase()}\0${e.name.trim().toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: e.id, name: e.name.trim().replace(/\s+/g, ' ') });
  }
  return out;
}

/** "Middle Provo River" → also "Middle Provo" for matching shorter model text */
function expandRiverAliases(entries: { id: string; name: string }[]): { id: string; name: string }[] {
  const seen = new Set(entries.map((e) => `${e.id.toLowerCase()}\0${e.name.toLowerCase()}`));
  const extra: { id: string; name: string }[] = [];
  for (const e of entries) {
    const m = e.name.match(/^(.+)\s+River$/i);
    if (m) {
      const short = m[1].trim();
      if (short.length >= 4) {
        const k = `${e.id.toLowerCase()}\0${short.toLowerCase()}`;
        if (!seen.has(k)) {
          seen.add(k);
          extra.push({ id: e.id, name: short });
        }
      }
    }
  }
  return [...entries, ...extra];
}

/**
 * All catalog (name, id) pairs to use when rewriting model prose into <<spot:…>>.
 * Sources: bullet lines, parent lines, extract→catalog lines, and resolved linked spots.
 */
export function getGuideSpotNormalizationEntries(
  summary: string | null | undefined,
  linkedSpots?: { id: string; name: string }[] | null,
): { id: string; name: string }[] {
  const raw: { id: string; name: string }[] = [];

  if (summary?.trim()) {
    const s = summary;
    const bulletRe = new RegExp(
      String.raw`^\s*•\s+(.+?)\s+\[catalog_id=${UUID}\]`,
      'gim',
    );
    let m: RegExpExecArray | null;
    while ((m = bulletRe.exec(s)) !== null) {
      raw.push({ name: m[1].trim(), id: m[2] });
    }

    const parentRe = new RegExp(
      String.raw`Parent\s+(.+?)\s+\[catalog_id=${UUID}\]`,
      'gi',
    );
    while ((m = parentRe.exec(s)) !== null) {
      raw.push({ name: m[1].trim(), id: m[2] });
    }

    const catalogArrowRe = new RegExp(
      String.raw`→\s*catalog:\s*(.+?)\s+\[catalog_id=${UUID}\]`,
      'gi',
    );
    while ((m = catalogArrowRe.exec(s)) !== null) {
      raw.push({ name: m[1].trim(), id: m[2] });
    }
  }

  for (const spot of linkedSpots ?? []) {
    const name = spot.name?.trim();
    if (name && name.length >= 2) raw.push({ id: spot.id, name });
  }

  return expandRiverAliases(dedupeEntries(raw));
}

/** @deprecated use getGuideSpotNormalizationEntries */
export function extractCatalogEntriesFromGuideSummary(summary: string | null | undefined): { id: string; name: string }[] {
  return getGuideSpotNormalizationEntries(summary, null);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite quoted / bold-wrapped catalog names to <<spot:id:canonicalName>> so SpotTaggedText can link.
 */
export function normalizeQuotedSpotsToTags(
  text: string,
  entries: { id: string; name: string }[],
): string {
  if (!text || entries.length === 0) return text;
  const sorted = [...entries].sort((a, b) => b.name.length - a.name.length);
  let out = text;
  for (const { id, name } of sorted) {
    const tag = `<<spot:${id}:${name}>>`;
    if (out.includes(tag)) continue;
    const esc = escapeRegExp(name);
    const escWithPeriod = escapeRegExp(`${name}.`);

    const spacedBoldQuote = [
      new RegExp(`\\*\\*\\s*"${escWithPeriod}"\\s*\\*\\*`, 'gi'),
      new RegExp(`\\*\\*\\s*"${esc}"\\s*\\*\\*`, 'gi'),
      new RegExp(`\\*\\*\\s*'${escWithPeriod}'\\s*\\*\\*`, 'gi'),
      new RegExp(`\\*\\*\\s*'${esc}'\\s*\\*\\*`, 'gi'),
    ];
    for (const p of spacedBoldQuote) {
      out = out.replace(p, tag);
    }

    const asciiQuoted: RegExp[] = [
      new RegExp(`'${escWithPeriod}'`, 'gi'),
      new RegExp(`'${esc}'`, 'gi'),
      new RegExp(`"${escWithPeriod}"`, 'gi'),
      new RegExp(`"${esc}"`, 'gi'),
    ];
    for (const p of asciiQuoted) {
      out = out.replace(p, tag);
    }

    const smartPairs: [string, string][] = [
      [`“${escWithPeriod}”`, tag],
      [`“${esc}”`, tag],
      [`‘${escWithPeriod}’`, tag],
      [`‘${esc}’`, tag],
    ];
    for (const [literal, rep] of smartPairs) {
      out = out.split(literal).join(rep);
    }

    const boldQuoted: RegExp[] = [
      new RegExp(`\\*\\*"${escWithPeriod}"\\*\\*`, 'gi'),
      new RegExp(`\\*\\*"${esc}"\\*\\*`, 'gi'),
      new RegExp(`\\*\\*'${escWithPeriod}'\\*\\*`, 'gi'),
      new RegExp(`\\*\\*'${esc}'\\*\\*`, 'gi'),
      new RegExp(`\\*\\*“${escWithPeriod}”\\*\\*`, 'gi'),
      new RegExp(`\\*\\*“${esc}”\\*\\*`, 'gi'),
    ];
    for (const p of boldQuoted) {
      out = out.replace(p, tag);
    }

    // Bold-only **Name** (no inner quotes). Restrict length to avoid matching stray **and**-style emphasis.
    if (name.length >= 7) {
      const boldPlain: RegExp[] = [
        new RegExp(`\\*\\*${escWithPeriod}\\*\\*`, 'gi'),
        new RegExp(`\\*\\*${esc}\\*\\*`, 'gi'),
      ];
      for (const p of boldPlain) {
        out = out.replace(p, tag);
      }
    }
  }
  return out;
}

const SPOT_TAG_SPLIT = /(<<spot:[^>]+>>)/gi;

function wrapPlainSegment(segment: string, sorted: { id: string; name: string }[]): string {
  let work = segment;
  for (const { id, name } of sorted) {
    const trimmed = name.trim();
    if (trimmed.length < 4) continue;
    const tag = `<<spot:${id}:${trimmed}>>`;
    const esc = escapeRegExp(trimmed);
    const re = new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'gi');
    const pieces = work.split(SPOT_TAG_SPLIT);
    work = pieces
      .map((p) => (/^<<spot:/i.test(p) ? p : p.replace(re, tag)))
      .join('');
  }
  return work;
}

/**
 * Wrap plain (unquoted) mentions of catalog names in <<spot:id:name>> so SpotTaggedText links them.
 * Only transforms text outside existing <<spot:…>> segments. Each pass re-splits so shorter names
 * never match inside newly inserted tags; longest names first avoids "Middle Provo" eating "Middle Provo River".
 */
export function wrapPlainCatalogNamesInSpotTags(
  text: string,
  entries: { id: string; name: string }[],
): string {
  if (!text || entries.length === 0) return text;
  const sorted = [...entries].sort((a, b) => b.name.length - a.name.length);
  const parts = text.split(SPOT_TAG_SPLIT);
  return parts
    .map((part) => (/^<<spot:/i.test(part) ? part : wrapPlainSegment(part, sorted)))
    .join('');
}
