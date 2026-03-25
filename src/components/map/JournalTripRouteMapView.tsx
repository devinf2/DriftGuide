import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LabeledEndpointMapPin } from '@/src/components/map/LabeledEndpointMapPin';
import { MAPBOX_ACCESS_TOKEN, MAPBOX_STYLE_URL } from '@/src/constants/mapbox';
import { DEFAULT_MAP_CENTER, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '@/src/constants/mapDefaults';
import { Colors, FontSize, Spacing } from '@/src/constants/theme';
import { dedupeConsecutiveLngLat, matchWalkingRoute } from '@/src/services/mapboxWalkingMatch';
import type { CatchData, Trip, TripEvent } from '@/src/types';
import { tripStartEndDisplayCoords } from '@/src/utils/tripStartEndFromEvents';
import { isRnMapboxNativeLinked } from '@/src/utils/rnmapboxNative';

export type JournalWaypoint = {
  id: string;
  lng: number;
  lat: number;
  title: string;
  pinColor: string;
  kind: 'start' | 'end' | 'catch';
};

function loadMapbox(): Record<string, unknown> | null {
  if (!isRnMapboxNativeLinked()) return null;
  try {
    return require('@rnmapbox/maps') as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapAttributionBesideZoomControls(
  showZoomControls: boolean,
): { bottom: number; right: number } | undefined {
  if (!showZoomControls) return undefined;
  return {
    bottom: Spacing.lg,
    right: Spacing.md + 44 + Spacing.sm,
  };
}

function roundZoom(z: number): number {
  return Math.round(z * 10) / 10;
}

function clampZoom(z: number): number {
  return Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, z));
}

/** Chronological route: start → catches (by time) → end. */
export function buildJournalWaypoints(trip: Trip, events: TripEvent[]): JournalWaypoint[] {
  const waypoints: JournalWaypoint[] = [];

  const { startLat: startLatResolved, startLon: startLonResolved, endLat: endLatResolved, endLon: endLonResolved } =
    tripStartEndDisplayCoords(trip, events);

  const startLat = startLatResolved;
  const startLon = startLonResolved;
  if (startLat != null && startLon != null) {
    waypoints.push({
      id: 'journal-start',
      lng: startLon,
      lat: startLat,
      title: 'Start',
      pinColor: Colors.primary,
      kind: 'start',
    });
  }

  const catches = events
    .filter((e) => e.event_type === 'catch' && e.latitude != null && e.longitude != null)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const e of catches) {
    const data = e.data as CatchData;
    const species = data.species?.trim();
    waypoints.push({
      id: `journal-catch-${e.id}`,
      lng: e.longitude!,
      lat: e.latitude!,
      title: species ? `Catch · ${species}` : 'Catch',
      pinColor: Colors.primaryLight,
      kind: 'catch',
    });
  }

  const endLat = endLatResolved;
  const endLon = endLonResolved;
  if (endLat != null && endLon != null) {
    waypoints.push({
      id: 'journal-end',
      lng: endLon,
      lat: endLat,
      title: 'End',
      pinColor: Colors.secondary,
      kind: 'end',
    });
  }

  return waypoints;
}

function bboxPaddingFromLngLats(points: [number, number][], pad = 0.002): [[number, number], [number, number]] {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return [
    [maxLng + pad, maxLat + pad],
    [minLng - pad, minLat - pad],
  ];
}

type Props = {
  trip: Trip;
  events: TripEvent[];
  containerStyle?: StyleProp<ViewStyle>;
};

/**
 * Read-only map: start / catches / end pins plus a route line.
 * Line uses Mapbox Map Matching (walking) to hug nearby trails, then falls back to a straight path.
 * Stroke uses water palette to read as a river route.
 */
