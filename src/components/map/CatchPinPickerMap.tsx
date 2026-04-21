import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { MapBasemapSwitcher } from '@/src/components/map/MapBasemapSwitcher';
import { MAPBOX_ACCESS_TOKEN, mapboxStyleURLForBasemap } from '@/src/constants/mapbox';
import { useMapBasemapStore } from '@/src/stores/mapBasemapStore';
import { DEFAULT_MAP_CENTER, MAP_MAX_ZOOM, MAP_MIN_ZOOM, USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { Feature, Point } from 'geojson';
import type { MapCameraStatePayload } from '@/src/utils/mapViewport';
import { isRnMapboxNativeLinked } from '@/src/utils/rnmapboxNative';
import { MaterialIcons } from '@expo/vector-icons';

type ScreenPointPayload = { screenPointX: number; screenPointY: number };
type PointFeature = Feature<Point, ScreenPointPayload>;

const MARKER_PRESS_LOCK_MS = 450;
const MARKER_COORD_LOCK_EPS = 1e-5;
let lastCatalogPinPress: { lng: number; lat: number; t: number } | null = null;

function runCatalogPinPressOnce(coordinate: [number, number], handler: () => void) {
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const [lng, lat] = coordinate;
  if (
    lastCatalogPinPress &&
    t < lastCatalogPinPress.t + MARKER_PRESS_LOCK_MS &&
    Math.abs(lat - lastCatalogPinPress.lat) < MARKER_COORD_LOCK_EPS &&
    Math.abs(lng - lastCatalogPinPress.lng) < MARKER_COORD_LOCK_EPS
  ) {
    return;
  }
  lastCatalogPinPress = { lng, lat, t };
  handler();
}

export type CatchPinCatalogMarker = {
  id: string;
  latitude: number;
  longitude: number;
  name?: string;
  isFavorite?: boolean;
};

function loadMapbox(): Record<string, unknown> | null {
  if (!isRnMapboxNativeLinked()) return null;
  try {
    return require('@rnmapbox/maps') as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type CatchPinInteractionMode = 'tap_or_drag_pin' | 'pan_center';

export type CatchPinPickerMapProps = {
  latitude: number | null;
  longitude: number | null;
  onCoordinateChange: (lat: number, lng: number) => void;
  /** Map container height */
  height?: number;
  containerStyle?: StyleProp<ViewStyle>;
  /** Override default instruction text */
  hintText?: string;
  /** Where to show the hint relative to the map */
  hintPosition?: 'above' | 'below';
  /**
   * `tap_or_drag_pin` — tap map or drag the pin.
   * `pan_center` — pin fixed at center; pan/zoom the map to choose coordinates (good for editing).
   */
  interactionMode?: CatchPinInteractionMode;
  /**
   * When this value changes, the camera recenters on `latitude`/`longitude` (or `mapFallbackCenter`).
   * Use after typing coordinates or when opening an edit form.
   */
  focusRequestKey?: string | number;
  /** [lng, lat] for initial camera when pin coordinates are missing */
  mapFallbackCenter?: [number, number];
  /** Fixed style; when set, hides the basemap switcher. */
  mapStyle?: string;
  showBasemapSwitcher?: boolean;
  /** When false, hides the caption above/below the map. */
  showHint?: boolean;
  /** Catalog / nearby water pins (tap to select). Shown under the center pin in pan_center mode. */
  catalogMarkers?: CatchPinCatalogMarker[];
  onCatalogMarkerPress?: (id: string) => void;
  /** Highlights a catalog pin after selection (optional). */
  selectedCatalogMarkerId?: string | null;
};

/**
 * Compact Mapbox map: tap/drag pin, or pan-under-center-pin mode for editing.
 */
const DEFAULT_PIN_HINT =
  'Drag the pin or tap the map to set where this fish was caught.';

const DEFAULT_PAN_HINT = 'Pan and zoom the map to place the catch. The pin stays in the center.';

function createCatchPinPickerStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      marginBottom: Spacing.md,
    },
    wrapFlex: {
      flex: 1,
      minHeight: 200,
      marginBottom: 0,
    },
    mapBodyFixed: {
      flex: 1,
      minHeight: 0,
    },
    mapBodyFlex: {
      flex: 1,
      minHeight: 160,
    },
    hint: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
    },
    mapBox: {
      flex: 1,
      minHeight: 120,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: colors.borderLight,
      position: 'relative',
    },
    centerPinOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
    },
    centerPinInner: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    /** Pin icon tip ~bottom center; shift up so the tip marks the map center */
    centerPinIcon: {
      transform: [{ translateY: -20 }],
    },
    hintBelow: {
      marginTop: Spacing.sm,
      marginBottom: 0,
    },
    fallback: {
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.md,
      backgroundColor: colors.background,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    fallbackText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: Spacing.sm,
    },
  });
}

