import { makeRng, shuffle } from '../engine/rng';
import { FeatureType, SIDE_DELTA, START_TILE, TILE, TILES, featureAtPort, oppositePort, rotPort, sideType } from './tiles';

export const CARC_COLORS = ['#d32f2f', '#1e63c4', '#f2c230', '#2e9d4f', '#222222'];
export const MEEPLES = 7;

export interface Meeple {
  owner: number;
  /** feature index on this tile */
  f: number;
}
export interface Placed {
  t: string;
  r: number;
  meeple: Meeple | null;
}
export interface CPlayer {
  id: number;
  name: string;
  color: string;
  isAI: boolean;
  score: number;
  meeples: number;
}
export interface CState {
  seed: number;
  players: CPlayer[];
  /** keyed "x,y" */
  board: Record<string, Placed>;
  bag: string[];
  current: number;
  phase: 'place' | 'meeple' | 'gameOver';
  drawn: string | null;
  last: { x: number; y: number } | null;
  turn: number;
  log: string[];
  /** set at game end */
  winners: number[] | null;
}

export type CAction = { type: 'place'; x: number; y: number; r: number } | { type: 'meeple'; f: number | null };

export const key = (x: number, y: number) => `${x},${y}`;
export const unkey = (k: string) => k.split(',').map(Number) as [number, number];

// ---------------------------------------------------------------- placement

export function canPlace(s: CState, t: string, x: number, y: number, r: number): boolean {
  if (s.board[key(x, y)]) return false;
  const def = TILE[t];
  let touches = false;
  for (let side = 0; side < 4; side++) {
    const [dx, dy] = SIDE_DELTA[side];
    const n = s.board[key(x + dx, y + dy)];
    if (!n) continue;
    touches = true;
    if (sideType(def, r, side) !== sideType(TILE[n.t], n.r, (side + 2) % 4)) return false;
  }
  return touches;
}

/** Empty cells next to the board. */
export function frontier(s: CState): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const k of Object.keys(s.board)) {
    const [x, y] = unkey(k);
    for (const [dx, dy] of SIDE_DELTA) {
      const nk = key(x + dx, y + dy);
      if (s.board[nk] || seen.has(nk)) continue;
      seen.add(nk);
      out.push([x + dx, y + dy]);
    }
  }
  return out;
}

export function legalPlacements(s: CState, t: string): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = [];
  for (const [x, y] of frontier(s)) for (let r = 0; r < 4; r++) if (canPlace(s, t, x, y, r)) out.push({ x, y, r });
  return out;
}

// ---------------------------------------------------------------- regions

export interface Region {
  id: number;
  type: FeatureType;
  /** [tile key, feature index] */
  parts: [string, number][];
  tiles: Set<string>;
  pennants: number;
  /** road/city ports with no neighbouring tile; 0 = complete */
  open: number;
  meeples: { owner: number; at: string }[];
  /** fields: ids of city regions bordered */
  cities: Set<number>;
}

export interface Regions {
  list: Region[];
  /** "x,y#f" -> region id */
  of: Map<string, number>;
}

