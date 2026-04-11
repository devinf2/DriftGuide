import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import { Spacing, FontSize, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { Photo } from '@/src/types';
import { formatTripDate } from '@/src/utils/formatters';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  FlatList,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

export type TripViewerPhotoSlide = {
  remoteUri: string;
  location?: string;
  fly?: string;
  date?: string;
  species?: string;
  caption?: string;
};

export function photosToViewerSlides(photos: Photo[], locationName?: string): TripViewerPhotoSlide[] {
  return photos.map((photo) => ({
    remoteUri: photo.url,
    location: locationName,
    fly:
      [photo.fly_pattern, photo.fly_size ? `#${photo.fly_size}` : null, photo.fly_color].filter(Boolean).join(' ') ||
      undefined,
    date:
      photo.captured_at || photo.created_at ? formatTripDate(photo.captured_at || photo.created_at!) : undefined,
    species: photo.species ?? undefined,
    caption: photo.caption ?? undefined,
  }));
}

type Props = {
  visible: boolean;
  onClose: () => void;
  slides: TripViewerPhotoSlide[];
  index: number;
  onIndexChange: (next: number) => void;
  paddingTop: number;
  paddingBottom: number;
  closeButtonTop: number;
};

export function TripFullScreenPhotoViewerModal({
  visible,
  onClose,
  slides,
  index,
  onIndexChange,
  paddingTop,
  paddingBottom,
  closeButtonTop,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const heroHeight = Math.round(winHeight * 0.55);
  const pagerRef = useRef<FlatList<TripViewerPhotoSlide>>(null);
  const openedForScrollRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      openedForScrollRef.current = false;
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || slides.length <= 1) return;
    if (openedForScrollRef.current) return;
    openedForScrollRef.current = true;
    const i = Math.min(Math.max(0, index), slides.length - 1);
    const id = requestAnimationFrame(() => {
      try {
        pagerRef.current?.scrollToIndex({ index: i, animated: false });
      } catch {
        /* layout */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [visible, slides.length, index]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<TripViewerPhotoSlide> | null | undefined, i: number) => ({
      length: winWidth,
      offset: winWidth * i,
      index: i,
    }),
    [winWidth],
  );

  const onPagerMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (winWidth <= 0 || slides.length <= 1) return;
      const page = Math.round(e.nativeEvent.contentOffset.x / winWidth);
      if (page >= 0 && page < slides.length) {
        onIndexChange(page);
      }
    },
    [winWidth, slides.length, onIndexChange],
  );

  const safeIndex = Math.min(Math.max(0, index), Math.max(0, slides.length - 1));
  const current = slides[safeIndex];

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={onClose}>
      {current ? (
        <View style={[styles.wrap, { paddingTop, paddingBottom }]}>
          <Pressable style={[styles.closeBtn, { top: closeButtonTop }]} onPress={onClose}>
            <MaterialCommunityIcons name="close" size={28} color={colors.textInverse} />
          </Pressable>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: paddingBottom + Spacing.xl }]}
            showsVerticalScrollIndicator={false}
          >
            {slides.length > 1 ? (
              <FlatList
                ref={pagerRef}
                data={slides}
                horizontal
                pagingEnabled
                keyExtractor={(item, i) => `${item.remoteUri}-${i}`}
                showsHorizontalScrollIndicator={false}
                style={[styles.pager, { height: heroHeight }]}
                initialScrollIndex={safeIndex}
                getItemLayout={getItemLayout}
                onMomentumScrollEnd={onPagerMomentumEnd}
                onScrollToIndexFailed={({ index: failed }) => {
                  setTimeout(() => {
                    try {
                      pagerRef.current?.scrollToIndex({ index: failed, animated: false });
                    } catch {
                      /* ignore */
                    }
                  }, 50);
                }}
                renderItem={({ item }) => (
                  <View style={[styles.page, { width: winWidth, height: heroHeight }]}>
                    <OfflineTripPhotoImage
                      remoteUri={item.remoteUri}
                      style={{ width: winWidth, height: heroHeight }}
                      contentFit="contain"
                    />
                  </View>
                )}
              />
            ) : (
              <OfflineTripPhotoImage
                remoteUri={current.remoteUri}
                style={[styles.singleImage, { width: winWidth, height: heroHeight }]}
                contentFit="contain"
              />
            )}
            <View style={styles.info}>
              {slides.length > 1 ? (
                <Text style={styles.pagerCount}>{`${safeIndex + 1} / ${slides.length}`}</Text>
              ) : null}
              {current.location ? (
                <Text style={styles.infoRow}>
                  <MaterialCommunityIcons name="map-marker" size={16} color={colors.textInverse} /> {current.location}
                </Text>
              ) : null}
              {current.fly ? (
                <Text style={styles.infoRow}>
                  <MaterialCommunityIcons name="hook" size={16} color={colors.textInverse} /> {current.fly}
                </Text>
              ) : null}
              {current.date ? (
                <Text style={styles.infoRow}>
                  <MaterialIcons name="calendar-today" size={16} color={colors.textInverse} /> {current.date}
                </Text>
              ) : null}
              {current.species ? (
                <Text style={styles.infoRow}>
                  <MaterialCommunityIcons name="fish" size={16} color={colors.textInverse} /> {current.species}
                </Text>
              ) : null}
              {current.caption ? <Text style={styles.caption}>{current.caption}</Text> : null}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
    scroll: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
    },
    singleImage: {
      marginTop: Spacing.sm,
    },
    pager: {
      marginTop: Spacing.sm,
      flexGrow: 0,
    },
    page: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    pagerCount: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textTertiary,
      marginBottom: Spacing.sm,
      textAlign: 'center',
    },
    info: {
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.xl,
      gap: Spacing.xs,
    },
    infoRow: {
      fontSize: FontSize.md,
      color: colors.textInverse,
      marginBottom: Spacing.xs,
    },
    caption: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      marginTop: Spacing.xs,
    },
  });
}
