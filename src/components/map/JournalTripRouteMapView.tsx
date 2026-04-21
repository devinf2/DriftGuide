import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { JournalCatchMapPin } from '@/src/components/map/JournalCatchMapPin';
import { LabeledEndpointMapPin } from '@/src/components/map/LabeledEndpointMapPin';
import { MapBasemapSwitcher } from '@/src/components/map/MapBasemapSwitcher';
import { MAPBOX_ACCESS_TOKEN, mapboxStyleURLForBasemap } from '@/src/constants/mapbox';
import { useMapBasemapStore } from '@/src/stores/mapBasemapStore';
import {
  DEFAULT_MAP_CENTER,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  USER_LOCATION_ZOOM,
} from '@/src/constants/mapDefaults';
import { Colors, FontSize, Spacing } from '@/src/constants/theme';
import { dedupeConsecutiveLngLat, matchWalkingRoute } from '@/src/services/mapboxWalkingMatch';
import type { CatchData, Trip, TripEvent } from '@/src/types';
import { getCatchHeroPhotoUrl } from '@/src/utils/catchPhotos';
import type { MapCameraStatePayload } from '@/src/utils/mapViewport';
import { tripStartEndDisplayCoords } from '@/src/utils/tripStartEndFromEvents';
import { isRnMapboxNativeLinked } from '@/src/utils/rnmapboxNative';
import { getAnnotationsLayerID } from '@rnmapbox/maps';

export type JournalWaypoint = {
  id: string;
  lng: number;
  lat: number;
  title: string;
  pinColor: string;
  kind: 'start' | 'end' | 'catch';
  /** `kind === 'catch'` only */
  photoUrl?: string | null;
  catchEventId?: string;
};

