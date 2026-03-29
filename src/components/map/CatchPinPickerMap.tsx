import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { MapBasemapSwitcher } from '@/src/components/map/MapBasemapSwitcher';
import { MAPBOX_ACCESS_TOKEN, mapboxStyleURLForBasemap } from '@/src/constants/mapbox';
import { useMapBasemapStore } from '@/src/stores/mapBasemapStore';
import { DEFAULT_MAP_CENTER, MAP_MAX_ZOOM, MAP_MIN_ZOOM, USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { Colors, FontSize, Spacing } from '@/src/constants/theme';
import type { Feature, Point } from 'geojson';
import type { MapCameraStatePayload } from '@/src/utils/mapViewport';
import { isRnMapboxNativeLinked } from '@/src/utils/rnmapboxNative';
import { MaterialIcons } from '@expo/vector-icons';

type ScreenPointPayload = { screenPointX: number; screenPointY: number };
type PointFeature = Feature<Point, ScreenPointPayload>;

const ZOOM_BUTTON_WIDTH = 44;

function roundZoom(z: number): number {
  return Math.round(z * 10) / 10;
}

function clampZoom(z: number): number {
  return Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, z));
}

function mapAttributionBesideZoomControls(
  showZoomControls: boolean,
): { bottom: number; right: number } | undefined {
  if (!showZoomControls) return undefined;
  return {
    bottom: Spacing.lg,
    right: Spacing.md + ZOOM_BUTTON_WIDTH + Spacing.sm,
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
  /** Mapbox-style +/- zoom (uses camera ref); good for pan-center pin picking. */
  showZoomControls?: boolean;
  zoomStep?: number;
  /** Fixed style; when set, hides the basemap switcher. */
  mapStyle?: string;
  showBasemapSwitcher?: boolean;
};

/**
 * Compact Mapbox map: tap/drag pin, or pan-under-center-pin mode for editing.
 */
const DEFAULT_PIN_HINT =
  'Drag the pin or tap the map to set where this fish was caught.';

const DEFAULT_PAN_HINT = 'Pan and zoom the map to place the catch. The pin stays in the center.';

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
  showZoomControls = false,
  zoomStep = 1,
  mapStyle: mapStyleProp,
  showBasemapSwitcher = true,
}: CatchPinPickerMapProps) {
  const basemapId = useMapBasemapStore((s) => s.basemapId);
  const tokenApplied = useRef(false);
  const cameraRef = useRef<{ zoomTo?: (z: number, duration?: number) => void } | null>(null);
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

  const [liveZoom, setLiveZoom] = useState(() => roundZoom(zoom));
  useEffect(() => {
    setLiveZoom(roundZoom(zoom));
  }, [zoom, cameraKey]);

  const resolvedHint =
    hintText ?? (isPanCenter ? DEFAULT_PAN_HINT : DEFAULT_PIN_HINT);

  const handleCameraChanged = useCallback(
    (state: unknown) => {
      const s = state as MapCameraStatePayload;
      if (showZoomControls && typeof s.properties?.zoom === 'number') {
        setLiveZoom(roundZoom(s.properties.zoom));
      }
      if (!isPanCenter) return;
      const c = s.properties?.center;
      if (!Array.isArray(c) || c.length < 2) return;
      const lng = c[0];
      const lat = c[1];
      if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
        onCoordinateChange(lat, lng);
      }
    },
    [isPanCenter, onCoordinateChange, showZoomControls],
  );

  const zoomBy = useCallback(
    (delta: number) => {
      const next = clampZoom(roundZoom(liveZoom + delta));
      cameraRef.current?.zoomTo?.(next, 220);
      setLiveZoom(next);
    },
    [liveZoom],
  );

  const fallbackSize =
    height !== undefined ? { height } : { flex: 1 as const, minHeight: 200 };

  if (!rawMod || !mod?.MapView || !mod.Camera || !mod.PointAnnotation) {
    return (
      <View style={[styles.fallback, fallbackSize, containerStyle]}>
        <MaterialIcons name="map" size={32} color={Colors.textTertiary} />
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
        attributionPosition={mapAttributionBesideZoomControls(showZoomControls)}
        onPress={isPanCenter ? undefined : onMapPress}
        onCameraChanged={
          isPanCenter || showZoomControls ? (e: unknown) => handleCameraChanged(e) : undefined
        }
      >
        <Camera
          ref={cameraRef}
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
              <MaterialIcons name="place" size={36} color={Colors.primaryLight} />
            </View>
          </PointAnnotation>
        ) : null}
      </MapView>
      {isPanCenter ? (
        <View style={styles.centerPinOverlay} pointerEvents="none">
          <View style={styles.centerPinInner}>
            <MaterialIcons name="place" size={44} color={Colors.primaryLight} style={styles.centerPinIcon} />
          </View>
        </View>
      ) : null}
      {showBasemap ? <MapBasemapSwitcher compact /> : null}
      {showZoomControls ? (
        <View style={styles.zoomCluster} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom in"
            style={({ pressed }) => [styles.zoomButton, pressed && styles.zoomButtonPressed]}
            onPress={() => zoomBy(zoomStep)}
            disabled={liveZoom >= MAP_MAX_ZOOM - 0.01}
          >
            <MaterialIcons name="add" size={22} color={Colors.text} />
          </Pressable>
          <View style={styles.zoomDivider} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom out"
            style={({ pressed }) => [styles.zoomButton, pressed && styles.zoomButtonPressed]}
            onPress={() => zoomBy(-zoomStep)}
            disabled={liveZoom <= MAP_MIN_ZOOM + 0.01}
          >
            <MaterialIcons name="remove" size={22} color={Colors.text} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const wrapStyle =
    height !== undefined
      ? [styles.wrap, { height }, containerStyle]
      : [styles.wrap, styles.wrapFlex, containerStyle];

  return (
    <View style={wrapStyle}>
      {hintPosition === 'above' ? <Text style={styles.hint}>{resolvedHint}</Text> : null}
      {mapBody}
      {hintPosition === 'below' ? <Text style={[styles.hint, styles.hintBelow]}>{resolvedHint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  mapBox: {
    flex: 1,
    minHeight: 120,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.borderLight,
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
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fallbackText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.sm,
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
    width: ZOOM_BUTTON_WIDTH,
    height: ZOOM_BUTTON_WIDTH,
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
});
