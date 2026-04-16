import type { MonthActivity } from '@/src/data/driftGuideHatchChart';
import Svg, { Circle, Polyline } from 'react-native-svg';

type Props = {
  months: readonly MonthActivity[];
  strokeColor: string;
  width: number;
  height: number;
};

/** Line + points over 12 months (same semantic as heat strip) */
export function HatchActivitySparkline({ months, strokeColor, width, height }: Props) {
  const padX = 6;
  const padY = 5;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const pts: string[] = [];
  const circles: { x: number; y: number; i: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const v = Math.min(3, Math.max(0, months[i] ?? 0));
    const x = padX + (i / 11) * innerW;
    const y = padY + innerH - (v / 3) * innerH;
    pts.push(`${x},${y}`);
    circles.push({ x, y, i });
  }
  const points = pts.join(' ');
  return (
    <Svg width={width} height={height} accessibilityLabel="Season activity trend line">
      <Polyline
        points={points}
        fill="none"
        stroke={strokeColor}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {circles.map(({ x, y, i }) => (
        <Circle key={i} cx={x} cy={y} r={3.5} fill={strokeColor} />
      ))}
    </Svg>
  );
}
