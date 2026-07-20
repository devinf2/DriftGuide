import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

/** The Fish home is split into these sections; exactly one renders at a time. */
export type HomeSectionKey = 'report' | 'welcome' | 'right-now' | 'guide';

export const HOME_SECTIONS: {
  key: HomeSectionKey;
  label: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
}[] = [
  { key: 'report', label: 'Report', icon: 'file-document-outline' },
  { key: 'welcome', label: 'Catches', icon: 'fish' },
  { key: 'right-now', label: 'Flies & hatch', icon: 'bee-flower' },
  { key: 'guide', label: 'Ask DriftGuide', icon: 'message-text-outline' },
];

function createStyles(colors: ThemeColors, overlay: boolean) {
  return StyleSheet.create({
    // Transparent bar: the pills float over whatever is behind them (the sheet / photo seam).
    bar: {
      backgroundColor: 'transparent',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.full,
      borderWidth: StyleSheet.hairlineWidth,
      // On the photo: translucent dark chips with a light hairline read in any lighting.
      borderColor: overlay ? 'rgba(255,255,255,0.28)' : colors.border,
      backgroundColor: overlay ? 'rgba(15,23,42,0.42)' : colors.surfaceElevated,
      // Floating: a soft shadow lifts the pills off the sheet.
      shadowColor: '#000',
      shadowOpacity: overlay ? 0 : 0.18,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: overlay ? 0 : 3,
    },
    pillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    pillText: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: overlay ? 'rgba(255,255,255,0.9)' : colors.textSecondary,
    },
    pillTextActive: {
      color: colors.textInverse,
    },
  });
}

type Props = {
  active: HomeSectionKey;
  onChange: (key: HomeSectionKey) => void;
  /** Rendered to the right of the pills (e.g. the invites bell). */
  accessory?: ReactNode;
  /** Safe-area / header padding above the pills. */
  topPadding?: number;
  /** `overlay` styles the pills to sit on top of a photo (translucent, light text). */
  variant?: 'bar' | 'overlay';
  /** Extra right padding on the scroll row so the last pill clears an absolute accessory. */
  rowPaddingRight?: number;
};

/**
 * Horizontal pill switcher for the Fish home sections. Scrolls horizontally so the
 * five labels stay readable at large text sizes rather than truncating.
 */
export function HomeSectionTabs({
  active,
  onChange,
  accessory,
  topPadding = 0,
  variant = 'bar',
  rowPaddingRight,
}: Props) {
  const { colors } = useAppTheme();
  const overlay = variant === 'overlay';
  const styles = useMemo(() => createStyles(colors, overlay), [colors, overlay]);

  return (
    <View style={[styles.bar, { paddingTop: topPadding }]}>
      {accessory ? (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            paddingHorizontal: Spacing.md,
          }}
        >
          {accessory}
        </View>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.row,
          rowPaddingRight != null ? { paddingRight: rowPaddingRight } : null,
        ]}
      >
        {HOME_SECTIONS.map(({ key, label }) => {
          const isActive = key === active;
          return (
            <Pressable
              key={key}
              onPress={() => onChange(key)}
              style={[styles.pill, isActive && styles.pillActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={label}
            >
              <Text style={[styles.pillText, isActive && styles.pillTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
