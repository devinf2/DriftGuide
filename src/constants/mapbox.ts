/**
 * Mapbox public token (safe to ship in the client). Set in `.env`:
 * EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.ey...
 *
 * For native builds, offline packs, and Android SDK download, you also need a
 * secret token with Downloads:Read — see https://rnmapbox.github.io/docs/install
 */
export const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';

/** Terrain-focused basemap (trails, landcover). Swap in Studio if you prefer. */
export const MAPBOX_STYLE_URL = 'mapbox://styles/mapbox/outdoors-v12';

