/**
 * Carcassonne base-game tiles.
 *
 * Every tile edge has 3 "ports", numbered clockwise from the north-west corner:
 *
 *        0   1   2
 *     11           3
 *     10    (c)    4
 *      9           5
 *        8   7   6
 *
 * N = 0,1,2   E = 3,4,5   S = 6,7,8   W = 9,10,11.  The middle port of a side (1,4,7,10)
 * carries a road; a city takes all three ports of a side; fields own the rest.
 * Each feature lists the ports it touches, so connectivity between tiles is just
 * "port p meets port opposite(p) on the neighbour".
 */

export type FeatureType = 'city' | 'road' | 'field' | 'monastery';

export interface Feature {
  type: FeatureType;
  ports: number[];
  pennant?: boolean;
  /** fields only: indices of city features on this tile that the field borders */
  cities?: number[];
}

export interface TileDef {
  id: string;
  count: number;
  features: Feature[];
}

const N = [0, 1, 2], E = [3, 4, 5], S = [6, 7, 8], W = [9, 10, 11];
const ALL = [...N, ...E, ...S, ...W];
const city = (ports: number[], pennant = false): Feature => ({ type: 'city', ports, pennant });
const road = (...ports: number[]): Feature => ({ type: 'road', ports });
const field = (ports: number[], cities: number[] = []): Feature => ({ type: 'field', ports, cities });
const monastery: Feature = { type: 'monastery', ports: [] };

// Letters follow the usual A–X reference names for the base game.
export const TILES: TileDef[] = [
  { id: 'A', count: 2, features: [monastery, road(7), field([0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11])] },
  { id: 'B', count: 4, features: [monastery, field(ALL)] },
  { id: 'C', count: 1, features: [city(ALL, true)] },
  // D is also the start tile (one extra copy is placed before the game starts).
  { id: 'D', count: 3, features: [city(N), road(4, 10), field([3, 11], [0]), field([5, 6, 7, 8, 9])] },
  { id: 'E', count: 5, features: [city(N), field([...E, ...S, ...W], [0])] },
  { id: 'F', count: 2, features: [city([...E, ...W], true), field(N, [0]), field(S, [0])] },
  { id: 'G', count: 1, features: [city([...N, ...S]), field(E, [0]), field(W, [0])] },
  { id: 'H', count: 3, features: [city(E), city(W), field([...N, ...S], [0, 1])] },
  { id: 'I', count: 2, features: [city(E), city(S), field([...W, ...N], [0, 1])] },
  { id: 'J', count: 3, features: [city(N), road(4, 7), field([5, 6]), field([3, 8, 9, 10, 11], [0])] },
  { id: 'K', count: 3, features: [city(N), road(7, 10), field([8, 9]), field([11, 3, 4, 5, 6], [0])] },
  {
    id: 'L', count: 3,
    features: [city(N), road(4), road(7), road(10), field([3, 11], [0]), field([5, 6]), field([8, 9])],
  },
  { id: 'M', count: 2, features: [city([...N, ...W], true), field([...E, ...S], [0])] },
  { id: 'N', count: 3, features: [city([...N, ...W]), field([...E, ...S], [0])] },
  { id: 'O', count: 2, features: [city([...N, ...W], true), road(4, 7), field([5, 6]), field([3, 8], [0])] },
  { id: 'P', count: 3, features: [city([...N, ...W]), road(4, 7), field([5, 6]), field([3, 8], [0])] },
  { id: 'Q', count: 1, features: [city([...N, ...E, ...W], true), field(S, [0])] },
  { id: 'R', count: 3, features: [city([...N, ...E, ...W]), field(S, [0])] },
  { id: 'S', count: 2, features: [city([...N, ...E, ...W], true), road(7), field([6], [0]), field([8], [0])] },
  { id: 'T', count: 1, features: [city([...N, ...E, ...W]), road(7), field([6], [0]), field([8], [0])] },
  { id: 'U', count: 8, features: [road(1, 7), field([2, 3, 4, 5, 6]), field([8, 9, 10, 11, 0])] },
  { id: 'V', count: 9, features: [road(7, 10), field([8, 9]), field([11, 0, 1, 2, 3, 4, 5, 6])] },
  {
    id: 'W', count: 4,
    features: [road(4), road(7), road(10), field([11, 0, 1, 2, 3]), field([5, 6]), field([8, 9])],
  },
  {
    id: 'X', count: 1,
    features: [road(1), road(4), road(7), road(10), field([2, 3]), field([5, 6]), field([8, 9]), field([11, 0])],
  },
];

export const TILE: Record<string, TileDef> = Object.fromEntries(TILES.map((t) => [t.id, t]));
export const START_TILE = 'D';

/** Port index after rotating the tile `r` quarter turns clockwise. */
export const rotPort = (p: number, r: number) => (p + 3 * r) % 12;

/** The port on the neighbouring tile that touches port p. */
export const oppositePort = (p: number) => {
  const side = Math.floor(p / 3);
  const k = p % 3;
  return ((side + 2) % 4) * 3 + (2 - k);
};

/** Neighbour offsets for sides N, E, S, W (y grows downwards). */
export const SIDE_DELTA: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Feature index on a (rotated) tile that owns world-port p, or -1. */
export function featureAtPort(def: TileDef, r: number, p: number): number {
  return def.features.findIndex((f) => f.ports.some((q) => rotPort(q, r) === p));
}

/** What a rotated tile shows on world side s: decided by the middle port. */
export function sideType(def: TileDef, r: number, s: number): FeatureType {
  return def.features[featureAtPort(def, r, s * 3 + 1)].type;
}
