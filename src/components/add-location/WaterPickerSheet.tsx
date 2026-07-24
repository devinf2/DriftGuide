import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { Location, LocationType } from '@/src/types';
import { haversineDistance } from '@/src/services/locationService';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';

const WATER_TYPES: LocationType[] = ['river', 'stream', 'lake', 'reservoir', 'pond'];

function typeLabel(t: LocationType): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function formatKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

type Props = {
  pinLatitude: number;
  pinLongitude: number;
  catalogLocations: Location[];
  /** e.g. "Access point" — shown in the prompt. */
  childLabel: string;
  onSelect: (water: Location) => void;
  onCreateNew: () => void;
  onBack: () => void;
  onSheetHeightChange?: (height: number) => void;
};

/**
 * Step for adding an access point / parking: pick which water it belongs to. Lists nearby
 * waters (rivers/lakes/…) closest-first, filterable by name, plus a "＋ New water" escape
 * hatch that creates the water inline before continuing.
 */
export function WaterPickerSheet({
  pinLatitude,
  pinLongitude,
  catalogLocations,
  childLabel,
  onSelect,
  onCreateNew,
  onBack,
  onSheetHeightChange,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState('');

  const waters = useMemo(() => {
    const roots = catalogLocations.filter(
      (l) => l.parent_location_id == null && WATER_TYPES.includes(l.type),
    );
    const matched = query.trim().length >= 1 ? filterLocationsByQuery(roots, query) : roots;
    const coordsOk = Number.isFinite(pinLatitude) && Number.isFinite(pinLongitude);
    return matched
      .map((l) => ({
        loc: l,
        km:
          coordsOk && l.latitude != null && l.longitude != null
            ? haversineDistance(pinLatitude, pinLongitude, l.latitude, l.longitude)
            : Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 40);
  }, [catalogLocations, query, pinLatitude, pinLongitude]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.sheetRoot}
      onLayout={(e) => onSheetHeightChange?.(e.nativeEvent.layout.height)}
    >
      <View style={styles.formPanel}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={onBack} accessibilityRole="button" accessibilityLabel="Change type">
            <Ionicons name="chevron-back" size={18} color={colors.primary} />
            <Text style={styles.backBtnText}>{childLabel}</Text>
          </Pressable>
        </View>

        <Text style={styles.prompt}>Which water is this {childLabel.toLowerCase()} on?</Text>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search waters…"
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>

        <ScrollView
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {waters.length === 0 ? (
            <Text style={styles.emptyText}>
              No matching water yet — create it below and we’ll come right back to add the{' '}
              {childLabel.toLowerCase()}.
            </Text>
          ) : (
            waters.map(({ loc, km }) => (
              <Pressable
                key={loc.id}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => onSelect(loc)}
                accessibilityRole="button"
                accessibilityLabel={`Add to ${loc.name}`}
              >
                <Ionicons name="water" size={18} color={colors.primary} />
                <View style={styles.rowTextCol}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {loc.name}
                  </Text>
                  <Text style={styles.rowSub}>
                    {typeLabel(loc.type)}
                    {Number.isFinite(km) ? ` · ${formatKm(km)} away` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </Pressable>
            ))
          )}
        </ScrollView>

        <Pressable
          style={({ pressed }) => [styles.createBtn, pressed && styles.rowPressed]}
          onPress={onCreateNew}
          accessibilityRole="button"
          accessibilityLabel="Create a new water"
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.createBtnText}>
            {query.trim() ? `Create “${query.trim()}” as a new water` : 'Create a new water'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sheetRoot: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 4,
    },
    formPanel: {
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
      maxHeight: 460,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: -2 },
      elevation: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.xs,
    },
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingVertical: Spacing.xs,
      marginLeft: -4,
    },
    backBtnText: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.primary,
    },
    prompt: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginBottom: Spacing.sm,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.sm,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 8,
      marginBottom: Spacing.sm,
    },
    searchInput: {
      flex: 1,
      fontSize: FontSize.md,
      color: colors.text,
      padding: 0,
    },
    list: {
      maxHeight: 240,
    },
    emptyText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      paddingVertical: Spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.sm,
    },
    rowPressed: {
      opacity: 0.6,
    },
    rowTextCol: {
      flex: 1,
    },
    rowTitle: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.text,
    },
    rowSub: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 1,
    },
    createBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: Spacing.sm,
      paddingVertical: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    createBtnText: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.primary,
      flexShrink: 1,
    },
  });
}
