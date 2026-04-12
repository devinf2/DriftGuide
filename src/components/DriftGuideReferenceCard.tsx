import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { stripOfflineGuideMarkdown } from '@/src/utils/stripOfflineGuideMarkdown';
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function previewSnippet(plain: string, maxLen = 120): string {
  const collapsed = plain.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, maxLen - 1)}…`;
}

export type DriftGuideReferenceCardProps = {
  /** Raw guide text (may include legacy markdown; it is stripped for display). */
  rawText: string;
  colors: ThemeColors;
  /** Optional wrapper style (e.g. alignSelf / maxWidth in chat lists). */
  style?: StyleProp<ViewStyle>;
  /** Optional leading row (e.g. summary tab icon + label). */
  headerAccessory?: ReactNode;
};

export function DriftGuideReferenceCard({ rawText, colors, style, headerAccessory }: DriftGuideReferenceCardProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const plain = useMemo(() => stripOfflineGuideMarkdown(rawText), [rawText]);
  const preview = useMemo(() => previewSnippet(plain), [plain]);
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed, style]}
        accessibilityRole="button"
        accessibilityLabel="Open DriftGuide offline reference"
      >
        {headerAccessory}
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>DriftGuide</Text>
          <MaterialIcons name="chevron-right" size={22} color={colors.textTertiary} />
        </View>
        <Text style={styles.cardSubtitle}>Offline reference · tap for full guide</Text>
        <Text style={styles.cardPreview} numberOfLines={2} ellipsizeMode="tail">
          {preview}
        </Text>
      </Pressable>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modalRoot, { paddingTop: insets.top + Spacing.sm, paddingBottom: insets.bottom + Spacing.md }]}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>DriftGuide</Text>
              <Text style={styles.modalSubtitle}>Offline fishing reference</Text>
            </View>
            <Pressable onPress={() => setOpen(false)} style={styles.modalClose} hitSlop={12} accessibilityRole="button">
              <Text style={styles.modalCloseText}>Done</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.modalBody} selectable>
              {plain}
            </Text>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      width: '100%',
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: Spacing.md,
    },
    cardPressed: {
      opacity: 0.92,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    cardTitle: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    cardSubtitle: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 2,
      letterSpacing: 0.2,
    },
    cardPreview: {
      fontSize: FontSize.sm,
      lineHeight: 20,
      color: colors.textSecondary,
      marginTop: Spacing.sm,
    },
    modalRoot: {
      flex: 1,
      backgroundColor: colors.background,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modalTitle: {
      fontSize: FontSize.xl,
      fontWeight: '700',
      color: colors.text,
    },
    modalSubtitle: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 2,
    },
    modalClose: {
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
    },
    modalCloseText: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.primary,
    },
    modalScroll: {
      flex: 1,
    },
    modalScrollContent: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.xxl,
    },
    modalBody: {
      fontSize: FontSize.md,
      lineHeight: 24,
      color: colors.text,
    },
  });
}
