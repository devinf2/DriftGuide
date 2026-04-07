import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Feature, Polygon } from 'geojson';
import { MapBasemapSwitcher } from '@/src/components/map/MapBasemapSwitcher';
import { MAPBOX_ACCESS_TOKEN, mapboxStyleURLForBasemap } from '@/src/constants/mapbox';
import {
  DEFAULT_OFFLINE_REGION_HALF_HEIGHT_KM,
  DEFAULT_OFFLINE_REGION_HALF_WIDTH_KM,
  boundingBoxRectAroundCenter,
} from '@/src/utils/offlineDownloadRegion';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { BoundingBox } from '@/src/types/boundingBox';
import type { MapCameraStatePayload } from '@/src/utils/mapViewport';
import { isRnMapboxNativeLinked } from '@/src/utils/rnmapboxNative';
import { useMapBasemapStore } from '@/src/stores/mapBasemapStore';
import { MaterialIcons } from '@expo/vector-icons';

const ZOOM_BUTTON_WIDTH = 44;

function roundZoom(z: number): number {
  return Math.round(z * 10) / 10;
}

function clampZoom(z: number): number {
  return Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, z));
}

function bboxToPolygonFeature(bbox: BoundingBox): Feature<Polygon> {
  const { ne, sw } = bbox;
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [sw.lng, sw.lat],
          [ne.lng, sw.lat],
          [ne.lng, ne.lat],
          [sw.lng, ne.lat],
          [sw.lng, sw.lat],
        ],
      ],
    },
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

export type OfflineRegionPickerMapProps = {
  initialCenter: [number, number];
  initialZoom?: number;
  /** East–west half-extent from map center (km). */
  halfWidthKm?: number;
  /** North–south half-extent from map center (km). */
  halfHeightKm?: number;
  /**
   * Fit the camera so the full download rectangle is visible (padding for on-map chrome).
   * Turn off if you need a fixed zoom instead.
   */
  frameFullRegionOnMount?: boolean;
  onRegionBboxChange: (bbox: BoundingBox, center: [number, number]) => void;
};

type CameraRef = {
  zoomTo?: (z: number, duration?: number) => void;
  fitBounds?: (
    ne: [number, number],
    sw: [number, number],
    padding?: number | number[],
    duration?: number,
  ) => void;
};

/**
 * Full-screen style map: download rectangle stays centered on the map; bbox follows the camera
 * on every camera change (not only on idle) so it does not lag behind while panning.
 */
