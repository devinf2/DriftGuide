import {
  showTripPhotoVisibilityInfoAlert,
  TRIP_PHOTO_VISIBILITY_HINTS,
  TRIP_PHOTO_VISIBILITY_LABELS,
  TRIP_PHOTO_VISIBILITY_TRIGGER_LABELS,
  type TripPhotoVisibility,
} from '@/src/constants/tripPhotoVisibility';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const OPTIONS: TripPhotoVisibility[] = ['private', 'friends_only', 'public'];

type TripPhotoVisibilityDropdownProps = {
  value: TripPhotoVisibility;
  onChange: (next: TripPhotoVisibility) => void;
  disabled?: boolean;
  saving?: boolean;
  /** Row label next to the trigger (default: Visible to). */
  label?: string;
  /** Modal title (defaults to `label`). */
  modalTitle?: string;
  /** When false, hide the (i) next to the label (e.g. parent section already has info). */
  showInfo?: boolean;
  /** Full-width row for settings cards; compact fits beside Save offline on trip summary. */
  fullWidth?: boolean;
  /**
   * Use these tokens instead of the app theme (e.g. trip summary uses static light `Colors`
   * while the rest of the app may be dark — avoids a dark trigger on a light screen).
   */
  colorTokens?: ThemeColors;
  /** Use short trigger text ("Friends" vs "Friends only"). Default true on compact rows. */
  shortTriggerLabels?: boolean;
};

function createStyles(colors: ThemeColors, fullWidth: boolean, compactTriggerText: boolean) {
  return StyleSheet.create({
    row: fullWidth
      ? {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          gap: Spacing.sm,
        }
      : {
          flexDirection: 'row',
          alignItems: 'center',
          flexShrink: 0,
          gap: 6,
          maxWidth: '48%',
        },
    label: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    labelCluster: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: fullWidth ? 0 : undefined,
    },
    infoHit: { padding: 2 },
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingVertical: 5,
      paddingHorizontal: fullWidth ? Spacing.sm : 6,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      minWidth: fullWidth ? 124 : undefined,
      alignSelf: fullWidth ? undefined : 'flex-start',
      flexShrink: 0,
    },
    triggerText: {
      fontSize: compactTriggerText ? FontSize.xs : FontSize.sm,
      fontWeight: '600',
      color: colors.text,
      ...(fullWidth ? { flex: 1 } : {}),
    },
    chevron: { fontSize: 10, color: colors.textSecondary, marginTop: 1 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center',
      padding: Spacing.lg,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
    },
    modalTitle: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
    },
    option: {
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.sm,
    },
    optionActive: {
      backgroundColor: `${colors.primary}18`,
    },
    optionTitle: {
      fontSize: FontSize.md,
      color: colors.text,
    },
    optionTitleActive: {
      fontWeight: '600',
      color: colors.primary,
    },
    optionHint: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 2,
      lineHeight: 16,
    },
  });
}

export function TripPhotoVisibilityDropdown({
  value,
  onChange,
  disabled,
  saving,
  label = 'Visible to',
  modalTitle,
  showInfo = true,
  fullWidth = false,
  colorTokens,
  shortTriggerLabels,
}: TripPhotoVisibilityDropdownProps) {
  const { colors: themeColors } = useAppTheme();
  const colors = colorTokens ?? themeColors;
  const useShortTrigger = shortTriggerLabels ?? !fullWidth;
  const compactTriggerText = !fullWidth;
  const styles = useMemo(
    () => createStyles(colors, fullWidth, compactTriggerText),
    [colors, fullWidth, compactTriggerText],
  );
  const [open, setOpen] = useState(false);
  const title = modalTitle ?? label;
  const triggerLabel = useShortTrigger
    ? TRIP_PHOTO_VISIBILITY_TRIGGER_LABELS[value]
    : TRIP_PHOTO_VISIBILITY_LABELS[value];

  return (
    <>
      <View style={styles.row}>
        <View style={styles.labelCluster}>
          <Text style={styles.label}>{label}</Text>
          {showInfo ? (
            <Pressable
              style={styles.infoHit}
              onPress={() => showTripPhotoVisibilityInfoAlert()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="What visible to means for trip photos"
            >
              <MaterialIcons name="info-outline" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          style={[styles.trigger, (disabled || saving) && { opacity: 0.55 }]}
          onPress={() => !disabled && !saving && setOpen(true)}
          disabled={disabled || saving}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${TRIP_PHOTO_VISIBILITY_LABELS[value]}. Open menu.`}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Text style={styles.triggerText} numberOfLines={1}>
                {triggerLabel}
              </Text>
              <Text style={styles.chevron}>▾</Text>
            </>
          )}
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <TouchableOpacity style={styles.modalCard} activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{title}</Text>
            {OPTIONS.map((key) => (
              <TouchableOpacity
                key={key}
                style={[styles.option, value === key && styles.optionActive]}
                onPress={() => {
                  onChange(key);
                  setOpen(false);
                }}
              >
                <Text style={[styles.optionTitle, value === key && styles.optionTitleActive]}>
                  {TRIP_PHOTO_VISIBILITY_LABELS[key]}
                </Text>
                <Text style={styles.optionHint}>{TRIP_PHOTO_VISIBILITY_HINTS[key]}</Text>
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
