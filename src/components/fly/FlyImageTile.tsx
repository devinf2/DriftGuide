import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import { isUserFlyPhotoUrl } from '@/src/utils/resolveFlyPhotoUrl';
import { displayFlyName } from '@/src/utils/flyValidation';

export type FlyImageTileProps = {
  name: string;
  photoUrl?: string | null;
  size?: number | null;
  color?: string | null;
  selected?: boolean;
  onPress?: () => void;
  /** Larger tile for selected preview */
  variant?: 'grid' | 'large' | 'compact' | 'row';
  /** Override width for responsive grid columns */
  tileWidth?: number;
  accessibilityLabel?: string;
};

export function FlyImageTile({
  name,
  photoUrl,
  size,
  color,
  selected,
  onPress,
  variant = 'grid',
  tileWidth,
  accessibilityLabel,
}: FlyImageTileProps) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors, variant, tileWidth);
  const detail = [size != null ? `#${size}` : null, color?.trim()].filter(Boolean).join(' · ');
  const label = displayFlyName(name);
  const placeholderIconSize =
    variant === 'large' ? 32 : variant === 'row' ? 16 : (tileWidth ?? 96) < 72 ? 18 : 22;
  const imageSource = photoUrl && isUserFlyPhotoUrl(photoUrl)
    ? { uri: photoUrl.trim() }
    : getBundledFlyImageSource(name);

  const imageNode = imageSource ? (
    <Image source={imageSource} style={styles.image} resizeMode="contain" />
  ) : (
    <View style={styles.imagePlaceholder}>
      <Ionicons
        name="fish-outline"
        size={placeholderIconSize}
        color={colors.textTertiary}
      />
    </View>
  );

  const textNode = (
    <>
      <Text style={styles.name} numberOfLines={2}>
        {label}
      </Text>
      {detail ? (
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </>
  );

  return (
    <Pressable
      style={[styles.tile, selected && styles.tileSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {variant === 'row' ? (
        <>
          {imageNode}
          <View style={styles.textCol}>{textNode}</View>
        </>
      ) : (
        <>
          {imageNode}
          {textNode}
        </>
      )}
    </Pressable>
  );
}

function createStyles(
  colors: ThemeColors,
  variant: FlyImageTileProps['variant'],
  tileWidthOverride?: number,
) {
  const defaultTileWidth = variant === 'large' ? 120 : variant === 'compact' ? 72 : variant === 'row' ? 132 : 96;
  const resolvedTileWidth = tileWidthOverride ?? defaultTileWidth;
  const pad = variant === 'compact' || variant === 'row' ? Spacing.xs : variant === 'large' ? Spacing.sm : Spacing.xs;
  const tilePad =
    variant === 'grid'
      ? { paddingHorizontal: pad, paddingTop: pad, paddingBottom: 2 }
      : { padding: pad };
  const imageSize =
    variant === 'large'
      ? 96
      : variant === 'row'
        ? 32
      : variant === 'compact'
        ? 40
        : Math.max(44, Math.min(56, resolvedTileWidth - pad * 2));
  return StyleSheet.create({
    tile: {
      width: resolvedTileWidth,
      flexDirection: variant === 'row' ? 'row' : 'column',
      alignItems: variant === 'row' ? 'center' : 'center',
      gap: variant === 'row' ? Spacing.xs : undefined,
      ...tilePad,
      borderRadius: BorderRadius.md,
      borderWidth: 2,
      borderColor: 'transparent',
      backgroundColor: colors.surface,
    },
    tileSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + '12',
    },
    image: {
      width: imageSize,
      height: imageSize,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.background,
    },
    imagePlaceholder: {
      width: imageSize,
      height: imageSize,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: {
      marginTop: variant === 'row' ? 0 : variant === 'grid' ? 2 : Spacing.xs,
      lineHeight: variant === 'grid' && resolvedTileWidth < 72 ? 13 : variant === 'row' ? 14 : undefined,
      fontSize:
        variant === 'compact' || variant === 'row' || (variant === 'grid' && resolvedTileWidth < 72)
          ? FontSize.xs
          : FontSize.sm,
      fontWeight: '600',
      color: colors.text,
      textAlign: variant === 'row' ? 'left' : 'center',
    },
    detail: {
      marginTop: 2,
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      textAlign: variant === 'row' ? 'left' : 'center',
    },
    textCol: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
    },
  });
}
