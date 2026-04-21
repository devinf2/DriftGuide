import { JournalCatchMapPin } from '@/src/components/map/JournalCatchMapPin';
import { MapBasemapSwitcher } from '@/src/components/map/MapBasemapSwitcher';
import { PLAN_TRIP_FAB_MAP_CLEARANCE } from '@/src/constants/mapTabChrome';
import { MAPBOX_ACCESS_TOKEN, mapboxStyleURLForBasemap } from '@/src/constants/mapbox';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '@/src/constants/mapDefaults';
import { FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useMapBasemapStore } from '@/src/stores/mapBasemapStore';
import type { BoundingBox } from '@/src/types/boundingBox';
import { boundingBoxFromLngLatPair } from '@/src/types/boundingBox';
import type { MapCameraStatePayload } from '@/src/utils/mapViewport';
import { isRnMapboxNativeLinked } from '@/src/utils/rnmapboxNative';
import { MaterialIcons } from '@expo/vector-icons';
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    type ComponentType,
    type ReactElement,
    type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export type MapboxMapMarker = {
  id: string;
  coordinate: [number, number];
  title?: string;
  children?: ReactNode;
  /** Native tap → `PointAnnotation.onSelected` */
  onPress?: () => void;
  /**
   * When set (including `null`), renders a catch pin — circular photo or fish icon — instead of `children`.
   */
  catchPhotoUrl?: string | null;
  /**
   * View annotation instead of bitmap `PointAnnotation` — use for vector icons (e.g. Ionicons).
   * Journal catch pins stay on `PointAnnotation` for performance unless you set this.
   */
  useMarkerView?: boolean;
};

export type TripMapboxMapRef = {
  /**
   * Current viewport from native `getVisibleBounds()` — canonical {@link BoundingBox}
   * for catch queries, offline packs, and Supabase filters (not derived from JS camera events).
   */
  getVisibleRegion: () => Promise<BoundingBox | null>;
  /**
   * Animate the map camera to `[lng, lat]` + zoom. Use when React `centerCoordinate` / remount
   * alone does not move the native camera (e.g. Mapbox `Camera` only had `defaultSettings`).
   */
  easeToCenter: (centerCoordinate: [number, number], zoomLevel: number) => void;
};

function roundZoom(z: number): number {
  return Math.round(z * 10) / 10;
}

/**
 * Stacked pins at the same map coordinate (e.g. parent waterbody + child access point) can all
 * receive a single tap from native; only the first JS handler should run. Scoped per-coordinate
 * so tapping another pin immediately still works.
 */
const MARKER_PRESS_LOCK_MS = 450;
const MARKER_COORD_LOCK_EPS = 1e-5;

let lastMarkerPress: { lng: number; lat: number; t: number } | null = null;

function runMarkerPressOnce(coordinate: [number, number], handler: () => void) {
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const [lng, lat] = coordinate;
  if (
    lastMarkerPress &&
    t < lastMarkerPress.t + MARKER_PRESS_LOCK_MS &&
    Math.abs(lat - lastMarkerPress.lat) < MARKER_COORD_LOCK_EPS &&
    Math.abs(lng - lastMarkerPress.lng) < MARKER_COORD_LOCK_EPS
  ) {
    return;
  }
  lastMarkerPress = { lng, lat, t };
  handler();
}