export function CatchPinPickerMap({
  latitude,
  longitude,
  onCoordinateChange,
  height,
  containerStyle,
  hintText,
  hintPosition = 'above',
  interactionMode = 'tap_or_drag_pin',
  focusRequestKey = '0',
  mapFallbackCenter,
  mapStyle: mapStyleProp,
  showBasemapSwitcher = true,
  showHint = true,
  catalogMarkers,
  onCatalogMarkerPress,
  selectedCatalogMarkerId = null,
}: CatchPinPickerMapProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createCatchPinPickerStyles(colors), [colors]);
  const basemapId = useMapBasemapStore((s) => s.basemapId);
  const tokenApplied = useRef(false);
  const rawMod = useMemo(() => loadMapbox(), []);

  const mod = useMemo(() => {
    if (!rawMod) return null;
    const ns = (rawMod.default ?? rawMod) as {
      setAccessToken?: (t: string) => Promise<unknown>;
      MapView?: React.ComponentType<Record<string, unknown>>;
      Camera?: React.ComponentType<Record<string, unknown>>;
      PointAnnotation?: React.ComponentType<Record<string, unknown>>;
    };
    return ns;
  }, [rawMod]);

  useEffect(() => {
    if (!mod?.setAccessToken || !MAPBOX_ACCESS_TOKEN || tokenApplied.current) return;
    void mod.setAccessToken(MAPBOX_ACCESS_TOKEN).then(() => {
      tokenApplied.current = true;
    });
  }, [mod]);

  const resolvedCenter: [number, number] = useMemo(() => {
    if (latitude != null && longitude != null) return [longitude, latitude];
    if (mapFallbackCenter) return mapFallbackCenter;
    return DEFAULT_MAP_CENTER;
  }, [latitude, longitude, mapFallbackCenter]);

  const zoom =
    (latitude != null && longitude != null) || mapFallbackCenter != null ? USER_LOCATION_ZOOM : 10;
  const hasPin = latitude != null && longitude != null;
  const isPanCenter = interactionMode === 'pan_center';
  const cameraKey = isPanCenter ? `pan-${focusRequestKey}` : `${resolvedCenter[0]},${resolvedCenter[1]},${zoom}`;

  const resolvedHint =
    hintText ?? (isPanCenter ? DEFAULT_PAN_HINT : DEFAULT_PIN_HINT);

  const handleCameraChanged = useCallback(
    (state: unknown) => {
      if (!isPanCenter) return;
      const s = state as MapCameraStatePayload;
      const c = s.properties?.center;
      if (!Array.isArray(c) || c.length < 2) return;
      const lng = c[0];
      const lat = c[1];
      if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
        onCoordinateChange(lat, lng);
      }
    },
    [isPanCenter, onCoordinateChange],
  );

  const fallbackSize =
    height !== undefined ? { height } : { flex: 1 as const, minHeight: 200 };

  if (!rawMod || !mod?.MapView || !mod.Camera || !mod.PointAnnotation) {
    return (
      <View style={[styles.fallback, fallbackSize, containerStyle]}>
        <MaterialIcons name="map" size={32} color={colors.textTertiary} />
        <Text style={styles.fallbackText}>
          Map preview needs a dev build with Mapbox. Use latitude/longitude fields below, or build the app with
          @rnmapbox/maps linked.
        </Text>
      </View>
    );
  }

  if (!MAPBOX_ACCESS_TOKEN) {
    return (
      <View style={[styles.fallback, fallbackSize, containerStyle]}>
        <Text style={styles.fallbackText}>Set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN for the map.</Text>
      </View>
    );
  }

  const { MapView, Camera, PointAnnotation } = mod;

  const onMapPress = (feature: PointFeature) => {
    if (isPanCenter) return;
    const g = feature.geometry;
    if (g?.type !== 'Point' || !g.coordinates?.length) return;
    const [lng, lat] = g.coordinates;
    if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
      onCoordinateChange(lat, lng);
    }
  };

  const onDragEnd = (feature: PointFeature) => {
    const g = feature.geometry;
    if (g?.type !== 'Point' || !g.coordinates?.length) return;
    const [lng, lat] = g.coordinates;
    if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
      onCoordinateChange(lat, lng);
    }
  };

  const resolvedStyleURL = mapStyleProp ?? mapboxStyleURLForBasemap(basemapId);
  const showBasemap = showBasemapSwitcher && mapStyleProp == null;

  const mapBody = (
    <View style={height === undefined ? styles.mapBodyFlex : styles.mapBodyFixed}>
      <MapView
        style={StyleSheet.absoluteFill}
        styleURL={resolvedStyleURL}
        compassEnabled={false}
        scaleBarEnabled={false}
        logoEnabled
        attributionEnabled
        onPress={isPanCenter ? undefined : onMapPress}
        onCameraChanged={isPanCenter ? (e: unknown) => handleCameraChanged(e) : undefined}
      >
        <Camera
          key={cameraKey}
          defaultSettings={{ centerCoordinate: resolvedCenter, zoomLevel: zoom }}
          minZoomLevel={MAP_MIN_ZOOM}
          maxZoomLevel={MAP_MAX_ZOOM}
        />
        {!isPanCenter && hasPin ? (
          <PointAnnotation
            id="catch-pin"
            coordinate={[longitude!, latitude!]}
            draggable
            onDragEnd={onDragEnd}
          >
            <View collapsable={false} pointerEvents="box-none">
              <MaterialIcons name="place" size={36} color={colors.primaryLight} />
            </View>
          </PointAnnotation>
        ) : null}
        {catalogMarkers && catalogMarkers.length > 0 && onCatalogMarkerPress
          ? catalogMarkers.map((p) => {
              const selected = selectedCatalogMarkerId === p.id;
              const coordPair: [number, number] = [p.longitude, p.latitude];
              const title = p.name ?? 'Location';
              const inner: ReactNode = (
                <MaterialIcons
                  name={p.isFavorite ? 'favorite' : 'place'}
                  size={selected ? 30 : 24}
                  color={selected ? colors.success : colors.textSecondary}
                />
              );
              return (
                <PointAnnotation
                  key={`cat-${p.id}`}
                  id={`catalog-loc-${p.id}`}
                  coordinate={coordPair}
                  title={title}
                  onSelected={() =>
                    runCatalogPinPressOnce(coordPair, () => onCatalogMarkerPress(p.id))
                  }
                >
                  <View collapsable={false} pointerEvents="box-none">
                    {inner}
                  </View>
                </PointAnnotation>
              );
            })
          : null}
      </MapView>
      {isPanCenter ? (
        <View style={styles.centerPinOverlay} pointerEvents="none">
          <View style={styles.centerPinInner}>
            <MaterialIcons name="place" size={44} color={colors.primaryLight} style={styles.centerPinIcon} />
          </View>
        </View>
      ) : null}
      {showBasemap ? <MapBasemapSwitcher compact /> : null}
    </View>
  );

  const wrapStyle =
    height !== undefined
      ? [styles.wrap, { height }, containerStyle]
      : [styles.wrap, styles.wrapFlex, containerStyle];

  return (
    <View style={wrapStyle}>
      {showHint && hintPosition === 'above' ? <Text style={styles.hint}>{resolvedHint}</Text> : null}
      {mapBody}
      {showHint && hintPosition === 'below' ? <Text style={[styles.hint, styles.hintBelow]}>{resolvedHint}</Text> : null}
    </View>
  );
}