/** Union-find over every feature on the board. Cheap enough to recompute (~300 nodes). */
export function regions(s: CState): Regions {
  const ids = new Map<string, number>();
  const nodes: [string, number][] = [];
  for (const [k, p] of Object.entries(s.board)) {
    TILE[p.t].features.forEach((_, f) => {
      ids.set(`${k}#${f}`, nodes.length);
      nodes.push([k, f]);
    });
  }
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const openPorts = new Array(nodes.length).fill(0);

  for (const [k, p] of Object.entries(s.board)) {
    const [x, y] = unkey(k);
    const def = TILE[p.t];
    def.features.forEach((feat, f) => {
      const me = ids.get(`${k}#${f}`)!;
      for (const q of feat.ports) {
        const port = rotPort(q, p.r);
        const [dx, dy] = SIDE_DELTA[Math.floor(port / 3)];
        const nk = key(x + dx, y + dy);
        const n = s.board[nk];
        if (!n) {
          if (feat.type !== 'field') openPorts[me]++;
          continue;
        }
        const nf = featureAtPort(TILE[n.t], n.r, oppositePort(port));
        parent[find(me)] = find(ids.get(`${nk}#${nf}`)!);
      }
    });
  }

  const byRoot = new Map<number, Region>();
  const of = new Map<string, number>();
  nodes.forEach(([k, f], i) => {
    const root = find(i);
    const feat = TILE[s.board[k].t].features[f];
    let reg = byRoot.get(root);
    if (!reg) {
      reg = { id: byRoot.size, type: feat.type, parts: [], tiles: new Set(), pennants: 0, open: 0, meeples: [], cities: new Set() };
      byRoot.set(root, reg);
    }
    reg.parts.push([k, f]);
    if (feat.pennant) reg.pennants++;
    reg.tiles.add(k);
    reg.open += openPorts[i];
    const m = s.board[k].meeple;
    if (m && m.f === f) reg.meeples.push({ owner: m.owner, at: k });
    of.set(`${k}#${f}`, reg.id);
  });
  const list = [...byRoot.values()];
  // Fields learn which city regions they border.
  for (const reg of list) {
    if (reg.type !== 'field') continue;
    for (const [k, f] of reg.parts) {
      for (const c of TILE[s.board[k].t].features[f].cities ?? []) reg.cities.add(of.get(`${k}#${c}`)!);
    }
  }
  return { list, of };
}

export function neighbours8(s: CState, k: string): number {
  const [x, y] = unkey(k);
  let n = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if ((dx || dy) && s.board[key(x + dx, y + dy)]) n++;
  return n;
}

export const isComplete = (s: CState, reg: Region) =>
  reg.type === 'monastery' ? neighbours8(s, reg.parts[0][0]) === 8 : reg.type === 'field' ? false : reg.open === 0;

/** Points a region is worth now (complete) or at game end (incomplete). Fields need `completeCities`. */
export function regionValue(s: CState, reg: Region, final: boolean, completeCities = 0): number {
  switch (reg.type) {
    case 'road':
      return reg.tiles.size;
    case 'city':
      return final && reg.open > 0 ? reg.tiles.size + reg.pennants : 2 * (reg.tiles.size + reg.pennants);
    case 'monastery':
      return 1 + neighbours8(s, reg.parts[0][0]);
    case 'field':
      return 3 * completeCities;
  }
}

/** Players with the most meeples in a region (all tied players score). */
export function majority(reg: Region): number[] {
  const c = new Map<number, number>();
  for (const m of reg.meeples) c.set(m.owner, (c.get(m.owner) ?? 0) + 1);
  const best = Math.max(0, ...c.values());
  return best ? [...c].filter(([, n]) => n === best).map(([p]) => p) : [];
}

/** Features on the just-placed tile where the current player may put a meeple. */
export function meepleOptions(s: CState): number[] {
  if (s.phase !== 'meeple' || !s.last || s.players[s.current].meeples <= 0) return [];
  const k = key(s.last.x, s.last.y);
  const R = regions(s);
  return TILE[s.board[k].t].features
    .map((_, f) => f)
    .filter((f) => R.list[R.of.get(`${k}#${f}`)!].meeples.length === 0);
}

// ---------------------------------------------------------------- game flow

const typeName: Record<FeatureType, string> = { city: 'city', road: 'road', field: 'field', monastery: 'monastery' };

export function createCarc(configs: { name: string; isAI: boolean }[], seed = Math.floor(Math.random() * 2 ** 31)): CState {
  if (configs.length < 2 || configs.length > 5) throw new Error('Carcassonne needs 2–5 players');
  const rand = makeRng(seed);
  const bag = shuffle(TILES.flatMap((t) => Array<string>(t.count).fill(t.id)), rand);
  const s: CState = {
    seed,
    players: configs.map((c, i) => ({ id: i, name: c.name, color: CARC_COLORS[i], isAI: c.isAI, score: 0, meeples: MEEPLES })),
    board: { [key(0, 0)]: { t: START_TILE, r: 0, meeple: null } },
    bag,
    current: 0,
    phase: 'place',
    drawn: null,
    last: null,
    turn: 1,
    log: ['Game started'],
    winners: null,
  };
  draw(s);
  return s;
}

