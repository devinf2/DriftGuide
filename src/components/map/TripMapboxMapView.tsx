import { MAPBOX_ACCESS_TOKEN, MAPBOX_STYLE_URL } from '@/src/constants/mapbox';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '@/src/constants/mapDefaults';
import { Colors, FontSize, Spacing } from '@/src/constants/theme';
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
    useState,
    type ComponentType,
    type ReactNode,
} from 'react';
import { JournalCatchMapPin } from '@/src/components/map/JournalCatchMapPin';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

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
};

export type TripMapboxMapRef = {
  /**
   * Current viewport from native `getVisibleBounds()` — canonical {@link BoundingBox}
   * for catch queries, offline packs, and Supabase filters (not derived from JS camera events).
   */
  getVisibleRegion: () => Promise<BoundingBox | null>;
};

function roundZoom(z: number): number {
  return Math.round(z * 10) / 10;
}

function clampZoom(z: number): number {
  return Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, z));
}

function TripMapboxMarkerItem({
  m,
  PointAnnotation,
}: {
  m: MapboxMapMarker;
  PointAnnotation: ComponentType<Record<string, unknown>>;
}) {
  const annotRef = useRef<{ refresh?: () => void } | null>(null);
  const isCatchPin = m.catchPhotoUrl !== undefined;
  const inner = isCatchPin ? (
    <JournalCatchMapPin
      photoUrl={m.catchPhotoUrl}
      onImageLoaded={() => annotRef.current?.refresh?.()}
    />
  ) : (
    m.children ?? <MaterialIcons name="place" size={34} color={Colors.primaryLight} />
  );
  return (
    <PointAnnotation
      ref={(r: unknown) => {
        annotRef.current = r as { refresh?: () => void } | null;
      }}
      id={m.id}
      coordinate={m.coordinate}
      title={m.title}
      onSelected={m.onPress ? () => m.onPress?.() : undefined}
    >
      <View collapsable={false} pointerEvents="box-none">
        {inner}
      </View>
    </PointAnnotation>
  );
}

/** Width of one zoom step button (must match `styles.zoomButton`). */
const ZOOM_BUTTON_WIDTH = 44;

/**
 * Place Mapbox attribution (i) just to the left of the +/- stack (bottom-right), same baseline.
 * iOS default already had (i) bottom-right; Android default is bottom-left — we move it for consistency.
 */
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

type TripMapboxMapViewProps = {
  mapStyle?: string;
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
  /** Fired when zoom changes (buttons, pinch, or programmatic) so parents can stay in sync. */
  onZoomLevelChange?: (zoom: number) => void;
  /** Step for +/- controls (one Mapbox zoom level ≈ 2× scale). */
  zoomStep?: number;
  showZoomControls?: boolean;
};

/**
 * Mapbox map: center+zoom only, PointAnnotation pins, optional user location.
 * Ref exposes `getVisibleRegion()` → canonical BoundingBox for data/offline (native bounds).
 */
export const TripMapboxMapView = forwardRef<TripMapboxMapRef, TripMapboxMapViewProps>(
  function TripMapboxMapView(
    {
      mapStyle,
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
      zoomStep = 1,
      showZoomControls = true,
    },
    ref,
  ) {
    const rawMod = useMemo(() => loadMapbox(), []);
    const tokenApplied = useRef(false);
    const mapViewRef = useRef<{
      getVisibleBounds?: () => Promise<[[number, number], [number, number]]>;
    } | null>(null);
    const cameraRef = useRef<{ zoomTo?: (z: number, duration?: number) => void } | null>(null);
    const [liveZoom, setLiveZoom] = useState(() => roundZoom(zoomLevel));

    useEffect(() => {
      setLiveZoom(roundZoom(zoomLevel));
    }, [zoomLevel]);

    const mod = useMemo(() => {
      if (!rawMod) return null;
      const ns = (rawMod.default ?? rawMod) as {
        setAccessToken?: (t: string) => Promise<unknown>;
        MapView?: React.ComponentType<Record<string, unknown>>;
        Camera?: React.ComponentType<Record<string, unknown>>;
        PointAnnotation?: React.ComponentType<Record<string, unknown>>;
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
        const r = roundZoom(z);
        setLiveZoom(r);
        onZoomLevelChange?.(r);
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

    const zoomBy = useCallback(
      (delta: number) => {
        const next = clampZoom(roundZoom(liveZoom + delta));
        cameraRef.current?.zoomTo?.(next, 220);
        reportZoom(next);
      },
      [liveZoom, reportZoom],
    );

    if (!rawMod || !mod) {
      return (
        <View style={[styles.placeholder, containerStyle]}>
          <MaterialIcons name="map" size={48} color={Colors.textTertiary} />
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
          <MaterialIcons name="map" size={48} color={Colors.textTertiary} />
          <Text style={styles.placeholderText}>
            Set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in `.env` for Mapbox (public pk. token).
          </Text>
        </View>
      );
    }

    const { MapView, Camera, PointAnnotation, UserLocation } = mod;
    if (!MapView || !Camera || !PointAnnotation || !UserLocation) {
      return (
        <View style={[styles.placeholder, containerStyle]}>
          <MaterialIcons name="map" size={48} color={Colors.textTertiary} />
          <Text style={styles.placeholderText}>Map components failed to load.</Text>
        </View>
      );
    }

    const defaultSettings = {
      centerCoordinate,
      zoomLevel,
    };

    return (
      <View style={[styles.fill, containerStyle]}>
        <MapView
          ref={mapViewRef}
          style={styles.map}
          styleURL={mapStyle ?? MAPBOX_STYLE_URL}
          compassEnabled={compassEnabled}
          scaleBarEnabled={false}
          logoEnabled
          attributionEnabled
          attributionPosition={mapAttributionBesideZoomControls(showZoomControls)}
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
          {markers.map((m) => (
            <TripMapboxMarkerItem key={m.id} m={m} PointAnnotation={PointAnnotation} />
          ))}
          {showUserLocation ? <UserLocation visible /> : null}
        </MapView>
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
  },
);

const styles = StyleSheet.create({
  fill: { flex: 1 },
  map: { flex: 1 },
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
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
    backgroundColor: Colors.surface,
  },
  placeholderText: {
    marginTop: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
