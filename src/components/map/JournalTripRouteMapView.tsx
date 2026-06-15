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
import { ExpandableMapFrame, type ExpandableMapMode } from '@/src/components/map/ExpandableMapFrame';
import {
  flyCameraToUserLocation,
  MapLocateButton,
  type CameraControl,
} from '@/src/components/map/MapLocateButton';
import { JournalCatchMapMarker, JournalCatchMapPin } from '@/src/components/map/JournalCatchMapPin';
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
import type { CatchData, Photo, Trip, TripEvent } from '@/src/types';
import { buildAlbumPhotoUrlsByCatchId, resolveCatchHeroPhotoUrl } from '@/src/utils/catchPhotos';
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
  /** Per-angler tint for catch pins in Group / per-person views. */
  ringColor?: string | null;
  /** True when this catch had no saved GPS and was fanned out around the trip's location. */
  approximate?: boolean;
};

/**
 * Deterministic spiral offset (in degrees) for catches that lack their own GPS and are pinned at the
 * trip location. Index 0 sits dead center; later catches fan out so stacked pins stay tappable.
 * ~6m base radius — close enough to read as "at the trip spot," far enough apart to tap.
 */
function fanOutLngLatOffset(index: number): { dLat: number; dLng: number } {
  if (index <= 0) return { dLat: 0, dLng: 0 };
  const goldenAngle = 2.399963; // ~137.5° — even, non-overlapping spiral
  const angle = index * goldenAngle;
  const radius = 0.00006 * Math.sqrt(index);
  return { dLat: radius * Math.sin(angle), dLng: radius * Math.cos(angle) };
}