export function JournalTripRouteMapView({ trip, events, containerStyle }: Props) {
  const rawMod = useMemo(() => loadMapbox(), []);
  const tokenApplied = useRef(false);
  const cameraRef = useRef<{
    fitBounds?: (
      ne: [number, number],
      sw: [number, number],
      padding?: number | number[],
      duration?: number,
    ) => void;
    zoomTo?: (z: number, duration?: number) => void;
  } | null>(null);

  const waypoints = useMemo(() => buildJournalWaypoints(trip, events), [trip, events]);
  const pathLngLat = useMemo(() => {
    const raw = waypoints.map((w) => [w.lng, w.lat] as [number, number]);
    return dedupeConsecutiveLngLat(raw);
  }, [waypoints]);

  const [liveZoom, setLiveZoom] = useState(13);
  const [routeFeature, setRouteFeature] = useState<{
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  } | null>(null);
  const [routeMode, setRouteMode] = useState<'loading' | 'matched' | 'straight' | 'none'>('none');

  const mod = useMemo(() => {
    if (!rawMod) return null;
    const ns = (rawMod.default ?? rawMod) as {
      setAccessToken?: (t: string) => Promise<unknown>;
      MapView?: React.ComponentType<Record<string, unknown>>;
      Camera?: React.ComponentType<Record<string, unknown>>;
      PointAnnotation?: React.ComponentType<Record<string, unknown>>;
      ShapeSource?: React.ComponentType<Record<string, unknown>>;
      LineLayer?: React.ComponentType<Record<string, unknown>>;
    };
    return ns;
  }, [rawMod]);

  useEffect(() => {
    if (!mod?.setAccessToken || !MAPBOX_ACCESS_TOKEN || tokenApplied.current) return;
    void mod.setAccessToken(MAPBOX_ACCESS_TOKEN).then(() => {
      tokenApplied.current = true;
    });
  }, [mod]);

  useEffect(() => {
    let cancelled = false;
    if (pathLngLat.length < 2) {
      setRouteFeature(null);
      setRouteMode('none');
      return;
    }

    setRouteMode('loading');
    const straight = {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: pathLngLat,
      },
    };

    void (async () => {
      const matched = await matchWalkingRoute(pathLngLat);
      if (cancelled) return;
      if (matched && matched.length >= 2) {
        setRouteFeature({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: matched },
        });
        setRouteMode('matched');
      } else {
        setRouteFeature(straight);
        setRouteMode('straight');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathLngLat]);

  const fitCameraToTripStart = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam?.fitBounds) return;
    const start = waypoints.find((w) => w.id === 'journal-start') ?? waypoints[0];
    if (!start) return;
    const [ne, sw] = bboxPaddingFromLngLats([[start.lng, start.lat]], 0.003);
    cam.fitBounds(ne, sw, 48, 600);
  }, [waypoints]);

  useEffect(() => {
    const t = setTimeout(() => fitCameraToTripStart(), 300);
    return () => clearTimeout(t);
  }, [fitCameraToTripStart]);

  const reportZoom = useCallback((z: number) => {
    setLiveZoom(roundZoom(z));
  }, []);

  const handleMapIdle = useCallback(
    (state: { properties?: { zoom?: number } }) => {
      const z = state.properties?.zoom;
      if (typeof z === 'number') reportZoom(z);
    },
    [reportZoom],
  );

  const zoomBy = useCallback(
    (delta: number) => {
      const next = clampZoom(roundZoom(liveZoom + delta));
      cameraRef.current?.zoomTo?.(next, 220);
      reportZoom(next);
    },
    [liveZoom, reportZoom],
  );

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.placeholder, containerStyle]}>
        <MaterialIcons name="map" size={40} color={Colors.textTertiary} />
        <Text style={styles.placeholderText}>Trip map is available in the iOS and Android app.</Text>
      </View>
    );
  }

  if (!rawMod || !mod) {
    return (
      <View style={[styles.placeholder, containerStyle]}>
        <MaterialIcons name="map" size={40} color={Colors.textTertiary} />
        <Text style={styles.placeholderText}>
          Mapbox needs a dev build with native Mapbox (Expo Go does not include it).
        </Text>
      </View>
    );
  }

  if (!MAPBOX_ACCESS_TOKEN) {
    return (
      <View style={[styles.placeholder, containerStyle]}>
        <MaterialIcons name="map" size={40} color={Colors.textTertiary} />
        <Text style={styles.placeholderText}>Set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN for the map.</Text>
      </View>
    );
  }

  const { MapView, Camera, PointAnnotation, ShapeSource, LineLayer } = mod;
  if (!MapView || !Camera || !PointAnnotation || !ShapeSource || !LineLayer) {
    return (
      <View style={[styles.placeholder, containerStyle]}>
        <Text style={styles.placeholderText}>Map components failed to load.</Text>
      </View>
    );
  }

  const startWp = waypoints.find((w) => w.id === 'journal-start') ?? waypoints[0];
  const center: [number, number] =
    startWp != null ? [startWp.lng, startWp.lat] : DEFAULT_MAP_CENTER;

  return (
    <View style={[styles.fill, containerStyle]}>
      <MapView
        style={styles.map}
        styleURL={MAPBOX_STYLE_URL}
        compassEnabled
        scaleBarEnabled={false}
        logoEnabled
        attributionEnabled
        attributionPosition={mapAttributionBesideZoomControls(true)}
        onMapIdle={(e: unknown) => handleMapIdle(e as { properties?: { zoom?: number } })}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: center,
            zoomLevel: 13,
          }}
          minZoomLevel={MAP_MIN_ZOOM}
          maxZoomLevel={MAP_MAX_ZOOM}
        />
        {routeFeature ? (
          <ShapeSource id="journalTripRoute" shape={routeFeature}>
            <LineLayer
              id="journalRouteGlow"
              style={{
                lineColor: Colors.secondaryLight,
                lineWidth: 12,
                lineOpacity: 0.35,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="journalRouteCore"
              style={{
                lineColor: Colors.water,
                lineWidth: 5,
                lineOpacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        ) : null}
        {waypoints.map((w) => (
          <PointAnnotation key={w.id} id={w.id} coordinate={[w.lng, w.lat]} title={w.title}>
            {w.kind === 'catch' ? (
              <MaterialIcons name="place" size={34} color={w.pinColor} />
            ) : (
              <LabeledEndpointMapPin
                label={w.kind === 'start' ? 'Start' : 'End'}
                backgroundColor={w.pinColor}
                icon={w.kind === 'start' ? 'place' : 'flag'}
              />
            )}
          </PointAnnotation>
        ))}
      </MapView>

      <View style={styles.zoomCluster} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom in"
          style={({ pressed }) => [styles.zoomButton, pressed && styles.zoomButtonPressed]}
          onPress={() => zoomBy(1)}
          disabled={liveZoom >= MAP_MAX_ZOOM - 0.01}
        >
          <MaterialIcons name="add" size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.zoomDivider} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom out"
          style={({ pressed }) => [styles.zoomButton, pressed && styles.zoomButtonPressed]}
          onPress={() => zoomBy(-1)}
          disabled={liveZoom <= MAP_MIN_ZOOM + 0.01}
        >
          <MaterialIcons name="remove" size={22} color={Colors.text} />
        </Pressable>
      </View>

      {routeMode === 'loading' ? (
        <View style={styles.routeBadge}>
          <Text style={styles.routeBadgeText}>Fitting route to nearby paths…</Text>
        </View>
      ) : null}
      {routeMode === 'straight' && pathLngLat.length >= 2 ? (
        <View style={styles.routeBadge}>
          <Text style={styles.routeBadgeText}>Straight-line path (no trail match nearby)</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 280 },
  map: { flex: 1 },
  placeholder: {
    flex: 1,
    minHeight: 280,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.surface,
  },
  placeholderText: {
    marginTop: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  zoomCluster: {
    position: 'absolute',
    bottom: Spacing.lg,
    right: Spacing.md,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  zoomButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  zoomButtonPressed: {
    opacity: 0.85,
    backgroundColor: Colors.surfaceElevated,
  },
  zoomDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  routeBadge: {
    position: 'absolute',
    top: Spacing.md,
    left: Spacing.md,
    right: Spacing.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  routeBadgeText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
