import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import { PinchZoomPhotoViewport } from '@/src/components/PinchZoomPhotoViewport';
import { Spacing } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

type Props = {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
  paddingTop?: number;
  paddingBottom?: number;
  closeButtonTop?: number;
};

/** Full-screen pinch-zoom preview for a single local or remote photo URI. */
export function SinglePhotoZoomModal({
  visible,
  uri,
  onClose,
  paddingTop = 0,
  paddingBottom = 0,
  closeButtonTop = Spacing.lg,
}: Props) {
  const { colors } = useAppTheme();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const heroHeight = Math.round(winHeight * 0.55);
  const trimmed = uri?.trim();

  return (
    <Modal visible={visible && Boolean(trimmed)} animationType="fade" transparent statusBarTranslucent onRequestClose={onClose}>
      {trimmed ? (
        <View style={[styles.wrap, { paddingTop, paddingBottom }]}>
          <Pressable style={[styles.closeBtn, { top: closeButtonTop }]} onPress={onClose}>
            <MaterialCommunityIcons name="close" size={28} color={colors.textInverse} />
          </Pressable>
          <View style={[styles.hero, { height: heroHeight }]}>
            <PinchZoomPhotoViewport width={winWidth} height={heroHeight}>
              {trimmed.startsWith('http') ? (
                <OfflineTripPhotoImage
                  remoteUri={trimmed}
                  style={{ width: winWidth, height: heroHeight }}
                  contentFit="contain"
                />
              ) : (
                <Image
                  source={{ uri: trimmed }}
                  style={{ width: winWidth, height: heroHeight }}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                />
              )}
            </PinchZoomPhotoViewport>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  closeBtn: {
    position: 'absolute',
    right: Spacing.lg,
    zIndex: 10,
    padding: Spacing.sm,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
  },
});
