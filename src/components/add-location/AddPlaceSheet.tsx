import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { MapboxGeocodeFeature } from '@/src/services/mapboxGeocoding';
import type { Location, LocationType } from '@/src/types';
import { AddLocationMapSheet } from './AddLocationMapSheet';
import { AddBusinessMapSheet } from './AddBusinessMapSheet';
import { AddTypeRail, type PlaceKind } from './AddTypeRail';
import { WaterPickerSheet } from './WaterPickerSheet';

const WATER_TYPES: LocationType[] = ['river', 'stream', 'lake', 'reservoir', 'pond'];
function isWaterType(t: PlaceKind | null): t is LocationType {
  return t != null && WATER_TYPES.includes(t as LocationType);
}
/** Access point + parking are children that must hang off a water. */
function isChildType(t: PlaceKind | null): t is LocationType {
  return t === 'access_point' || t === 'parking';
}

function kindLabel(kind: PlaceKind): string {
  switch (kind) {
    case 'river': return 'River';
    case 'stream': return 'Stream';
    case 'lake': return 'Lake';
    case 'reservoir': return 'Reservoir';
    case 'pond': return 'Pond';
    case 'access_point': return 'Access point';
    case 'parking': return 'Parking';
    case 'business': return 'Business';
    default: return 'Location';
  }
}

type Props = {
  visible: boolean;
  pinLatitude: number;
  pinLongitude: number;
  catalogLocations: Location[];
  geocodeProximity: [number, number];
  onApplyGeocodeFeature: (feature: MapboxGeocodeFeature) => void;
  onSelectCatalogLocation: (location: Location) => void;
  onRequestClose: () => void;
  onSheetHeightChange?: (height: number) => void;
  onMapInteractionBlockedChange?: (blocked: boolean) => void;
  onSavedLocation: (locationId: string) => void;
  onSavedBusiness: (businessId: string) => void;
};

/**
 * Add-a-place orchestrator. After the user long-presses to drop a pin, this walks them
 * through: pick a type (right-side {@link AddTypeRail}) → fill the matching form. Access
 * points must hang off a water — they pick one ({@link WaterPickerSheet}) or create it
 * inline first, then continue. Waters dedupe by name so we don't get duplicate rivers.
 */
