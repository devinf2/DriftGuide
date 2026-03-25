import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { Colors } from '@/src/constants/theme';

const SIZE = 32;
const BORDER = 2;
const INNER = SIZE - BORDER * 2;

type Props = {
  photoUrl?: string | null;
  /** PointAnnotation snapshots children; call after the image paints so the pin bitmap updates. */
  onImageLoaded?: () => void;
};

/** Compact catch marker for Mapbox PointAnnotation: circular photo or fish icon. */
export function JournalCatchMapPin({ photoUrl, onImageLoaded }: Props) {
  const uri = photoUrl?.trim();
  const hasPhoto = Boolean(uri);
  return (
    <View style={styles.ring} collapsable={false}>
      {hasPhoto ? (
        <Image
          source={{ uri: uri! }}
          style={styles.image}
          contentFit="cover"
          cachePolicy="memory-disk"
          onLoadEnd={onImageLoaded}
        />
      ) : (
        <View style={styles.iconInner}>
          <MaterialCommunityIcons name="fish" size={17} color={Colors.textInverse} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: BORDER,
    borderColor: Colors.surface,
    backgroundColor: Colors.surface,
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
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
