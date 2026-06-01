import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import { PinchZoomPhotoViewport } from '@/src/components/PinchZoomPhotoViewport';
import { FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';

type FlyImagePreviewModalProps = {
  visible: boolean;
  onClose: () => void;
  imageSource: ImageSourcePropType | null;
  title?: string | null;
  subtitle?: string | null;
};

function FlyPreviewImage({
  source,
  width,
  height,
}: {
  source: ImageSourcePropType;
  width: number;
  height: number;
}) {
  const uri =
    typeof source === 'object' && source !== null && 'uri' in source ? source.uri?.trim() : null;

  if (uri?.startsWith('http')) {
    return (
      <OfflineTripPhotoImage
        remoteUri={uri}
        style={{ width, height }}
        contentFit="contain"
      />
    );
  }

  return (
    <Image
      source={source}
      style={{ width, height }}
      contentFit="contain"
      cachePolicy="memory-disk"
    />
  );
}

/** Full-screen pinch-zoom preview for a fly photo (bundled asset or URI). */
export function FlyImagePreviewModal({
  visible,
  onClose,
  imageSource,
  title,
  subtitle,
}: FlyImagePreviewModalProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const handleViewportLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setViewportSize({ width, height });
    }
  };

  const showModal = visible && imageSource != null;

  return (
    <Modal
      visible={showModal}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {imageSource ? (
        <View
          style={[
            styles.wrap,
            { paddingBottom: insets.bottom },
          ]}
        >
          <Pressable
            style={[styles.closeBtn, { top: insets.top + Spacing.sm }]}
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close fly preview"
          >
            <Ionicons name="close" size={28} color={colors.textInverse} />
          </Pressable>

          <View style={styles.viewport} onLayout={handleViewportLayout}>
            {viewportSize.width > 0 && viewportSize.height > 0 ? (
              <PinchZoomPhotoViewport
                width={viewportSize.width}
                height={viewportSize.height}
              >
                <FlyPreviewImage
                  source={imageSource}
                  width={viewportSize.width}
                  height={viewportSize.height}
                />
              </PinchZoomPhotoViewport>
            ) : null}
          </View>

          {title || subtitle ? (
            <View style={[styles.footer, { maxWidth: winWidth - Spacing.lg * 2 }]}>
              {title ? (
                <Text style={styles.title} numberOfLines={2}>
                  {title}
                </Text>
              ) : null}
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.96)',
    },
    closeBtn: {
      position: 'absolute',
      top: Spacing.md,
      right: Spacing.lg,
      zIndex: 10,
      padding: Spacing.sm,
    },
    viewport: {
      flex: 1,
      justifyContent: 'center',
    },
    footer: {
      alignSelf: 'center',
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.md,
      alignItems: 'center',
      gap: Spacing.xs,
    },
    title: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.textInverse,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: FontSize.sm,
      color: 'rgba(255,255,255,0.72)',
      textAlign: 'center',
    },
  });
}