function TripMapboxMarkerViewItem({
  m,
  MarkerView,
  styles,
  colors,
}: {
  m: MapboxMapMarker;
  MarkerView: ComponentType<Record<string, unknown>>;
  styles: any;
  colors: ThemeColors;
}) {
  return (
    <MarkerView
      coordinate={m.coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      allowOverlap
      allowOverlapWithPuck
    >
      <Pressable
        onPress={m.onPress ? () => runMarkerPressOnce(m.coordinate, () => m.onPress?.()) : undefined}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={m.title ?? 'Location'}
        style={styles.markerViewPressable}
      >
        {m.children ?? <MaterialIcons name="place" size={16} color={colors.primaryLight} />}
      </Pressable>
    </MarkerView>
  );
}

function TripMapboxMarkerItem({
  m,
  PointAnnotation,
  colors,
}: {
  m: MapboxMapMarker;
  PointAnnotation: ComponentType<Record<string, unknown>>;
  colors: ThemeColors;
}) {
  const annotRef = useRef<{ refresh?: () => void } | null>(null);
  const isCatchPin = m.catchPhotoUrl !== undefined;
  const inner = isCatchPin ? (
    <JournalCatchMapPin
      photoUrl={m.catchPhotoUrl}
      onImageLoaded={() => annotRef.current?.refresh?.()}
    />
  ) : (
    m.children ?? <MaterialIcons name="place" size={34} color={colors.primaryLight} />
  );
  return (
    <PointAnnotation
      ref={(r: unknown) => {
        annotRef.current = r as { refresh?: () => void } | null;
      }}
      id={m.id}
      coordinate={m.coordinate}
      title={m.title}
      onSelected={m.onPress ? () => runMarkerPressOnce(m.coordinate, () => m.onPress?.()) : undefined}
    >
      <View collapsable={false} pointerEvents="box-none">
        {inner}
      </View>
    </PointAnnotation>
  );
}

/** Bottom-right FAB (e.g. add location on Map tab) — width for attribution layout math. */
const TRAILING_FAB_SIZE = 56;

const ZOOM_CLUSTER_GAP = Spacing.sm;

/** Map tab: pull layers + trailing FAB closer to the tab bar (smaller `bottom` = lower on screen). */
const MAP_TAB_RIGHT_CONTROLS_BOTTOM_NUDGE = 20;

/**
 * Map tab: approximate ornament widths for centering attribution (i) left of the Mapbox wordmark.
 * (Native sizes vary slightly by platform.)
 */
const MAP_TAB_ATTRIBUTION_BLOCK = 32;
const MAP_TAB_LOGO_BLOCK = 90;
/** Tight space between attribution (i) and Mapbox wordmark. */
const MAP_TAB_ORNAMENT_GAP = 6;
/**
 * Shared bottom inset for Mapbox (i) + wordmark on the map tab.
 * Same value for both ornaments so the info button lines up with the wordmark on native Mapbox.
 */
const MAP_TAB_MAPBOX_ROW_BOTTOM = Spacing.xs;

/** Mapbox attribution (i): to the left of a trailing FAB on the bottom row when present. */
function resolveAttributionPosition(
  hasTrailingFab: boolean,
  planTripFabClearance: number,
): { bottom: number; right: number } | undefined {
  if (!hasTrailingFab) return undefined;
  const rowBottom = Spacing.lg + planTripFabClearance;
  return {
    bottom: rowBottom,
    right: Spacing.md + TRAILING_FAB_SIZE + ZOOM_CLUSTER_GAP,
  };
}

function loadMapbox(): Record<string, unknown> | null {
  if (!isRnMapboxNativeLinked()) return null;
  try {
    return require('@rnmapbox/maps') as Record<string, unknown>;
  } catch {
    return null;
  }
}

type TripMapboxMapViewProps = {
  mapStyle?: string;
  /** When true (default), shows Terrain / Satellite / Hybrid and uses the persisted basemap unless `mapStyle` is set. */
  showBasemapSwitcher?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  /** Initial / controlled framing: center [lng, lat] + zoom (no bounds). */
  centerCoordinate: [number, number];
  zoomLevel: number;
  /** Change this key (e.g. when jumping to user) to remount Camera defaults. */
  cameraKey?: string;
  markers: MapboxMapMarker[];
  showUserLocation: boolean;
  compassEnabled?: boolean;
  onCameraChanged?: (state: MapCameraStatePayload) => void;
  onMapIdle?: (state: MapCameraStatePayload) => void;
  /** Fired when zoom changes (pinch or programmatic) so parents can stay in sync. */
  onZoomLevelChange?: (zoom: number) => void;
  /**
   * Renders above the bottom safe inset; Mapbox (i) sits to its left when present.
   * Use for e.g. add-location FAB on the Map tab.
   */
  trailingFab?: ReactElement | null;
  /** Extra bottom inset so controls sit above the tab-level plan-trip FAB. */
  reservePlanTripFabSpacing?: boolean;
  /**
   * Map tab only: (i) immediately left of centered Mapbox logo; layers above trailing (+).
   */
  mapTabControlLayout?: boolean;
};

/**
 * Mapbox map: center+zoom only, PointAnnotation pins, optional user location.
 * Ref exposes `getVisibleRegion()` → canonical BoundingBox for data/offline (native bounds).
 */
export const TripMapboxMapView = forwardRef<TripMapboxMapRef, TripMapboxMapViewProps>(
  function TripMapboxMapView(
    {
      mapStyle,
      showBasemapSwitcher = true,
      containerStyle,
      centerCoordinate,
      zoomLevel,
      cameraKey,
      markers,
      showUserLocation,
      compassEnabled = true,
      onCameraChanged,
      onMapIdle,
      onZoomLevelChange,
      trailingFab = null,
      reservePlanTripFabSpacing = false,
      mapTabControlLayout = false,
    },
    ref,
  ) {
    const { colors } = useAppTheme();
    const { width: windowWidth } = useWindowDimensions();
    const styles = useMemo(() => createTripMapboxMapStyles(colors), [colors]);
    const basemapId = useMapBasemapStore((s) => s.basemapId);
    const rawMod = useMemo(() => loadMapbox(), []);
    const tokenApplied = useRef(false);
    const mapViewRef = useRef<{
      getVisibleBounds?: () => Promise<[[number, number], [number, number]]>;
    } | null>(null);
    const cameraRef = useRef<{
      zoomTo?: (z: number, duration?: number) => void;
      setCamera?: (config: {
        type: 'CameraStop';
        centerCoordinate: [number, number];
        zoomLevel: number;
        animationDuration: number;
        animationMode: 'flyTo' | 'easeTo' | 'moveTo';
      }) => void;
    } | null>(null);

    const mod = useMemo(() => {
      if (!rawMod) return null;
      const ns = (rawMod.default ?? rawMod) as {
        setAccessToken?: (t: string) => Promise<unknown>;
        MapView?: React.ComponentType<Record<string, unknown>>;
        Camera?: React.ComponentType<Record<string, unknown>>;
        PointAnnotation?: React.ComponentType<Record<string, unknown>>;
        MarkerView?: React.ComponentType<Record<string, unknown>>;
        UserLocation?: React.ComponentType<Record<string, unknown>>;
      };
      return ns;
    }, [rawMod]);

    useImperativeHandle(
      ref,
      () => ({
        getVisibleRegion: async () => {
          const m = mapViewRef.current;
          if (!m?.getVisibleBounds) return null;
          try {
            const pair = await m.getVisibleBounds();
            return boundingBoxFromLngLatPair(pair[0], pair[1]);
          } catch {
            return null;
          }
        },
        easeToCenter: (centerCoordinate: [number, number], zoom: number) => {
          cameraRef.current?.setCamera?.({
            type: 'CameraStop',
            centerCoordinate,
            zoomLevel: zoom,
            animationDuration: 520,
            animationMode: 'flyTo',
          });
        },
      }),
      [],
    );

    useEffect(() => {
      if (!mod?.setAccessToken || !MAPBOX_ACCESS_TOKEN || tokenApplied.current) return;
      void mod.setAccessToken(MAPBOX_ACCESS_TOKEN).then(() => {
        tokenApplied.current = true;
      });
    }, [mod]);

    const reportZoom = useCallback(
      (z: number) => {
        onZoomLevelChange?.(roundZoom(z));
      },
      [onZoomLevelChange],
    );

    const handleMapIdle = useCallback(
      (state: MapCameraStatePayload) => {
        reportZoom(state.properties.zoom);
        onMapIdle?.(state);
      },
      [onMapIdle, reportZoom],
    );

    const handleCameraChanged = useCallback(
      (state: MapCameraStatePayload) => {
        onCameraChanged?.(state);
      },
      [onCameraChanged],
    );

    const mapTabOrnaments = useMemo(() => {
      if (!mapTabControlLayout) return null;
      const pairWidth = MAP_TAB_ATTRIBUTION_BLOCK + MAP_TAB_ORNAMENT_GAP + MAP_TAB_LOGO_BLOCK;
      const leftAttr = Math.max(Spacing.md, (windowWidth - pairWidth) / 2);
      const leftLogo = leftAttr + MAP_TAB_ATTRIBUTION_BLOCK + MAP_TAB_ORNAMENT_GAP;
      return {
        attributionPosition: { bottom: MAP_TAB_MAPBOX_ROW_BOTTOM, left: leftAttr } as const,
        logoPosition: { bottom: MAP_TAB_MAPBOX_ROW_BOTTOM, left: leftLogo } as const,
      };
    }, [mapTabControlLayout, windowWidth]);

    if (!rawMod || !mod) {
      return (
        <View style={[styles.placeholder, containerStyle]}>
          <MaterialIcons name="map" size={48} color={colors.textTertiary} />
          <Text style={styles.placeholderText}>
            Mapbox needs a dev build with native Mapbox (Expo Go does not include it). Prebuild and run on a
            device/simulator, or use EAS Build.
          </Text>
        </View>
      );
    }

    if (!MAPBOX_ACCESS_TOKEN) {
      return (
        <View style={[styles.placeholder, containerStyle]}>
          <MaterialIcons name="map" size={48} color={colors.textTertiary} />
          <Text style={styles.placeholderText}>
            Set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in `.env` for Mapbox (public pk. token).
          </Text>
        </View>
      );
    }

    const { MapView, Camera, PointAnnotation, MarkerView, UserLocation } = mod;
    if (!MapView || !Camera || !PointAnnotation || !UserLocation) {
      return (
        <View style={[styles.placeholder, containerStyle]}>
          <MaterialIcons name="map" size={48} color={colors.textTertiary} />
          <Text style={styles.placeholderText}>Map components failed to load.</Text>
        </View>
      );
    }

    const defaultSettings = {
      centerCoordinate,
      zoomLevel,
    };

    const hasTrailingFab = trailingFab != null;
    const planTripFabClearance = reservePlanTripFabSpacing ? PLAN_TRIP_FAB_MAP_CLEARANCE : 0;
    const mapTabRightStackNudge =
      mapTabControlLayout && reservePlanTripFabSpacing ? MAP_TAB_RIGHT_CONTROLS_BOTTOM_NUDGE : 0;
    const trailingFabBottom = Spacing.lg + planTripFabClearance - mapTabRightStackNudge;

    /** Map tab: layers sit above the trailing (+) FAB when present; else bottom-right above plan-trip FAB only. */
    const layersFabBottom =
      mapTabControlLayout && showBasemapSwitcher && mapStyle == null
        ? trailingFabBottom +
          (hasTrailingFab ? TRAILING_FAB_SIZE + ZOOM_CLUSTER_GAP : 0)
        : undefined;

    const resolvedStyleURL = mapStyle ?? mapboxStyleURLForBasemap(basemapId);
    const showBasemap = showBasemapSwitcher && mapStyle == null;

    return (
      <View style={[styles.fill, containerStyle]}>
        <MapView
          ref={mapViewRef}
          style={styles.map}
          styleURL={resolvedStyleURL}
          compassEnabled={compassEnabled}
          scaleBarEnabled={false}
          logoEnabled
          attributionEnabled
          attributionPosition={
            mapTabOrnaments
              ? mapTabOrnaments.attributionPosition
              : resolveAttributionPosition(hasTrailingFab, planTripFabClearance)
          }
          logoPosition={mapTabOrnaments?.logoPosition}
          onCameraChanged={
            onCameraChanged
              ? (state: unknown) => handleCameraChanged(state as MapCameraStatePayload)
              : undefined
          }
          onMapIdle={(state: unknown) => handleMapIdle(state as MapCameraStatePayload)}
        >
          <Camera
            ref={cameraRef}
            key={cameraKey ?? `${centerCoordinate[0]},${centerCoordinate[1]},${zoomLevel}`}
            defaultSettings={defaultSettings}
            minZoomLevel={MAP_MIN_ZOOM}
            maxZoomLevel={MAP_MAX_ZOOM}
          />
          {markers.map((m) =>
            m.useMarkerView && MarkerView ? (
              <TripMapboxMarkerViewItem key={m.id} m={m} MarkerView={MarkerView} styles={styles} colors={colors} />
            ) : (
              <TripMapboxMarkerItem key={m.id} m={m} PointAnnotation={PointAnnotation} colors={colors} />
            ),
          )}
          {showUserLocation ? <UserLocation visible /> : null}
        </MapView>
        {showBasemap ? (
          <MapBasemapSwitcher
            anchor={mapTabControlLayout ? 'bottomRight' : 'bottomLeft'}
            anchorBottom={layersFabBottom}
          />
        ) : null}
        {trailingFab ? (
          <View
            style={[styles.trailingFabAnchor, { bottom: trailingFabBottom }]}
            pointerEvents="box-none"
          >
            {trailingFab}
          </View>
        ) : null}
      </View>
    );
  },
);

function createTripMapboxMapStyles(colors: ThemeColors) {
  return StyleSheet.create({
    fill: { flex: 1 },
    map: { flex: 1 },
    markerViewPressable: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    trailingFabAnchor: {
      position: 'absolute',
      right: Spacing.md,
    },
    placeholder: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.xl,
      backgroundColor: colors.surface,
    },
    placeholderText: {
      marginTop: Spacing.md,
      fontSize: FontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
    },
  });
}
