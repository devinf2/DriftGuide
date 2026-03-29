/**
 * Mapbox public token (safe to ship in the client). Set in `.env`:
 * EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.ey...
 *
 * For native builds, offline packs, and Android SDK download, you also need a
 * secret token with Downloads:Read — see https://rnmapbox.github.io/docs/install
 */
export const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';

/** Built-in Mapbox styles users can pick (same token; counts toward normal map loads). */
export type MapboxBasemapId = 'outdoors' | 'satellite' | 'satellite_streets';

export const MAPBOX_BASEMAP_OPTIONS: {
  id: MapboxBasemapId;
  label: string;
  shortLabel: string;
  styleURL: string;
}[] = [
  {
    id: 'outdoors',
    label: 'Terrain',
    shortLabel: 'Map',
    styleURL: 'mapbox://styles/mapbox/outdoors-v12',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    shortLabel: 'Sat',
    styleURL: 'mapbox://styles/mapbox/satellite-v9',
  },
  {
    id: 'satellite_streets',
    label: 'Hybrid',
    shortLabel: 'Hybrid',
    styleURL: 'mapbox://styles/mapbox/satellite-streets-v12',
  },
];

/** Default terrain basemap (trails, landcover). */
export const MAPBOX_STYLE_URL = MAPBOX_BASEMAP_OPTIONS[0].styleURL;

export function mapboxStyleURLForBasemap(id: MapboxBasemapId): string {
  const row = MAPBOX_BASEMAP_OPTIONS.find((o) => o.id === id);
  return row?.styleURL ?? MAPBOX_STYLE_URL;
}

export function isMapboxBasemapId(value: unknown): value is MapboxBasemapId {
  return value === 'outdoors' || value === 'satellite' || value === 'satellite_streets';
}

