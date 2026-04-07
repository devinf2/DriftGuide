import { View, Text, Pressable, StyleSheet } from 'react-native';
import {
  OFFLINE_REGION_SIZE_PRESETS,
  offlineRegionExtentLabel,
  offlineRegionHalfExtents,
  type OfflineRegionOrientation,
  type OfflineRegionSizePreset,
} from '@/src/utils/offlineDownloadRegion';
import { Colors, FontSize, Spacing, BorderRadius } from '@/src/constants/theme';

const ORDER: OfflineRegionSizePreset[] = ['small', 'large'];

type Props = {
  value: OfflineRegionSizePreset;
  onChange: (preset: OfflineRegionSizePreset) => void;
  orientation: OfflineRegionOrientation;
  onOrientationChange: (orientation: OfflineRegionOrientation) => void;
};

export function OfflineRegionSizeSelector({
  value,
  onChange,
  orientation,
  onOrientationChange,
}: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Orientation</Text>
      <View style={styles.toggleGroup}>
        <Pressable
          style={[
            styles.segToggle,
            styles.segToggleOrientation,
            orientation === 'portrait' && styles.segToggleActive,
          ]}
          onPress={() => onOrientationChange('portrait')}
          accessibilityRole="button"
          accessibilityState={{ selected: orientation === 'portrait' }}
          accessibilityLabel="Portrait, longer north to south than east to west"
        >
          <Text
            style={[
              styles.segTitle,
              styles.segTitleOrientation,
              orientation === 'portrait' && styles.segTitleActive,
            ]}
          >
            Portrait
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.segToggle,
            styles.segToggleOrientation,
            styles.segToggleLast,
            orientation === 'landscape' && styles.segToggleActive,
          ]}
          onPress={() => onOrientationChange('landscape')}
          accessibilityRole="button"
          accessibilityState={{ selected: orientation === 'landscape' }}
          accessibilityLabel="Landscape, wider east to west than north to south"
        >
          <Text
            style={[
              styles.segTitle,
              styles.segTitleOrientation,
              orientation === 'landscape' && styles.segTitleActive,
            ]}
          >
            Landscape
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.label, styles.downloadAreaLabel]}>Download area</Text>
      <View style={styles.toggleGroup}>
        {ORDER.map((key, index) => {
          const p = OFFLINE_REGION_SIZE_PRESETS[key];
          const active = value === key;
          const { halfWidthKm, halfHeightKm } = offlineRegionHalfExtents(key, orientation);
          const extentLabel = offlineRegionExtentLabel(halfWidthKm, halfHeightKm);
          const isLast = index === ORDER.length - 1;
          return (
            <Pressable
              key={key}
              style={[
                styles.segToggle,
                styles.segToggleSize,
                isLast && styles.segToggleLast,
                active && styles.segToggleActive,
              ]}
              onPress={() => onChange(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${p.title} region, ${extentLabel}, east-west by north-south`}
            >
              <Text style={[styles.segTitle, active && styles.segTitleActive]}>{p.title}</Text>
              <Text style={[styles.segMeta, active && styles.segMetaActive]}>{extentLabel}</Text>
              <Text style={[styles.segHint, active && styles.segHintActive]}>{p.hint}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.md },
  downloadAreaLabel: { marginTop: Spacing.sm },
  label: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: Spacing.xs,
  },
  /** Segmented control: strong outer ring + vertical split so unselected slots read clearly. */
  toggleGroup: {
    flexDirection: 'row',
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
  },
  segToggle: {
    flex: 1,
    paddingHorizontal: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.primary,
  },
  segToggleLast: {
    borderRightWidth: 0,
  },
  segToggleActive: {
    backgroundColor: Colors.primary,
  },
  segToggleOrientation: {
    paddingVertical: Spacing.xs + 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segToggleSize: {
    paddingVertical: Spacing.sm,
  },
  segTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  segTitleOrientation: {
    marginBottom: 0,
    fontWeight: '600',
  },
  segTitleActive: { color: Colors.textInverse },
  segMeta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: 2 },
  segMetaActive: { color: 'rgba(255,255,255,0.9)' },
  segHint: { fontSize: FontSize.xs, color: Colors.textTertiary },
  segHintActive: { color: 'rgba(255,255,255,0.75)' },
});