export function OfflineRegionPickerMap({
  initialCenter,
  initialZoom = USER_LOCATION_ZOOM,
  halfWidthKm = DEFAULT_OFFLINE_REGION_HALF_WIDTH_KM,
  halfHeightKm = DEFAULT_OFFLINE_REGION_HALF_HEIGHT_KM,
  frameFullRegionOnMount = true,
  onRegionBboxChange,
}: OfflineRegionPickerMapProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createOfflineRegionPickerMapStyles(colors), [colors]);
  const basemapId = useMapBasemapStore((s) => s.basemapId);
  const tokenApplied = useRef(false);
  const cameraRef = useRef<CameraRef | null>(null);
  const rawMod = useMemo(() => loadMapbox(), []);
  /** Reset when framing inputs change; set true after first successful fitBounds. */
  const hasFramedInitialRef = useRef(false);
  const [liveBbox, setLiveBbox] = useState<BoundingBox>(() =>
    boundingBoxRectAroundCenter(
      initialCenter[0],
      initialCenter[1],
      halfWidthKm,
      halfHeightKm,
    ),
  );
  const [liveZoom, setLiveZoom] = useState(() => roundZoom(initialZoom));

  const mod = useMemo(() => {
    if (!rawMod) return null;
    const ns = (rawMod.default ?? rawMod) as {
      setAccessToken?: (t: string) => Promise<unknown>;
      MapView?: React.ComponentType<Record<string, unknown>>;
      Camera?: React.ComponentType<Record<string, unknown>>;
      ShapeSource?: React.ComponentType<Record<string, unknown>>;
      FillLayer?: React.ComponentType<Record<string, unknown>>;
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

  const polygonFeature = useMemo(() => bboxToPolygonFeature(liveBbox), [liveBbox]);

  const onBboxRef = useRef(onRegionBboxChange);
  onBboxRef.current = onRegionBboxChange;

  const fitCameraToBbox = useCallback((bbox: BoundingBox) => {
    const fit = cameraRef.current?.fitBounds;
    if (!fit) return;
    fit(
      [bbox.ne.lng, bbox.ne.lat],
      [bbox.sw.lng, bbox.sw.lat],
      [52, 36, 112, 36],
      0,
    );
  }, []);

  const tryFrameInitialRegion = useCallback(() => {
    if (!frameFullRegionOnMount || hasFramedInitialRef.current) return false;
    if (!cameraRef.current?.fitBounds) return false;
    hasFramedInitialRef.current = true;
    const bbox = boundingBoxRectAroundCenter(
      initialCenter[0],
      initialCenter[1],
      halfWidthKm,
      halfHeightKm,
    );
    requestAnimationFrame(() => fitCameraToBbox(bbox));
    return true;
  }, [
    frameFullRegionOnMount,
    initialCenter,
    halfWidthKm,
    halfHeightKm,
    fitCameraToBbox,
  ]);

  const syncBboxFromCameraState = useCallback(
    (state: MapCameraStatePayload) => {
      const center = state?.properties?.center;
      const z = state?.properties?.zoom;
      if (!center || center.length < 2) return;
      const [lng, lat] = center;
      const bbox = boundingBoxRectAroundCenter(lng, lat, halfWidthKm, halfHeightKm);
      setLiveBbox(bbox);
      onBboxRef.current(bbox, [lng, lat]);
      if (typeof z === 'number') setLiveZoom(roundZoom(z));
    },
    [halfWidthKm, halfHeightKm],
  );

  const handleCameraChanged = useCallback(
    (e: unknown) => {
      syncBboxFromCameraState(e as MapCameraStatePayload);
    },
    [syncBboxFromCameraState],
  );

  const handleMapIdle = useCallback(
    (e: unknown) => {
      if (tryFrameInitialRegion()) {
        return;
      }
      syncBboxFromCameraState(e as MapCameraStatePayload);
    },
    [syncBboxFromCameraState, tryFrameInitialRegion],
  );

  useEffect(() => {
    hasFramedInitialRef.current = false;
    const bbox = boundingBoxRectAroundCenter(
      initialCenter[0],
      initialCenter[1],
      halfWidthKm,
      halfHeightKm,
    );
    setLiveBbox(bbox);
    onBboxRef.current(bbox, initialCenter);
  }, [initialCenter, halfWidthKm, halfHeightKm]);

  const handleDidFinishLoadingStyle = useCallback(() => {
    tryFrameInitialRegion();
  }, [tryFrameInitialRegion]);

  const zoomBy = useCallback(
    (delta: number) => {
      const next = clampZoom(roundZoom(liveZoom + delta));
      cameraRef.current?.zoomTo?.(next, 220);
      setLiveZoom(next);
    },
    [liveZoom],
  );

  if (!rawMod || !mod) {
    return (
      <View style={styles.placeholder}>
        <MaterialIcons name="map" size={48} color={colors.textTertiary} />
        <Text style={styles.placeholderText}>
          Mapbox needs a dev build with native Mapbox (Expo Go does not include it).
        </Text>
      </View>
    );
  }

  if (!MAPBOX_ACCESS_TOKEN) {
    return (
      <View style={styles.placeholder}>
        <MaterialIcons name="map" size={48} color={colors.textTertiary} />
        <Text style={styles.placeholderText}>Set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in `.env`.</Text>
      </View>
    );
  }

  const { MapView, Camera, ShapeSource, FillLayer, LineLayer } = mod;
  if (!MapView || !Camera || !ShapeSource || !FillLayer || !LineLayer) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Map components failed to load.</Text>
      </View>
    );
  }

  const resolvedStyleURL = mapboxStyleURLForBasemap(basemapId);

  return (
    <View style={styles.fill}>
      <MapView
        style={styles.map}
        styleURL={resolvedStyleURL}
        compassEnabled
        scaleBarEnabled={false}
        logoEnabled
        attributionEnabled
        attributionPosition={{ bottom: Spacing.lg, right: Spacing.md + ZOOM_BUTTON_WIDTH + Spacing.sm }}
        onCameraChanged={handleCameraChanged}
        onMapIdle={handleMapIdle}
        onDidFinishLoadingStyle={handleDidFinishLoadingStyle}
      >
        <Camera
          ref={cameraRef}
          key={`${initialCenter[0]},${initialCenter[1]},${halfWidthKm},${halfHeightKm},${initialZoom}`}
          defaultSettings={{
            centerCoordinate: initialCenter,
            zoomLevel: initialZoom,
          }}
          minZoomLevel={MAP_MIN_ZOOM}
          maxZoomLevel={MAP_MAX_ZOOM}
        />
        <ShapeSource id="offlineDownloadRegion" shape={polygonFeature}>
          <FillLayer
            id="offlineRegionFill"
            style={{
              fillColor: colors.primary,
              fillOpacity: 0.12,
            }}
          />
          <LineLayer
            id="offlineRegionLine"
            style={{
              lineColor: colors.primary,
              lineWidth: 2,
              lineOpacity: 0.9,
            }}
          />
        </ShapeSource>
      </MapView>
      <MapBasemapSwitcher />
      <View style={styles.zoomCluster} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom in"
          style={({ pressed }) => [styles.zoomButton, pressed && styles.zoomButtonPressed]}
          onPress={() => zoomBy(1)}
          disabled={liveZoom >= MAP_MAX_ZOOM - 0.01}
        >
          <MaterialIcons name="add" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.zoomDivider} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom out"
          style={({ pressed }) => [styles.zoomButton, pressed && styles.zoomButtonPressed]}
          onPress={() => zoomBy(-1)}
          disabled={liveZoom <= MAP_MIN_ZOOM + 0.01}
        >
          <MaterialIcons name="remove" size={22} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

function createOfflineRegionPickerMapStyles(colors: ThemeColors) {
  return StyleSheet.create({
    fill: { flex: 1 },
    map: { flex: 1 },
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
    zoomCluster: {
      position: 'absolute',
      right: Spacing.md,
      bottom: Spacing.lg + 56,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      elevation: 3,
    },
    zoomButton: {
      width: 44,
      height: 44,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    zoomButtonPressed: { opacity: 0.85, backgroundColor: colors.surfaceElevated },
    zoomDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  });
}
