import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useMemo, type ReactNode } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type OfflineGuideInfoModalProps = {
  visible: boolean;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  colors: ThemeColors;
  children: ReactNode;
};

export function OfflineGuideInfoModal({
  visible,
  title,
  subtitle,
  onClose,
  colors,
  children,
}: OfflineGuideInfoModalProps) {
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top + Spacing.sm, paddingBottom: insets.bottom + Spacing.md }]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12} accessibilityRole="button">
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerText: {
      flex: 1,
      paddingRight: Spacing.md,
    },
    title: {
      fontSize: FontSize.xl,
      fontWeight: '700',
      color: colors.text,
    },
    subtitle: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 4,
    },
    closeBtn: {
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
    },
    closeText: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.primary,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.xxl,
    },
  });
}