function loadMapbox(): Record<string, unknown> | null {
  if (!isRnMapboxNativeLinked()) return null;
  try {
    return require('@rnmapbox/maps') as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Start / end pins for a trip (resolved from trip fields + events). */
export function buildStartEndWaypoints(
  trip: Trip,
  events: TripEvent[],
): { start: JournalWaypoint | null; end: JournalWaypoint | null } {
  const { startLat, startLon, endLat, endLon } = tripStartEndDisplayCoords(trip, events);
  const start: JournalWaypoint | null =
    startLat != null && startLon != null
      ? { id: 'journal-start', lng: startLon, lat: startLat, title: 'Start', pinColor: Colors.primary, kind: 'start' }
      : null;
  const end: JournalWaypoint | null =
    endLat != null && endLon != null
      ? { id: 'journal-end', lng: endLon, lat: endLat, title: 'End', pinColor: Colors.secondary, kind: 'end' }
      : null;
  return { start, end };
}

/**
 * Catch pins for a trip, in chronological order. Every catch gets a pin: catches that never recorded
 * their own GPS (e.g. quick "skip" logs, or a failed/slow fix) fall back to the trip's location, fanned
 * out so stacked pins stay tappable. `ringColor` tints the pin for Group / per-person views.
 */
export function buildCatchWaypoints(
  trip: Trip,
  events: TripEvent[],
  albumPhotoUrlsByCatchId?: ReadonlyMap<string, readonly string[]>,
  ringColor?: string | null,
  idPrefix = 'journal-catch',
): JournalWaypoint[] {
  const { startLat, startLon } = tripStartEndDisplayCoords(trip, events);
  const catches = events
    .filter((e) => e.event_type === 'catch')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const waypoints: JournalWaypoint[] = [];
  let fallbackIndex = 0;
  for (const e of catches) {
    let lat = e.latitude;
    let lng = e.longitude;
    let approximate = false;
    if (lat == null || lng == null) {
      // No per-catch GPS — anchor to the trip location so the fish still shows.
      if (startLat == null || startLon == null) continue;
      const off = fanOutLngLatOffset(fallbackIndex++);
      lat = startLat + off.dLat;
      lng = startLon + off.dLng;
      approximate = true;
    }
    const data = e.data as CatchData;
    const species = data.species?.trim();
    waypoints.push({
      id: `${idPrefix}-${e.id}`,
      lng,
      lat,
      title: species ? `Catch · ${species}` : 'Catch',
      pinColor: Colors.primaryLight,
      kind: 'catch',
      photoUrl: resolveCatchHeroPhotoUrl(e.id, data, albumPhotoUrlsByCatchId),
      catchEventId: e.id,
      ringColor: ringColor ?? null,
      approximate,
    });
  }
  return waypoints;
}

/** Chronological route: start → catches (by time) → end. */
export function buildJournalWaypoints(
  trip: Trip,
  events: TripEvent[],
  albumPhotoUrlsByCatchId?: ReadonlyMap<string, readonly string[]>,
): JournalWaypoint[] {
  const { start, end } = buildStartEndWaypoints(trip, events);
  const catches = buildCatchWaypoints(trip, events, albumPhotoUrlsByCatchId);
  return [start, ...catches, end].filter((w): w is JournalWaypoint => w != null);
}

/** Apply draft start/end coords while placing a pin; preserves catch order from {@link buildJournalWaypoints}. */
function mergeJournalWaypointsWithPlacement(
  trip: Trip,
  events: TripEvent[],
  placement: { kind: 'start' | 'end'; lat: number; lng: number } | null,
  albumPhotoUrlsByCatchId?: ReadonlyMap<string, readonly string[]>,
): JournalWaypoint[] {
  const base = buildJournalWaypoints(trip, events, albumPhotoUrlsByCatchId);
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
  /** When true (default), shows an expand control for a full-screen map modal. */
  expandable?: boolean;
  /** When set, catch pin photos use the same album rows as the Photos tab. */
  tripAlbumPhotos?: Photo[];
  /**
   * Continuously show the live user-location puck from mount (no tap required), so a finished
   * trip's map can still be used to navigate out. Gate to the trip owner — avoids requesting
   * location permission when viewing someone else's shared trip.
   */
  liveLocation?: boolean;
  /**
   * Replace the catch pins derived from `events` with a pre-built, possibly multi-angler set
   * (Group / per-person map). Start & end pins still come from `trip`. When omitted, catches are
   * built from `events` as usual.
   */
  catchWaypoints?: JournalWaypoint[];
  /** Draw the connecting route line between waypoints (default true). */
  showRouteLine?: boolean;
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
          ringColor={w.ringColor}
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
  expandable = true,
  tripAlbumPhotos = [],
  liveLocation = false,
  catchWaypoints,
  showRouteLine = true,
}: Props) {
  const basemapId = useMapBasemapStore((s) => s.basemapId);
  const albumPhotoUrlsByCatchId = useMemo(
    () => buildAlbumPhotoUrlsByCatchId(tripAlbumPhotos),
    [tripAlbumPhotos],
  );
  const rawMod = useMemo(() => loadMapbox(), []);
  /** Style layer id for PointAnnotation bitmaps — insert route line below this so pins paint on top. */
  const pointAnnotationLayerBelowId = useMemo(() => getAnnotationsLayerID('PointAnnotations'), []);
  const tokenApplied = useRef(false);
  const cameraRef = useRef<
    | (CameraControl & {
        fitBounds?: (
          ne: [number, number],
          sw: [number, number],
          padding?: number | number[],
          duration?: number,
        ) => void;
      })
    | null
  >(null);
  /** Fullscreen modal mounts its own Camera; track it so the locate button works there too. */
  const fullscreenCameraRef = useRef<CameraControl | null>(null);
  const [locating, setLocating] = useState(false);
  /** Reveal the location puck after a successful locate. */
  const [locatedOnce, setLocatedOnce] = useState(false);

  const handleLocate = useCallback(async (mode: ExpandableMapMode) => {
    const camera = mode === 'fullscreen' ? fullscreenCameraRef.current : cameraRef.current;
    setLocating(true);
    try {
      const ok = await flyCameraToUserLocation(camera);
      if (ok) setLocatedOnce(true);
    } finally {
      setLocating(false);
    }
  }, []);

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
    const base = mergeJournalWaypointsWithPlacement(trip, events, placement, albumPhotoUrlsByCatchId);
    if (!catchWaypoints) return base;
    // Keep the trip's (placement-aware) start/end pins, but swap in the supplied catch set.
    const start = base.find((w) => w.kind === 'start') ?? null;
    const end = base.find((w) => w.kind === 'end') ?? null;
    return [start, ...catchWaypoints, end].filter((w): w is JournalWaypoint => w != null);
  }, [trip, events, placementKind, placementLatitude, placementLongitude, albumPhotoUrlsByCatchId, catchWaypoints]);
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
      MarkerView?: React.ComponentType<Record<string, unknown>>;
      ShapeSource?: React.ComponentType<Record<string, unknown>>;
      LineLayer?: React.ComponentType<Record<string, unknown>>;
      UserLocation?: React.ComponentType<Record<string, unknown>>;
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
    if (!showRouteLine || pathLngLat.length < 2) {
      // No line to draw — skip the Mapbox walking-match network call entirely.
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
  }, [pathLngLat, isPlacing, showRouteLine]);

  const fitCameraToTripStart = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam?.fitBounds) return;
    // Fit every pin (start, all catches, end) so no fish sits off-screen. Single point → tight zoom.
    const pts = waypoints.map((w) => [w.lng, w.lat] as [number, number]);
    if (pts.length === 0) return;
    const [ne, sw] = bboxPaddingFromLngLats(pts, pts.length === 1 ? 0.003 : 0.0015);
    cam.fitBounds(ne, sw, 56, 600);
  }, [waypoints]);

  // Only auto-fit when the actual set of points changes (mode switch, new catch) — not on every
  // group-poll refresh, which would yank the camera back while the user is panning.
  const lastFitSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (isPlacing) return;
    const sig = waypoints.map((w) => `${w.lng.toFixed(5)},${w.lat.toFixed(5)}`).join('|');
    if (sig === lastFitSigRef.current) return;
    lastFitSigRef.current = sig;
    const t = setTimeout(() => fitCameraToTripStart(), 300);
    return () => clearTimeout(t);
  }, [waypoints, fitCameraToTripStart, isPlacing]);

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

  const { MapView, Camera, PointAnnotation, MarkerView, ShapeSource, LineLayer, UserLocation } = mod;
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

  const renderMapBody = (mode: ExpandableMapMode) => (
    <>
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
          ref={mode === 'fullscreen' ? fullscreenCameraRef : cameraRef}
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
        {routeFeature && showRouteLine ? (
          <ShapeSource id="journalTripRoute" shape={routeFeature}>
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
            MarkerView ? (
              <MarkerView
                key={w.id}
                coordinate={[w.lng, w.lat]}
                anchor={{ x: 0.5, y: 0.5 }}
                allowOverlap
                allowOverlapWithPuck
              >
                <JournalCatchMapMarker
                  photoUrl={w.photoUrl}
                  title={w.title}
                  ringColor={w.ringColor}
                  onPress={
                    onCatchWaypointPress && w.catchEventId
                      ? () => onCatchWaypointPress(w.catchEventId!)
                      : undefined
                  }
                />
              </MarkerView>
            ) : (
              <JournalCatchPointAnnotation
                key={w.id}
                w={w}
                PointAnnotation={PointAnnotation}
                onCatchWaypointPress={onCatchWaypointPress}
              />
            )
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
        {(locatedOnce || liveLocation) && UserLocation ? <UserLocation visible /> : null}
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

      <MapBasemapSwitcher compact={mode === 'preview'} />

      <MapLocateButton
        // Opposite the bottom-left basemap switcher.
        side="right"
        bottom={Spacing.lg}
        busy={locating}
        onPress={() => void handleLocate(mode)}
      />
    </>
  );

  if (expandable) {
    return (
      <ExpandableMapFrame enabled previewContainerStyle={[styles.fill, containerStyle]}>
        {({ mode }) => <View style={styles.fill}>{renderMapBody(mode)}</View>}
      </ExpandableMapFrame>
    );
  }

  return <View style={[styles.fill, containerStyle]}>{renderMapBody('preview')}</View>;
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
