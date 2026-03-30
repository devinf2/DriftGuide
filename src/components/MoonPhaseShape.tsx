import React, { useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G } from 'react-native-svg';
import { Colors } from '@/src/constants/theme';
import type { MoonPhase } from '@/src/types';

const SIZE = 28;
const R = 12;
const C = SIZE / 2;

/** Yellow moon disk; dark overlay is the night side (unlit). */
const MOONLIGHT = '#F4D03F';
const NIGHT = '#0F172A';

/**
 * Lit fraction (0 to 1) and waxing vs waning (which side the shadow disk sits).
 */
const PHASE_CONFIG: Record<MoonPhase, { fraction: number; waxing: boolean }> = {
  new: { fraction: 0, waxing: true },
  waxing_crescent: { fraction: 0.15, waxing: true },
  first_quarter: { fraction: 0.5, waxing: true },
  waxing_gibbous: { fraction: 0.85, waxing: true },
  full: { fraction: 1, waxing: true },
  waning_gibbous: { fraction: 0.85, waxing: false },
  last_quarter: { fraction: 0.5, waxing: false },
  waning_crescent: { fraction: 0.15, waxing: false },
};

/**
 * Shadow disk (same radius as moon) shifted along x; clipped to the moon → curved terminator.
 * Waxing (NH): shadow eats from the **west/left**; waning from the **east/right**.
 */
function shadowDiskCx(fraction: number, waxing: boolean): number {
  const shift = 2 * R * (1 - fraction);
  return waxing ? C - shift : C + shift;
}

export function MoonPhaseShape({
  phase,
  size = SIZE,
  /**
   * Northern Hemisphere convention: waxing = lit on the right.
   * Southern Hemisphere mirrors the icon horizontally.
   */
  southernHemisphere = false,
}: {
  phase: MoonPhase;
  size?: number;
  southernHemisphere?: boolean;
}) {
  const clipId = useId().replace(/:/g, '');
  const { fraction, waxing } = PHASE_CONFIG[phase];
  const isNew = fraction <= 0;
  const isFull = fraction >= 1;
  const shadowCx = shadowDiskCx(fraction, waxing);

  return (
    <View
      style={{
        width: size,
        height: size,
        transform: southernHemisphere ? [{ scaleX: -1 }] : undefined,
      }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Defs>
          <ClipPath id={clipId}>
            <Circle cx={C} cy={C} r={R} />
          </ClipPath>
        </Defs>

        {/* New moon: no sunlit face */}
        {isNew && <Circle cx={C} cy={C} r={R} fill={NIGHT} />}

        {/* Full moon: all sunlit */}
        {!isNew && isFull && <Circle cx={C} cy={C} r={R} fill={MOONLIGHT} />}

        {/* Phases: yellow moon, then dark “night” cap (same geometry as before, roles read clearly). */}
        {!isNew && !isFull && (
          <>
            <Circle cx={C} cy={C} r={R} fill={MOONLIGHT} />
            <G clipPath={`url(#${clipId})`}>
              <Circle cx={shadowCx} cy={C} r={R} fill={NIGHT} />
            </G>
          </>
        )}

        <Circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke={Colors.textSecondary}
          strokeWidth={1.25}
        />
      </Svg>
    </View>
  );
}
