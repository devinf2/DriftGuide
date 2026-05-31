import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import type { CatchData } from '@/src/types';
import { layoutSizeToPixelSize } from '@/src/utils/photoDisplayUrl';
import { resolveCatchDisplayPhotoUrls, resolveCatchHeroPhotoUrl } from '@/src/utils/catchPhotos';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { PixelRatio, Pressable, StyleSheet, View, type ImageStyle, type ViewStyle } from 'react-native';

const DEFAULT_THUMB_LAYOUT_DP = 72;
const DEFAULT_NODE_LAYOUT_DP = 34;

type Props = {
  catchEventId: string;
  data: CatchData;
  /** Same album rows as the Photos tab (`photos` table for this trip). */
  albumPhotoUrlsByCatchId?: ReadonlyMap<string, readonly string[]>;
  onPress?: () => void;
  /** Merged onto each thumbnail (e.g. width/height, borderRadius, backgroundColor). */
  imageStyle?: ImageStyle;
  containerStyle?: ViewStyle;
};

type NodePhotoProps = {
  catchEventId: string;
  data: CatchData;
  albumPhotoUrlsByCatchId?: ReadonlyMap<string, readonly string[]>;
  imageStyle: ImageStyle;
};

/** Hero catch photo sized for a circular timeline node. */
export function TimelineCatchNodePhoto({
  catchEventId,
  data,
  albumPhotoUrlsByCatchId,
  imageStyle,
}: NodePhotoProps) {
  const heroUrl = useMemo(
    () => resolveCatchHeroPhotoUrl(catchEventId, data, albumPhotoUrlsByCatchId),
    [catchEventId, data, albumPhotoUrlsByCatchId],
  );
  const maxPixelSize = useMemo(() => {
    const layoutW = typeof imageStyle.width === 'number' ? imageStyle.width : DEFAULT_NODE_LAYOUT_DP;
    const layoutH = typeof imageStyle.height === 'number' ? imageStyle.height : DEFAULT_NODE_LAYOUT_DP;
    return layoutSizeToPixelSize(Math.max(layoutW, layoutH), PixelRatio.get());
  }, [imageStyle.width, imageStyle.height]);

  if (!heroUrl) return null;
  if (heroUrl.startsWith('http')) {
    return (
      <OfflineTripPhotoImage
        remoteUri={heroUrl}
        maxPixelSize={maxPixelSize}
        style={imageStyle}
        contentFit="cover"
      />
    );
  }
  return (
    <Image
      source={{ uri: heroUrl, width: maxPixelSize, height: maxPixelSize }}
      style={imageStyle}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={heroUrl}
      transition={120}
    />
  );
}

export function TimelineCatchPhotoStrip({
  catchEventId,
  data,
  albumPhotoUrlsByCatchId,
  onPress,
  imageStyle,
  containerStyle,
}: Props) {
  const urls = useMemo(
    () => resolveCatchDisplayPhotoUrls(catchEventId, data, albumPhotoUrlsByCatchId),
    [catchEventId, data, albumPhotoUrlsByCatchId],
  );
  const maxPixelSize = useMemo(() => {
    const layoutW =
      typeof imageStyle?.width === 'number' ? imageStyle.width : DEFAULT_THUMB_LAYOUT_DP;
    const layoutH =
      typeof imageStyle?.height === 'number' ? imageStyle.height : DEFAULT_THUMB_LAYOUT_DP;
    return layoutSizeToPixelSize(Math.max(layoutW, layoutH), PixelRatio.get());
  }, [imageStyle?.width, imageStyle?.height]);

  if (urls.length === 0) return null;
  return (
    <View style={[styles.strip, containerStyle]}>
      {urls.map((uri, i) => (
        <Pressable key={`${i}-${uri}`} onPress={onPress}>
          {uri.startsWith('http') ? (
            <OfflineTripPhotoImage
              remoteUri={uri}
              maxPixelSize={maxPixelSize}
              style={[styles.thumbBase, imageStyle]}
              contentFit="cover"
            />
          ) : (
            <Image
              source={{ uri, width: maxPixelSize, height: maxPixelSize }}
              style={[styles.thumbBase, imageStyle]}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={uri}
              transition={120}
            />
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  thumbBase: {
    backgroundColor: 'transparent',
  },
});
