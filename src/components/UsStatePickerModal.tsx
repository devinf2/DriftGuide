import { US_STATES } from '@/src/constants/usStates';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { UsStateOption } from '@/src/constants/usStates';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: colors.surfaceElevated,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      maxHeight: '88%',
      paddingBottom: Spacing.xl,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modalTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    modalClose: { fontSize: FontSize.md, color: colors.primary, fontWeight: '600' },
    searchInput: {
      marginHorizontal: Spacing.lg,
      marginVertical: Spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
    },
    stateRow: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    stateRowText: { fontSize: FontSize.md, color: colors.text },
    stateRowSub: { fontSize: FontSize.sm, color: colors.textTertiary, marginTop: 2 },
  });
}

export type UsStatePickerModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (state: UsStateOption) => void;
};

/** Bottom sheet + search; same UX as onboarding home-state picker. */
export function UsStatePickerModal({ visible, onClose, onSelect }: UsStatePickerModalProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [stateQuery, setStateQuery] = useState('');

  useEffect(() => {
    if (visible) setStateQuery('');
  }, [visible]);

  const filteredStates = useMemo(() => {
    const q = stateQuery.trim().toLowerCase();
    if (!q) return [...US_STATES];
    return US_STATES.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
    );
  }, [stateQuery]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select state</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.modalClose}>Done</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.searchInput}
            value={stateQuery}
            onChangeText={setStateQuery}
            placeholder="Search"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <FlatList
            data={filteredStates}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={styles.stateRow}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                <Text style={styles.stateRowText}>{item.name}</Text>
                <Text style={styles.stateRowSub}>{item.code}</Text>
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}
