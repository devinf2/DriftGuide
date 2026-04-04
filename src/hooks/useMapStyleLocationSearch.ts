import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAPBOX_ACCESS_TOKEN } from '@/src/constants/mapbox';
import { forwardGeocode, type MapboxGeocodeFeature } from '@/src/services/mapboxGeocoding';
import type { Location } from '@/src/types';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';

/** Matches {@link app/(tabs)/map.tsx} forward geocode debounce. */
const MAP_SEARCH_DEBOUNCE_MS = 380;

/**
 * Same behavior as the Map tab search: ≥2 chars, Mapbox only while the field is focused,
 * `filterLocationsByQuery` on all active locations (max 8), proximity-biased geocode.
 */
export function useMapStyleLocationSearch(
  locations: Location[],
  proximityLngLat: [number, number] | null,
  enabled: boolean,
) {
  const [searchText, setSearchText] = useState('');
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [mapSuggestions, setMapSuggestions] = useState<MapboxGeocodeFeature[]>([]);
  const [mapSuggestionsLoading, setMapSuggestionsLoading] = useState(false);
  const mapSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setMapSuggestions([]);
      setMapSuggestionsLoading(false);
      return;
    }
    const q = searchText.trim();
    if (!searchInputFocused || q.length < 2) {
      setMapSuggestions([]);
      setMapSuggestionsLoading(false);
      return;
    }
    if (!MAPBOX_ACCESS_TOKEN) {
      setMapSuggestions([]);
      setMapSuggestionsLoading(false);
      return;
    }
    clearTimeout(mapSearchDebounceRef.current);
    mapSearchDebounceRef.current = setTimeout(async () => {
      setMapSuggestionsLoading(true);
      try {
        const proximity = proximityLngLat ?? undefined;
        const { features } = await forwardGeocode(q, { proximity, limit: 5 });
        setMapSuggestions(features);
      } catch {
        setMapSuggestions([]);
      } finally {
        setMapSuggestionsLoading(false);
      }
    }, MAP_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(mapSearchDebounceRef.current);
  }, [
    enabled,
    searchText,
    searchInputFocused,
    proximityLngLat?.[0],
    proximityLngLat?.[1],
  ]);

  const savedLocationMatches = useMemo(() => {
    if (!enabled) return [];
    if (searchText.trim().length < 2) return [];
    const raw = filterLocationsByQuery(activeLocationsOnly(locations), searchText);
    const withCoords = raw.filter((l) => l.latitude != null && l.longitude != null);
    return withCoords.slice(0, 8);
  }, [enabled, locations, searchText]);

  const showSearchSuggestions =
    enabled &&
    searchInputFocused &&
    searchText.trim().length >= 2 &&
    (mapSuggestionsLoading || mapSuggestions.length > 0 || savedLocationMatches.length > 0);

  const resetSearch = useCallback(() => {
    setSearchText('');
    setSearchInputFocused(false);
    setMapSuggestions([]);
    setMapSuggestionsLoading(false);
  }, []);

  /** Collapse the suggestion panel (e.g. after a pick) while keeping the query text — matches Map tab. */
  const closeSuggestionsKeepText = useCallback(() => {
    setSearchInputFocused(false);
    setMapSuggestions([]);
    setMapSuggestionsLoading(false);
  }, []);

  const onSearchFocus = useCallback(() => setSearchInputFocused(true), []);
  const onSearchBlur = useCallback(() => {
    setTimeout(() => setSearchInputFocused(false), 200);
  }, []);

  return {
    searchText,
    setSearchText,
    mapSuggestions,
    mapSuggestionsLoading,
    savedLocationMatches,
    showSearchSuggestions,
    onSearchFocus,
    onSearchBlur,
    resetSearch,
    closeSuggestionsKeepText,
    searchInputFocused,
    searchAtRest: !searchInputFocused && searchText.trim().length === 0,
  };
}