/** Draw the next placeable tile (unplaceable ones are discarded, per the rules). Ends the game when empty. */
function draw(s: CState) {
  while (s.bag.length) {
    const t = s.bag.pop()!;
    if (legalPlacements(s, t).length) {
      s.drawn = t;
      s.phase = 'place';
      return;
    }
    s.log.push(`Tile ${t} could not be placed anywhere and was discarded`);
  }
  s.drawn = null;
  finalScoring(s);
}

function award(s: CState, reg: Region, pts: number, why: string) {
  const owners = majority(reg);
  if (!owners.length || !pts) return;
  for (const p of owners) s.players[p].score += pts;
  s.log.push(`${owners.map((p) => s.players[p].name).join(' & ')} +${pts} for ${why}`);
}

function returnMeeples(s: CState, reg: Region) {
  for (const m of reg.meeples) {
    s.players[m.owner].meeples++;
    s.board[m.at] = { ...s.board[m.at], meeple: null };
  }
}

/** Score roads/cities/monasteries completed by the tile just placed. */
function scoreCompleted(s: CState) {
  const { x, y } = s.last!;
  const k = key(x, y);
  const R = regions(s);
  const touched = new Set<number>();
  TILE[s.board[k].t].features.forEach((_, f) => touched.add(R.of.get(`${k}#${f}`)!));
  // Monasteries around (and on) the new tile may have just been surrounded.
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const nk = key(x + dx, y + dy);
      const n = s.board[nk];
      if (!n) continue;
      TILE[n.t].features.forEach((f, i) => f.type === 'monastery' && touched.add(R.of.get(`${nk}#${i}`)!));
    }
  for (const id of touched) {
    const reg = R.list[id];
    if (reg.type === 'field' || !reg.meeples.length || !isComplete(s, reg)) continue;
    award(s, reg, regionValue(s, reg, false), `a completed ${typeName[reg.type]}`);
    returnMeeples(s, reg);
  }
}

export function finalScoring(s: CState) {
  const R = regions(s);
  const done = new Set(R.list.filter((r) => r.type === 'city' && r.open === 0).map((r) => r.id));
  for (const reg of R.list) {
    if (!reg.meeples.length) continue;
    if (reg.type === 'field') {
      const n = [...reg.cities].filter((c) => done.has(c)).length;
      award(s, reg, regionValue(s, reg, true, n), `a farm next to ${n} completed ${n === 1 ? 'city' : 'cities'}`);
    } else {
      award(s, reg, regionValue(s, reg, true), `an unfinished ${typeName[reg.type]}`);
    }
  }
  s.phase = 'gameOver';
  const best = Math.max(...s.players.map((p) => p.score));
  s.winners = s.players.filter((p) => p.score === best).map((p) => p.id);
  s.log.push(`Game over — ${s.winners.map((w) => s.players[w].name).join(' & ')} ${s.winners.length > 1 ? 'tie' : 'wins'} with ${best}`);
}

function fail(msg: string): never {
  throw new Error(msg);
}

export function applyCarc(prev: CState, a: CAction): CState {
  const s: CState = structuredClone(prev);
  const pl = s.players[s.current];
  switch (a.type) {
    case 'place': {
      if (s.phase !== 'place' || !s.drawn) fail('Not time to place a tile');
      const r = ((a.r % 4) + 4) % 4;
      if (!canPlace(s, s.drawn, a.x, a.y, r)) fail('The tile does not fit there');
      s.board[key(a.x, a.y)] = { t: s.drawn, r, meeple: null };
      s.last = { x: a.x, y: a.y };
      s.drawn = null;
      s.phase = 'meeple';
      break;
    }
    case 'meeple': {
      if (s.phase !== 'meeple') fail('Place a tile first');
      const k = key(s.last!.x, s.last!.y);
      if (a.f !== null) {
        if (!meepleOptions(s).includes(a.f)) fail('You cannot place a meeple there');
        s.board[k] = { ...s.board[k], meeple: { owner: s.current, f: a.f } };
        pl.meeples--;
        s.log.push(`${pl.name} placed a meeple on a ${typeName[TILE[s.board[k].t].features[a.f].type]}`);
      }
      scoreCompleted(s);
      s.current = (s.current + 1) % s.players.length;
      s.turn++;
      draw(s);
      break;
    }
  }
  if (s.log.length > 200) s.log = s.log.slice(-200);
  return s;
}
