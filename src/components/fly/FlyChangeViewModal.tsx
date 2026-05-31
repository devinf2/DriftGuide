import { useMemo } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { Fly, FlyCatalog, FlyChangeData } from '@/src/types';
import { displayFlyName } from '@/src/utils/flyValidation';
import { resolveFlyImageSourceFromChangeData } from '@/src/utils/resolveFlyPhotoUrl';
import { splitFlyChangeData } from '@/src/components/fly/ChangeFlyPickerModal';

function formatFlyDetail(name: string, size: number | null, color: string | null): string {
  const parts: string[] = [];
  if (name.trim()) parts.push(displayFlyName(name.trim()));
  if (size != null) parts.push(`#${size}`);
  if (color?.trim()) parts.push(color.trim());
  return parts.join(' · ') || 'Unknown fly';
}

function FlyRow({
  role,
  pattern,
  size,
  color,
  imageSource,
  styles,
  colors,
}: {
  role: string | null;
  pattern: string;
  size: number | null;
  color: string | null;
  imageSource: ReturnType<typeof resolveFlyImageSourceFromChangeData>;
  styles: ReturnType<typeof createFlyChangeViewStyles>;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.flyRow}>
      {imageSource ? (
        <Image source={imageSource} style={styles.flyImage} resizeMode="contain" />
      ) : (
        <View style={styles.flyImagePlaceholder}>
          <MaterialCommunityIcons name="hook" size={28} color={colors.textTertiary} />
        </View>
      )}
      <View style={styles.flyTextCol}>
        {role ? <Text style={styles.flyRole}>{role}</Text> : null}
        <Text style={styles.flyDetail}>{formatFlyDetail(pattern, size, color)}</Text>
      </View>
    </View>
  );
}

export type FlyChangeViewModalProps = {
  visible: boolean;
  onClose: () => void;
  data: FlyChangeData | null;
  userFlies: Fly[];
  flyCatalog: FlyCatalog[];
  title?: string;
  onEdit?: () => void;
};

export function FlyChangeViewModal({
  visible,
  onClose,
  data,
  userFlies,
  flyCatalog,
  title = 'Fly',
  onEdit,
}: FlyChangeViewModalProps) {
  const { colors, resolvedScheme } = useAppTheme();
  const scrim = resolvedScheme === 'dark' ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.52)';
  const styles = useMemo(() => createFlyChangeViewStyles(colors, scrim), [colors, scrim]);

  const { primary, dropper } = useMemo(
    () => (data ? splitFlyChangeData(data) : { primary: null, dropper: null }),
    [data],
  );

  const primaryImage = useMemo(
    () => (data ? resolveFlyImageSourceFromChangeData(data, 'primary', userFlies, flyCatalog) : null),
    [data, userFlies, flyCatalog],
  );
  const dropperImage = useMemo(
    () => (data ? resolveFlyImageSourceFromChangeData(data, 'dropper', userFlies, flyCatalog) : null),
    [data, userFlies, flyCatalog],
  );

  if (!primary) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <MaterialIcons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body} bounces={false}>
            <View style={styles.card}>
              <FlyRow
                role={dropper ? 'Primary' : null}
                pattern={primary.pattern}
                size={primary.size ?? null}
                color={primary.color ?? null}
                imageSource={primaryImage}
                styles={styles}
                colors={colors}
              />
              {dropper?.pattern?.trim() ? (
                <FlyRow
                  role="Secondary"
                  pattern={dropper.pattern}
                  size={dropper.size ?? null}
                  color={dropper.color ?? null}
                  imageSource={dropperImage}
                  styles={styles}
                  colors={colors}
                />
              ) : null}
            </View>
          </ScrollView>
          {onEdit ? (
            <View style={styles.footer}>
              <Pressable
                style={styles.editButton}
                onPress={() => {
                  onClose();
                  onEdit();
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit fly"
              >
                <MaterialIcons name="edit" size={18} color={colors.primary} />
                <Text style={styles.editButtonText}>Edit fly</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function createFlyChangeViewStyles(colors: ThemeColors, scrim: string) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: scrim,
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      maxHeight: '70%',
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomWidth: 0,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      flex: 1,
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
      marginRight: Spacing.sm,
    },
    body: {
      padding: Spacing.lg,
    },
    card: {
      backgroundColor: colors.background,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.md,
      gap: Spacing.md,
    },
    flyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
    },
    flyImage: {
      width: 72,
      height: 72,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surface,
    },
    flyImagePlaceholder: {
      width: 72,
      height: 72,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    flyTextCol: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    flyRole: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    flyDetail: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.text,
    },
    footer: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    editButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
    },
    editButtonText: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.primary,
    },
  });
}
