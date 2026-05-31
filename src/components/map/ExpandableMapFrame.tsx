import { useMemo, useState, type ReactNode } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { BorderRadius, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';

export type ExpandableMapMode = 'preview' | 'fullscreen';

export type ExpandableMapFrameProps = {
  children: (ctx: { mode: ExpandableMapMode }) => ReactNode;
  /** When false, renders preview only (no expand control). */
  enabled?: boolean;
  previewContainerStyle?: StyleProp<ViewStyle>;
  /** Optional overlay shown in both preview and fullscreen (e.g. a center pin). */
  overlay?: ReactNode;
};

/**
 * Wraps an embedded map with an expand control that opens a full-screen modal map.
 */
export function ExpandableMapFrame({
  children,
  enabled = true,
  previewContainerStyle,
  overlay,
}: ExpandableMapFrameProps) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!enabled || Platform.OS === 'web') {
    return (
      <View style={[styles.previewRoot, previewContainerStyle]}>
        {children({ mode: 'preview' })}
        {overlay}
      </View>
    );
  }

  return (
    <>
      <View style={[styles.previewRoot, previewContainerStyle]}>
        {children({ mode: 'preview' })}
        {overlay}
        <Pressable
          style={styles.expandBtn}
          onPress={() => setOpen(true)}
          accessibilityLabel="Expand map to full screen"
          accessibilityRole="button"
          hitSlop={8}
        >
          <MaterialIcons name="fullscreen" size={22} color={colors.textInverse} />
        </Pressable>
      </View>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.fullscreenRoot}>
          {children({ mode: 'fullscreen' })}
          {overlay}
          <Pressable
            style={[styles.closeBtn, { top: insets.top + Spacing.sm }]}
            onPress={() => setOpen(false)}
            accessibilityLabel="Close full screen map"
            accessibilityRole="button"
            hitSlop={8}
          >
            <MaterialIcons name="fullscreen-exit" size={22} color={colors.textInverse} />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    previewRoot: {
      flex: 1,
      position: 'relative',
      overflow: 'hidden',
    },
    expandBtn: {
      position: 'absolute',
      top: Spacing.sm,
      left: Spacing.sm,
      width: 40,
      height: 40,
      borderRadius: BorderRadius.md,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 20,
    },
    fullscreenRoot: {
      flex: 1,
      backgroundColor: colors.background,
      position: 'relative',
    },
    closeBtn: {
      position: 'absolute',
      left: Spacing.md,
      width: 44,
      height: 44,
      borderRadius: BorderRadius.md,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 30,
    },
  });
}
