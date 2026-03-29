import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { MAPBOX_BASEMAP_OPTIONS } from '@/src/constants/mapbox';
import { Colors, FontSize, Spacing } from '@/src/constants/theme';
import { useMapBasemapStore } from '@/src/stores/mapBasemapStore';

const FAB_SIZE = 44;
const FAB_SIZE_COMPACT = 40;
const MENU_GAP = 8;

export type MapBasemapSwitcherProps = {
  /** Slightly smaller FAB for small map embeds (e.g. modals). */
  compact?: boolean;
  /** Optional offset when the map already reserves bottom space (rare). */
  containerStyle?: StyleProp<ViewStyle>;
};

/**
 * Layers FAB (bottom-left) opens a short menu: terrain / satellite / hybrid. Persisted via {@link useMapBasemapStore}.
 */
export function MapBasemapSwitcher({ compact, containerStyle }: MapBasemapSwitcherProps) {
  const insets = useSafeAreaInsets();
  const basemapId = useMapBasemapStore((s) => s.basemapId);
  const setBasemapId = useMapBasemapStore((s) => s.setBasemapId);
  const [menuOpen, setMenuOpen] = useState(false);

  const fabSize = compact ? FAB_SIZE_COMPACT : FAB_SIZE;
  const iconSize = compact ? 20 : 22;

  const pick = useCallback(
    (id: (typeof MAPBOX_BASEMAP_OPTIONS)[number]['id']) => {
      setBasemapId(id);
      setMenuOpen(false);
    },
    [setBasemapId],
  );

  const bottom = Spacing.lg + insets.bottom;

  return (
    <>
      {menuOpen ? (
        <Pressable
          style={styles.backdrop}
          onPress={() => setMenuOpen(false)}
          accessibilityLabel="Dismiss map layer menu"
          accessibilityRole="button"
        />
      ) : null}
      <View
        pointerEvents="box-none"
        style={[
          styles.anchor,
          {
            bottom,
            left: Spacing.md,
            zIndex: menuOpen ? 6 : 5,
          },
          containerStyle,
        ]}
      >
        {menuOpen ? (
          <View style={styles.menu} accessibilityRole="menu">
            <Text style={styles.menuTitle}>Map layer</Text>
            {MAPBOX_BASEMAP_OPTIONS.map((opt) => {
              const selected = basemapId === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => pick(opt.id)}
                  style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
                  accessibilityRole="menuitem"
                  accessibilityLabel={opt.label}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.menuRowLabel, selected && styles.menuRowLabelSelected]}>
                    {opt.label}
                  </Text>
                  {selected ? (
                    <MaterialIcons name="check" size={20} color={Colors.primary} />
                  ) : (
                    <View style={styles.checkPlaceholder} />
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {menuOpen ? <View style={{ height: MENU_GAP }} /> : null}
        <Pressable
          onPress={() => setMenuOpen((o) => !o)}
          style={({ pressed }) => [
            styles.fab,
            { width: fabSize, height: fabSize, borderRadius: fabSize / 2 },
            pressed && styles.fabPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Map layers"
          accessibilityState={{ expanded: menuOpen }}
        >
          <MaterialIcons name="layers" size={iconSize} color={Colors.text} />
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  anchor: {
    position: 'absolute',
    alignItems: 'flex-start',
  },
  menu: {
    minWidth: 208,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingVertical: Spacing.xs,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  menuTitle: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xs,
    paddingTop: 2,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
  },
  menuRowPressed: {
    backgroundColor: Colors.borderLight,
  },
  menuRowLabel: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.text,
    fontWeight: '500',
  },
  menuRowLabelSelected: {
    color: Colors.primary,
    fontWeight: '700',
  },
  checkPlaceholder: {
    width: 20,
    height: 20,
  },
  fab: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  fabPressed: {
    opacity: 0.9,
    backgroundColor: Colors.surfaceElevated,
  },
});
