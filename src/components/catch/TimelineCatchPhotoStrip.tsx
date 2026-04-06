import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import type { CatchData } from '@/src/types';
import { normalizeCatchPhotoUrls } from '@/src/utils/catchPhotos';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View, type ImageStyle, type ViewStyle } from 'react-native';

type Props = {
  data: CatchData;
  onPress?: () => void;
  /** Merged onto each thumbnail (e.g. width/height, borderRadius, backgroundColor). */
  imageStyle?: ImageStyle;
  containerStyle?: ViewStyle;
};

export function TimelineCatchPhotoStrip({ data, onPress, imageStyle, containerStyle }: Props) {
  const urls = normalizeCatchPhotoUrls(data);
  if (urls.length === 0) return null;
  return (
    <View style={[styles.strip, containerStyle]}>
      {urls.map((uri, i) => (
        <Pressable key={`${i}-${uri}`} onPress={onPress}>
          {uri.startsWith('http') ? (
            <OfflineTripPhotoImage remoteUri={uri} style={[styles.thumbBase, imageStyle]} contentFit="cover" />
          ) : (
            <Image source={{ uri }} style={[styles.thumbBase, imageStyle]} contentFit="cover" cachePolicy="memory-disk" />
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
