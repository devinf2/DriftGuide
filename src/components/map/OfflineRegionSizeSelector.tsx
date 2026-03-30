import { View, Text, Pressable, StyleSheet } from 'react-native';
import {
  OFFLINE_REGION_SIZE_PRESETS,
  type OfflineRegionSizePreset,
} from '@/src/utils/offlineDownloadRegion';
import { Colors, FontSize, Spacing, BorderRadius } from '@/src/constants/theme';

const ORDER: OfflineRegionSizePreset[] = ['small', 'large'];

type Props = {
  value: OfflineRegionSizePreset;
  onChange: (preset: OfflineRegionSizePreset) => void;
};

export function OfflineRegionSizeSelector({ value, onChange }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Download area</Text>
      <View style={styles.row}>
        {ORDER.map((key) => {
          const p = OFFLINE_REGION_SIZE_PRESETS[key];
          const active = value === key;
          return (
            <Pressable
              key={key}
              style={[styles.seg, active && styles.segActive]}
              onPress={() => onChange(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${p.title} region, ${p.extentLabel}`}
            >
              <Text style={[styles.segTitle, active && styles.segTitleActive]}>{p.title}</Text>
              <Text style={[styles.segMeta, active && styles.segMetaActive]}>{p.extentLabel}</Text>
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
  label: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: Spacing.xs,
  },
  row: { flexDirection: 'row', gap: Spacing.xs },
  seg: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  segActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  segTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  segTitleActive: { color: Colors.textInverse },
  segMeta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: 2 },
  segMetaActive: { color: 'rgba(255,255,255,0.9)' },
  segHint: { fontSize: FontSize.xs, color: Colors.textTertiary },
  segHintActive: { color: 'rgba(255,255,255,0.75)' },
});
