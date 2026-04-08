/** Match AI hot-spot suggestion text to a catalog row (same rules as home hot spots). */
export function catalogLocationIdForSpotSuggestion(
  suggestion: { locationName: string },
  locations: { id: string; name: string }[],
): string | undefined {
  const suggestionName = (s: { locationName: string }) => s.locationName.toLowerCase().trim();
  const primaryPart = (s: { locationName: string }) =>
    suggestionName(s).split(/[\s]*[-–—][\s]*/)[0]?.trim() ?? suggestionName(s);
  const sn = suggestionName(suggestion);
  const pp = primaryPart(suggestion);
  const loc = locations.find((l) => {
    const ln = l.name.toLowerCase();
    return ln === sn || sn.includes(ln) || ln.includes(pp) || pp.includes(ln);
  });
  return loc?.id;
}
