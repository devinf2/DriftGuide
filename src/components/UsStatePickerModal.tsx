import { US_STATES } from '@/src/constants/usStates';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  type KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
      width: '100%',
    },
    list: {
      flex: 1,
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
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const [stateQuery, setStateQuery] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (visible) setStateQuery('');
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => setKeyboardHeight(e.endCoordinates.height);
    const onHide = () => setKeyboardHeight(0);
    const subShow = Keyboard.addListener(showEvt, onShow);
    const subHide = Keyboard.addListener(hideEvt, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [visible]);

  const filteredStates = useMemo(() => {
    const q = stateQuery.trim().toLowerCase();
    if (!q) return [...US_STATES];
    return US_STATES.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
    );
  }, [stateQuery]);

  const maxPreferred = Math.min(Math.round(windowH * 0.88), 720);
  const topReserve = insets.top + 6;
  const bottomPad = Math.max(insets.bottom, Spacing.lg);
  const kb = keyboardHeight;
  /** Space from top safe area to top of keyboard; sheet must not exceed this or the header/search slide off-screen. */
  const maxSheetHeight = Math.max(0, windowH - kb - topReserve);
  const sheetHeight = Math.min(maxPreferred, maxSheetHeight);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : undefined}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View
          style={[
            styles.modalSheet,
            {
              height: sheetHeight,
              marginBottom: kb,
              paddingBottom: bottomPad,
            },
          ]}
        >
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
            clearButtonMode="while-editing"
          />
          <FlatList
            style={styles.list}
            data={filteredStates}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
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
