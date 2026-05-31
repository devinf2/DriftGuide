import { Platform, ScrollView, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { ReactNode } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 4;

type Props = {
  width: number;
  height: number;
  children: ReactNode;
  style?: ViewStyle;
};

function AndroidPinchZoomViewport({ width, height, children, style }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const resetZoom = () => {
    'worklet';
    scale.value = withTiming(1);
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedScale.value = 1;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE * 0.5, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value < MIN_SCALE) {
        resetZoom();
        return;
      }
      if (scale.value > MAX_SCALE) {
        scale.value = withTiming(MAX_SCALE);
        savedScale.value = MAX_SCALE;
        return;
      }
      savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_, state) => {
      if (savedScale.value > 1) {
        state.activate();
      } else {
        state.fail();
      }
    })
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
      <View style={[{ width, height, overflow: 'hidden' }, style]}>
        <Animated.View style={[{ width, height }, animatedStyle]}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

/**
 * Pinch-to-zoom viewport for full-screen (or large) photos.
 * iOS uses native UIScrollView zoom; Android uses pinch + pan gestures.
 */
export function PinchZoomPhotoViewport({ width, height, children, style }: Props) {
  if (Platform.OS === 'ios') {
    return (
      <ScrollView
        style={[{ width, height }, style]}
        contentContainerStyle={{ width, height }}
        minimumZoomScale={MIN_SCALE}
        maximumZoomScale={MAX_SCALE}
        centerContent
        bouncesZoom
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        {/* iOS UIScrollView zoom requires a single content child. */}
        <View style={{ width, height }}>{children}</View>
      </ScrollView>
    );
  }

  return (
    <AndroidPinchZoomViewport width={width} height={height} style={style}>
      {children}
    </AndroidPinchZoomViewport>
  );
}
