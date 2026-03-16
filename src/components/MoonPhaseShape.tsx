import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { MoonPhase } from '@/src/types';

const SIZE = 28;
const R = 12;
const C = SIZE / 2;

/** Lit (sunlit) part of the moon — yellow/gold */
const LIT = '#F4D03F';
/** Unlit (shadow) part — dark */
const DARK = '#475569';

/**
 * Lit fraction (0 to 1) and whether the lit side is on the right (waxing) or left (waning).
 * Waxing = lit on right; waning = lit on left.
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
 * Build SVG path for the lit portion of the moon (intersection of circle with half-plane x >= offset or x <= offset).
 * Terminator is a vertical line at offset; lit side is one half of the circle.
 */
function litPath(offset: number, waxing: boolean): string {
  const d = offset - C;
  const sq = R * R - d * d;
  if (sq <= 0) {
    return waxing ? '' : ''; // fully dark or fully lit handled by caller
  }
  const h = Math.sqrt(sq);
  const y1 = C - h;
  const y2 = C + h;
  if (waxing) {
    // First quarter: lit on right. Chord (offset,y2)->(offset,y1), then arc along right semicircle.
    return `M ${offset} ${y2} L ${offset} ${y1} A ${R} ${R} 0 0 1 ${offset} ${y2} Z`;
  } else {
    // Last quarter: lit on left. Chord (offset,y1)->(offset,y2), then arc bottom-to-top along left semicircle.
    // Reversed path + sweep 1 selects the left half in SVG y-down coordinates.
    return `M ${offset} ${y1} L ${offset} ${y2} A ${R} ${R} 0 0 1 ${offset} ${y1} Z`;
  }
}

export function MoonPhaseShape({ phase, size = SIZE }: { phase: MoonPhase; size?: number }) {
  const { fraction, waxing } = PHASE_CONFIG[phase];
  const isNew = fraction <= 0;
  const isFull = fraction >= 1;

  // Terminator position: so that the lit fraction of the circle (one side of the line) matches.
  // offset = C + R*(1 - 2*fraction) for right-side lit; offset = C - R*(1 - 2*fraction) for left-side lit.
  const offset = waxing
    ? C + R * (1 - 2 * fraction)
    : C - R * (1 - 2 * fraction);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Full moon disk (dark base) */}
        <Circle cx={C} cy={C} r={R} fill={DARK} />
        {/* Lit portion (yellow) — path for crescent/half/gibbous, or full circle for full */}
        {isFull && <Circle cx={C} cy={C} r={R} fill={LIT} />}
        {!isNew && !isFull && (
          <Path d={litPath(offset, waxing)} fill={LIT} />
        )}
      </Svg>
    </View>
  );
}
