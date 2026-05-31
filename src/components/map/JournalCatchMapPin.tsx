import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import { type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { layoutSizeToPixelSize } from '@/src/utils/photoDisplayUrl';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { PixelRatio, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

const SIZE = 32;
const BORDER = 2;
const INNER = SIZE - BORDER * 2;
const MAP_PIN_PIXEL_SIZE = layoutSizeToPixelSize(SIZE, PixelRatio.get());

type Props = {
  photoUrl?: string | null;
  /** PointAnnotation snapshots children; call after the image paints so the pin bitmap updates. */
  onImageLoaded?: () => void;
};

function createPinStyles(colors: ThemeColors) {
  return StyleSheet.create({
    ring: {
      width: SIZE,
      height: SIZE,
      borderRadius: SIZE / 2,
      borderWidth: BORDER,
      borderColor: colors.surface,
      backgroundColor: colors.surface,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.35,
      shadowRadius: 2,
      elevation: 3,
    },
    image: {
      width: INNER,
      height: INNER,
      borderRadius: INNER / 2,
    },
    iconInner: {
      width: INNER,
      height: INNER,
      borderRadius: INNER / 2,
      backgroundColor: colors.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}

/** Compact catch marker: circular photo or fish icon. */
export function JournalCatchMapPin({ photoUrl, onImageLoaded }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createPinStyles(colors), [colors]);
  const uri = photoUrl?.trim();
  const hasPhoto = Boolean(uri);
  const bumpSnapshot = () => {
    onImageLoaded?.();
    if (!onImageLoaded) return;
    requestAnimationFrame(() => {
      onImageLoaded();
      requestAnimationFrame(onImageLoaded);
    });
  };
  return (
    <View style={styles.ring} collapsable={false}>
      {hasPhoto ? (
        <OfflineTripPhotoImage
          remoteUri={uri!}
          maxPixelSize={MAP_PIN_PIXEL_SIZE}
          style={styles.image}
          contentFit="cover"
          priority="high"
          onLoad={bumpSnapshot}
          onLoadEnd={bumpSnapshot}
          onError={bumpSnapshot}
        />
      ) : (
        <View style={styles.iconInner}>
          <MaterialCommunityIcons name="fish" size={17} color={colors.textInverse} />
        </View>
      )}
    </View>
  );
}

type MarkerProps = {
  photoUrl?: string | null;
  title?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

/** Catch pin wrapped for Mapbox MarkerView (live view — photos load reliably). */
export function JournalCatchMapMarker({ photoUrl, title, onPress, style }: MarkerProps) {
  return (
    <Pressable
      style={style}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={title ?? 'Catch'}
    >
      <JournalCatchMapPin photoUrl={photoUrl} />
    </Pressable>
  );
}
