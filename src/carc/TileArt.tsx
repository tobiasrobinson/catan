import { memo } from 'react';
import { Feature, TILE } from './tiles';

/** Tile art is generated from the feature data so it can never disagree with the rules. */

type Pt = [number, number];
const C: Pt = [50, 50];
const CORNERS: Pt[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
const PORT_PT: Pt[] = [
  [20, 0], [50, 0], [80, 0],
  [100, 20], [100, 50], [100, 80],
  [80, 100], [50, 100], [20, 100],
  [0, 80], [0, 50], [0, 20],
];
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const sideMid = (s: number) => PORT_PT[s * 3 + 1];
const sidesOf = (f: Feature) => [0, 1, 2, 3].filter((s) => f.ports.includes(s * 3 + 1));
const P = (p: Pt) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

export const COLORS = {
  field: '#7fb24a',
  fieldDark: '#6b9c3c',
  city: '#cfa868',
  cityEdge: '#7a5a2e',
  road: '#efe6cf',
  roadEdge: '#8a7a5a',
  pennant: '#2a5db0',
};

function cityPath(f: Feature): string {
  const sides = sidesOf(f);
  if (sides.length === 4) return 'M0 0 H100 V100 H0 Z';
  const isCity = (s: number) => sides.includes(((s % 4) + 4) % 4);
  // Start at a city side whose predecessor is not a city side, then walk clockwise.
  const start = sides.find((s) => !isCity(s - 1))!;
  let d = `M${P(CORNERS[start])}`;
  let s = start;
  for (let walked = 0; walked < 4; ) {
    if (isCity(s)) {
      d += ` L${P(CORNERS[(s + 1) % 4])}`;
      s++;
      walked++;
      continue;
    }
    // Run of non-city sides: curve inwards from its first to its last corner.
    let m = 0;
    while (!isCity(s + m) && walked + m < 4) m++;
    const to = CORNERS[(s + m) % 4];
    let ctrl: Pt;
    if (m === 1) ctrl = lerp(sideMid(s % 4), C, 0.6);
    else if (m === 2) ctrl = lerp(C, CORNERS[(s + 1) % 4], 0.2);
    else ctrl = lerp(sideMid((s + 3) % 4), C, 0.9); // single city side: a cap
    d += ` Q${P(ctrl)} ${P(to)}`;
    s += m;
    walked += m;
  }
  return d + ' Z';
}

function roadPath(f: Feature): string {
  const sides = sidesOf(f);
  if (sides.length === 2) return `M${P(sideMid(sides[0]))} Q${P(C)} ${P(sideMid(sides[1]))}`;
  return `M${P(sideMid(sides[0]))} L${P(lerp(sideMid(sides[0]), C, 0.78))}`;
}

/** Where to draw a meeple on feature f (unrotated tile coordinates). */
export function anchor(t: string, f: number): Pt {
  const def = TILE[t];
  const feat = def.features[f];
  const hasMonastery = def.features.some((x) => x.type === 'monastery');
  switch (feat.type) {
    case 'monastery':
      return C;
    case 'city': {
      const sides = sidesOf(feat);
      if (sides.length === 4) return [35, 35];
      const avg = sides.map(sideMid).reduce((a, b) => [a[0] + b[0] / sides.length, a[1] + b[1] / sides.length], [0, 0] as Pt);
      return sides.length === 1 ? lerp(avg, C, 0.25) : lerp(avg, C, 0.4);
    }
    case 'road': {
      const sides = sidesOf(feat);
      if (sides.length === 2) {
        const [a, b] = sides.map(sideMid);
        return [0.25 * a[0] + 0.5 * C[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * C[1] + 0.25 * b[1]];
      }
      return lerp(sideMid(sides[0]), C, 0.5);
    }
    case 'field': {
      if (hasMonastery) return [18, 82];
      const pts = feat.ports.map((p) => PORT_PT[p]);
      const avg = pts.reduce((a, b) => [a[0] + b[0] / pts.length, a[1] + b[1] / pts.length], [0, 0] as Pt);
      const oneSide = new Set(feat.ports.map((p) => Math.floor(p / 3))).size === 1;
      if (Math.hypot(avg[0] - 50, avg[1] - 50) < 12) return [50, 50];
      return lerp(avg, C, oneSide ? 0.15 : 0.4);
    }
  }
}

/** Rotate an unrotated tile point r quarter-turns clockwise. */
export function rotPt([x, y]: Pt, r: number): Pt {
  for (let i = 0; i < r; i++) [x, y] = [100 - y, x];
  return [x, y];
}

/** The tile picture in a 100×100 box, already rotated. */
export const TileArt = memo(function TileArt({ t, r }: { t: string; r: number }) {
  const def = TILE[t];
  const roads = def.features.filter((f) => f.type === 'road');
  return (
    <g transform={`rotate(${r * 90} 50 50)`}>
      <rect width={100} height={100} fill={COLORS.field} />
      {def.features.map((f, i) =>
        f.type === 'city' ? (
          <path key={i} d={cityPath(f)} fill={COLORS.city} stroke={COLORS.cityEdge} strokeWidth={2.5} strokeLinejoin="round" />
        ) : null,
      )}
      {roads.map((f, i) => (
        <g key={i}>
          <path d={roadPath(f)} stroke={COLORS.roadEdge} strokeWidth={11} fill="none" strokeLinecap="butt" />
          <path d={roadPath(f)} stroke={COLORS.road} strokeWidth={7} fill="none" strokeLinecap="butt" />
        </g>
      ))}
      {def.features.map((f, i) => {
        if (f.type !== 'city' || !f.pennant) return null;
        const [x, y] = lerp(anchor(t, i), [100, 0], 0.18);
        return <path key={`p${i}`} d={`M${x - 6} ${y - 6} h12 v7 l-6 6 l-6 -6 z`} fill={COLORS.pennant} stroke="#fff" strokeWidth={1.5} />;
      })}
      {/* Buildings are drawn upright regardless of tile rotation. */}
      <g transform={`rotate(${-r * 90} 50 50)`}>
        {roads.length >= 3 && (
          <g>
            <rect x={41} y={43} width={18} height={15} fill="#e9d7b0" stroke="#5a2a1a" strokeWidth={2} />
            <path d="M38 44 L50 34 L62 44 Z" fill="#b5462f" stroke="#5a2a1a" strokeWidth={2} strokeLinejoin="round" />
          </g>
        )}
        {def.features.some((f) => f.type === 'monastery') && (
          <g>
            <rect x={36} y={40} width={28} height={24} fill="#f1e2c0" stroke="#5a2a1a" strokeWidth={2} />
            <path d="M33 42 L50 26 L67 42 Z" fill="#b5462f" stroke="#5a2a1a" strokeWidth={2} strokeLinejoin="round" />
            <rect x={46} y={52} width={8} height={12} fill="#5a2a1a" />
          </g>
        )}
      </g>
      <rect width={100} height={100} fill="none" stroke="#000" strokeOpacity={0.18} strokeWidth={1} />
    </g>
  );
});

export function MeepleIcon({ x, y, color, size = 1 }: { x: number; y: number; color: string; size?: number }) {
  // Meeple silhouette centred on (x, y).
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`} stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" fill={color}>
      <path d="M-4 -5 L-11 -1 Q-12 3 -8 3 L-5 2 L-9 11 L-2 11 L0 6 L2 11 L9 11 L5 2 L8 3 Q12 3 11 -1 L4 -5 Z" />
      <circle cy={-8} r={4.5} />
    </g>
  );
}
