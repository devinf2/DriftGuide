/**
 * Detect when the angler is asking for a place/water recommendation (not just technique).
 * Used to attach catalog + catch context even when no river name appears in the message.
 */
export function questionWantsLocationRecommendation(text: string): boolean {
  const q = text.toLowerCase().trim();
  if (q.length < 8) return false;

  const patterns = [
    /\bwhere (should|can|do|to)\s+i fish\b/,
    /\bwhere\b.*\bfish\b.*\bat\b/i,
    /\bfish at\b/i,
    /\bwhere (should|can|to)\s+(i|we) (go|fish)\b/,
    /\bwhere\s+(is|are)\s+(good|best)\b.*\b(fish|fishing)\b/,
    /\bbest (place|spot|water|river|stretch)\b/,
    /\bwhich (river|water|creek|stream|spot)\b/,
    /\bmost likely to catch\b/,
    /\brecommend (me )?(a |an )?(spot|place|water|river)\b/,
    /\bwhat (river|water|spot)\b/,
    /\bnear me\b/,
    /\bclose(r)? to (me|home)\b/,
    /\briver somewhere\b/,
    /\bon a river\b.*\bsomewhere\b/,
    /\bsomewhere\b.*\b(catch|fish)\b/,
    /\blooking to fish\b.*\b(river|water|spot|somewhere)\b/,
    /\bwhere specifically\b/i,
    /\bpull (its|their|the) locations\b/i,
    /\b(list|show|give)\b.*\b(locations|spots|access)\b/i,
    /\bspecific (child|access|launch|bay|point|inlet)s?\b/i,
  ];
  if (patterns.some((p) => p.test(q))) return true;
  if (/\b(where|which)\b/.test(q) && /\b(fish|fishing|water|river|spot|go)\b/.test(q)) return true;
  return false;
}