function loadMapbox(): Record<string, unknown> | null {
  if (!isRnMapboxNativeLinked()) return null;
  try {
    return require('@rnmapbox/maps') as Record<string, unknown>;
  } catch {
    return null;
  }
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
      photoUrl: getCatchHeroPhotoUrl(data),
      catchEventId: e.id,
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

/** Apply draft start/end coords while placing a pin; preserves catch order from {@link buildJournalWaypoints}. */
function mergeJournalWaypointsWithPlacement(
  trip: Trip,
  events: TripEvent[],
  placement: { kind: 'start' | 'end'; lat: number; lng: number } | null,
): JournalWaypoint[] {
  const base = buildJournalWaypoints(trip, events);
  if (!placement) return base;
  const pinColor = placement.kind === 'start' ? Colors.primary : Colors.secondary;
  const wp: JournalWaypoint = {
    id: placement.kind === 'start' ? 'journal-start' : 'journal-end',
    lng: placement.lng,
    lat: placement.lat,
    title: placement.kind === 'start' ? 'Start' : 'End',
    pinColor,
    kind: placement.kind,
  };
  const idx = base.findIndex((w) => w.kind === placement.kind);
  if (placement.kind === 'start') {
    if (idx >= 0) return base.map((w, i) => (i === idx ? wp : w));
    return [wp, ...base];
  }
  if (idx >= 0) return base.map((w, i) => (i === idx ? wp : w));
  return [...base, wp];
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
  /** Tapping a catch pin (thumbnail or fish icon) */
  onCatchWaypointPress?: (catchEventId: string) => void;
  /**
   * Pan-under-center mode: full route and catch pins stay visible; map center sets the moving start/end.
   * `focusRequestKey` bumps when opening placement to recenter the camera.
   */
  placementKind?: 'start' | 'end' | null;
  placementLatitude?: number;
  placementLongitude?: number;
  placementFocusKey?: number;
  onPlacementCoordinateChange?: (lat: number, lng: number) => void;
};

/**
 * Read-only map: start / catches / end pins plus a route line.
 * Line uses Mapbox Map Matching (walking) to hug nearby trails, then falls back to a straight path.
 * Stroke uses water palette to read as a river route.
 */
function JournalCatchPointAnnotation({
  w,
  PointAnnotation,
  onCatchWaypointPress,
}: {
  w: JournalWaypoint;
  PointAnnotation: ComponentType<Record<string, unknown>>;
  onCatchWaypointPress?: (catchEventId: string) => void;
}) {
  const annotRef = useRef<{ refresh?: () => void } | null>(null);
  const catchId = w.catchEventId;
  return (
    <PointAnnotation
      ref={(r: unknown) => {
        annotRef.current = r as { refresh?: () => void } | null;
      }}
      id={w.id}
      coordinate={[w.lng, w.lat]}
      title={w.title}
      onSelected={
        onCatchWaypointPress && catchId ? () => onCatchWaypointPress(catchId) : undefined
      }
    >
      <View collapsable={false} pointerEvents="box-none">
        <JournalCatchMapPin
          photoUrl={w.photoUrl}
          onImageLoaded={() => annotRef.current?.refresh?.()}
        />
      </View>
    </PointAnnotation>
  );
}

export function JournalTripRouteMapView({
  trip,
  events,
  containerStyle,
  onCatchWaypointPress,
  placementKind = null,
  placementLatitude,
  placementLongitude,
  placementFocusKey = 0,
  onPlacementCoordinateChange,
}: Props) {
  const basemapId = useMapBasemapStore((s) => s.basemapId);
  const rawMod = useMemo(() => loadMapbox(), []);
  /** Style layer id for PointAnnotation bitmaps — insert route line below this so pins paint on top. */
  const pointAnnotationLayerBelowId = useMemo(() => getAnnotationsLayerID('PointAnnotations'), []);
  const tokenApplied = useRef(false);
  const cameraRef = useRef<{
    fitBounds?: (
      ne: [number, number],
      sw: [number, number],
      padding?: number | number[],
      duration?: number,
    ) => void;
  } | null>(null);

  const isPlacing =
    placementKind != null &&
    placementLatitude != null &&
    placementLongitude != null &&
    onPlacementCoordinateChange != null;

  const waypoints = useMemo(() => {
    const placement =
      placementKind != null && placementLatitude != null && placementLongitude != null
        ? { kind: placementKind, lat: placementLatitude, lng: placementLongitude }
        : null;
    return mergeJournalWaypointsWithPlacement(trip, events, placement);
  }, [trip, events, placementKind, placementLatitude, placementLongitude]);
  const pathLngLat = useMemo(() => {
    const raw = waypoints.map((w) => [w.lng, w.lat] as [number, number]);
    return dedupeConsecutiveLngLat(raw);
  }, [waypoints]);

  const [routeFeature, setRouteFeature] = useState<{
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  } | null>(null);

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
      return;
    }

    const straight = {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: pathLngLat,
      },
    };

    if (isPlacing) {
      setRouteFeature(straight);
      return;
    }

    void (async () => {
      const matched = await matchWalkingRoute(pathLngLat);
      if (cancelled) return;
      if (matched && matched.length >= 2) {
        setRouteFeature({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: matched },
        });
      } else {
        setRouteFeature(straight);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathLngLat, isPlacing]);

  const fitCameraToTripStart = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam?.fitBounds) return;
    const start = waypoints.find((w) => w.id === 'journal-start') ?? waypoints[0];
    if (!start) return;
    const [ne, sw] = bboxPaddingFromLngLats([[start.lng, start.lat]], 0.003);
    cam.fitBounds(ne, sw, 48, 600);
  }, [waypoints]);

  useEffect(() => {
    if (isPlacing) return;
    const t = setTimeout(() => fitCameraToTripStart(), 300);
    return () => clearTimeout(t);
  }, [fitCameraToTripStart, isPlacing]);

  const placementCbRef = useRef(onPlacementCoordinateChange);
  placementCbRef.current = onPlacementCoordinateChange;

  const handlePlacementCamera = useCallback((e: unknown) => {
    const s = e as MapCameraStatePayload;
    const c = s.properties?.center;
    if (!Array.isArray(c) || c.length < 2) return;
    const lng = c[0];
    const lat = c[1];
    if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
      placementCbRef.current?.(lat, lng);
    }
  }, []);

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

  const annotationsWaypoints =
    isPlacing && placementKind != null
      ? waypoints.filter((w) => w.kind !== placementKind)
      : waypoints;

  return (
    <View style={[styles.fill, containerStyle]}>
      <MapView
        style={styles.map}
        styleURL={mapboxStyleURLForBasemap(basemapId)}
        compassEnabled
        scaleBarEnabled={false}
        logoEnabled
        attributionEnabled
        onCameraChanged={isPlacing ? (e: unknown) => handlePlacementCamera(e) : undefined}
      >
        <Camera
          ref={cameraRef}
          key={isPlacing ? `place-${placementFocusKey}` : 'route'}
          defaultSettings={
            isPlacing && placementLatitude != null && placementLongitude != null
              ? {
                  centerCoordinate: [placementLongitude, placementLatitude],
                  zoomLevel: USER_LOCATION_ZOOM,
                }
              : {
                  centerCoordinate: center,
                  zoomLevel: 13,
                }
          }
          minZoomLevel={MAP_MIN_ZOOM}
          maxZoomLevel={MAP_MAX_ZOOM}
        />
        {routeFeature ? (
          <ShapeSource id="journalTripRoute" shape={routeFeature}>
            {/*
              PointAnnotation renders to a dedicated style layer (see getAnnotationsLayerID).
              `slot="bottom"` is not enough — that slot can still stack above that layer.
              Place the glow directly under the point-annotation layer, then stack the core on top of the glow.
            */}
            <LineLayer
              id="journalRouteGlow"
              belowLayerID={pointAnnotationLayerBelowId}
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
              aboveLayerID="journalRouteGlow"
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
        {annotationsWaypoints.map((w) =>
          w.kind === 'catch' ? (
            <JournalCatchPointAnnotation
              key={w.id}
              w={w}
              PointAnnotation={PointAnnotation}
              onCatchWaypointPress={onCatchWaypointPress}
            />
          ) : (
            <PointAnnotation key={w.id} id={w.id} coordinate={[w.lng, w.lat]} title={w.title}>
              <View collapsable={false} pointerEvents="box-none">
                <LabeledEndpointMapPin
                  label={w.kind === 'start' ? 'Start' : 'End'}
                  backgroundColor={w.pinColor}
                  icon={w.kind === 'start' ? 'place' : 'flag'}
                />
              </View>
            </PointAnnotation>
          ),
        )}
      </MapView>

      {isPlacing && placementKind != null ? (
        <View style={styles.placementCrosshair} pointerEvents="none">
          <MaterialIcons
            name={placementKind === 'end' ? 'flag' : 'place'}
            size={44}
            color={placementKind === 'end' ? Colors.secondary : Colors.primaryLight}
            style={styles.placementCrosshairIcon}
          />
        </View>
      ) : null}

      <MapBasemapSwitcher />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 280 },
  map: { flex: 1 },
  placementCrosshair: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placementCrosshairIcon: {
    transform: [{ translateY: -20 }],
  },
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
});