export function AddPlaceSheet({
  visible,
  pinLatitude,
  pinLongitude,
  catalogLocations,
  geocodeProximity,
  onApplyGeocodeFeature,
  onSelectCatalogLocation,
  onRequestClose,
  onSheetHeightChange,
  onMapInteractionBlockedChange,
  onSavedLocation,
  onSavedBusiness,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [kind, setKind] = useState<PlaceKind | null>(null);
  const [parentWater, setParentWater] = useState<{ id: string; name: string } | null>(null);
  // While adding a child (access/parking) and creating its missing water inline.
  const [creatingWaterInline, setCreatingWaterInline] = useState(false);
  const wasVisibleRef = useRef(false);

  // Reset the wizard whenever it opens fresh.
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setKind(null);
      setParentWater(null);
      setCreatingWaterInline(false);
    }
    wasVisibleRef.current = visible;
  }, [visible]);

  // Rail-only (no form mounted) → tell the map not to shrink for a sheet.
  const showRail = visible && kind == null;
  useEffect(() => {
    if (showRail) onSheetHeightChange?.(0);
  }, [showRail, onSheetHeightChange]);

  const resetToRail = useCallback(() => {
    setKind(null);
    setParentWater(null);
    setCreatingWaterInline(false);
  }, []);

  const backButton = useCallback(
    (label: string) => (
      <Pressable
        style={styles.backBtn}
        onPress={resetToRail}
        accessibilityRole="button"
        accessibilityLabel="Change type"
      >
        <Ionicons name="chevron-back" size={18} color={colors.primary} />
        <Text style={styles.backBtnText}>{label}</Text>
      </Pressable>
    ),
    [styles, resetToRail, colors.primary],
  );

  const handleSelectKind = useCallback((k: PlaceKind) => {
    setKind(k);
    setParentWater(null);
    setCreatingWaterInline(false);
  }, []);

  if (!visible) return null;

  // Step 1 — pick a type.
  if (kind == null) {
    return <AddTypeRail onSelect={handleSelectKind} onCancel={onRequestClose} />;
  }

  // Business.
  if (kind === 'business') {
    return (
      <AddBusinessMapSheet
        visible
        pinLatitude={pinLatitude}
        pinLongitude={pinLongitude}
        geocodeProximity={geocodeProximity}
        onApplyGeocodeFeature={onApplyGeocodeFeature}
        onRequestClose={resetToRail}
        onSheetHeightChange={onSheetHeightChange}
        onSaved={onSavedBusiness}
        kindSelector={backButton('Business')}
      />
    );
  }

  // Access point / parking with no water yet → pick or create one.
  if (isChildType(kind) && !parentWater && !creatingWaterInline) {
    return (
      <WaterPickerSheet
        pinLatitude={pinLatitude}
        pinLongitude={pinLongitude}
        catalogLocations={catalogLocations}
        childLabel={kindLabel(kind)}
        onSelect={(water) => setParentWater({ id: water.id, name: water.name })}
        onCreateNew={() => setCreatingWaterInline(true)}
        onBack={resetToRail}
        onSheetHeightChange={onSheetHeightChange}
      />
    );
  }

  // Inline water creation for a child: create the water, then continue to the child form.
  if (isChildType(kind) && creatingWaterInline) {
    return (
      <AddLocationMapSheet
        visible
        waterOnly
        pinLatitude={pinLatitude}
        pinLongitude={pinLongitude}
        catalogLocations={catalogLocations}
        geocodeProximity={geocodeProximity}
        onApplyGeocodeFeature={onApplyGeocodeFeature}
        onSelectCatalogLocation={onSelectCatalogLocation}
        onPickExistingWater={(water) => {
          setParentWater({ id: water.id, name: water.name });
          setCreatingWaterInline(false);
        }}
        onRequestClose={() => setCreatingWaterInline(false)}
        onSheetHeightChange={onSheetHeightChange}
        onMapInteractionBlockedChange={onMapInteractionBlockedChange}
        onCommitted={(loc) => {
          setParentWater({ id: loc.id, name: loc.name });
          setCreatingWaterInline(false);
        }}
        kindSelector={backButton('New water')}
      />
    );
  }

  // Water creation, or a child under its chosen water.
  const presetParent =
    isChildType(kind) && parentWater ? parentWater : null;
  return (
    <AddLocationMapSheet
      visible
      presetType={kind}
      presetParent={presetParent}
      pinLatitude={pinLatitude}
      pinLongitude={pinLongitude}
      catalogLocations={catalogLocations}
      geocodeProximity={geocodeProximity}
      onApplyGeocodeFeature={onApplyGeocodeFeature}
      onSelectCatalogLocation={onSelectCatalogLocation}
      onPickExistingWater={(water) => {
        // Typed name matches an existing water → add an access point to it instead.
        setKind('access_point');
        setParentWater({ id: water.id, name: water.name });
        setCreatingWaterInline(false);
      }}
      onRequestClose={resetToRail}
      onSheetHeightChange={onSheetHeightChange}
      onMapInteractionBlockedChange={onMapInteractionBlockedChange}
      onCommitted={(loc, pending) => {
        // Access points / parking aren't standalone detail pages — just return to the map.
        // Waters open their spot page (unless still pending offline).
        if (isChildType(kind) || pending) {
          onRequestClose();
        } else {
          onSavedLocation(loc.id);
        }
      }}
      kindSelector={backButton(kindLabel(kind))}
    />
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingVertical: Spacing.xs,
      paddingRight: Spacing.sm,
      marginLeft: -4,
    },
    backBtnText: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.primary,
    },
  });
}
