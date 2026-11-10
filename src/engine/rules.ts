import { DevType, GameState, RESOURCES, ResCount } from './types';

export const emptyRes = (): ResCount => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
const res = (wood: number, brick: number, sheep: number, wheat: number, ore: number): ResCount => ({
  wood, brick, sheep, wheat, ore,
});

export const COSTS = {
  road: res(1, 1, 0, 0, 0),
  settlement: res(1, 1, 1, 1, 0),
  city: res(0, 0, 0, 2, 3),
  dev: res(0, 0, 1, 1, 1),
};
export const PIECES = { road: 15, settlement: 5, city: 4 };
export const WIN_VP = 10;

export const totalCards = (r: ResCount) => RESOURCES.reduce((s, k) => s + r[k], 0);
export const hasRes = (r: ResCount, c: ResCount) => RESOURCES.every((k) => r[k] >= c[k]);

export function pieceCounts(s: GameState, p: number) {
  let settlements = 0;
  let cities = 0;
  for (const b of s.buildings) {
    if (b?.owner !== p) continue;
    if (b.city) cities++;
    else settlements++;
  }
  return { roads: s.roads.filter((o) => o === p).length, settlements, cities };
}

/** Empty vertex respecting the distance rule. */
export function vertexOpen(s: GameState, v: number): boolean {
  return !s.buildings[v] && s.board.vertices[v].adj.every((a) => !s.buildings[a]);
}

export function touchesOwnRoad(s: GameState, p: number, v: number): boolean {
  return s.board.vertices[v].edges.some((e) => s.roads[e] === p);
}

export function canPlaceSettlement(s: GameState, p: number, v: number, setup: boolean): boolean {
  if (!s.board.vertices[v] || !vertexOpen(s, v)) return false;
  return setup || touchesOwnRoad(s, p, v);
}

export function canPlaceRoad(s: GameState, p: number, e: number): boolean {
  const edge = s.board.edges[e];
  if (!edge || s.roads[e] !== null) return false;
  return edge.v.some((v) => {
    const b = s.buildings[v];
    if (b) return b.owner === p;
    return touchesOwnRoad(s, p, v);
  });
}

export function legalSettlements(s: GameState, p: number, setup = false): number[] {
  return s.board.vertices.filter((v) => canPlaceSettlement(s, p, v.id, setup)).map((v) => v.id);
}
export function legalRoads(s: GameState, p: number): number[] {
  return s.board.edges.filter((e) => canPlaceRoad(s, p, e.id)).map((e) => e.id);
}
export function legalCities(s: GameState, p: number): number[] {
  return s.buildings
    .map((b, i) => (b && b.owner === p && !b.city ? i : -1))
    .filter((i) => i >= 0);
}
export function legalSetupRoads(s: GameState): number[] {
  if (s.lastSetupVertex === null) return [];
  return s.board.vertices[s.lastSetupVertex].edges.filter((e) => s.roads[e] === null);
}

export function portRatios(s: GameState, p: number): ResCount {
  const r: ResCount = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
  for (const port of s.board.ports) {
    if (!port.vertices.some((v) => s.buildings[v]?.owner === p)) continue;
    if (port.type === 'any') for (const k of RESOURCES) r[k] = Math.min(r[k], 3);
    else r[port.type] = 2;
  }
  return r;
}

export function victoryPoints(s: GameState, p: number, includeHidden: boolean): number {
  let vp = 0;
  for (const b of s.buildings) if (b?.owner === p) vp += b.city ? 2 : 1;
  if (s.longestRoadOwner === p) vp += 2;
  if (s.largestArmyOwner === p) vp += 2;
  if (includeHidden) vp += s.players[p].devCards.filter((c) => c.type === 'victoryPoint').length;
  return vp;
}

export function robberVictims(s: GameState, tile: number): number[] {
  const out = new Set<number>();
  for (const v of s.board.tiles[tile].vertices) {
    const b = s.buildings[v];
    if (b && b.owner !== s.current && totalCards(s.players[b.owner].resources) > 0) out.add(b.owner);
  }
  return [...out];
}

export function canPlayDev(s: GameState, p: number, type: DevType): boolean {
  if (p !== s.current || s.playedDevThisTurn || type === 'victoryPoint') return false;
  if (type === 'knight' ? s.phase !== 'roll' && s.phase !== 'main' : s.phase !== 'main') return false;
  return s.players[p].devCards.some((c) => c.type === type && c.boughtTurn < s.turn);
}

/** The player who must act now (discards can be required from non-current players). */
export function actingPlayer(s: GameState): number {
  if (s.phase === 'discard') {
    const i = s.discards.findIndex((d) => d > 0);
    if (i >= 0) return i;
  }
  return s.current;
}

export function longestRoad(s: GameState, p: number): number {
  const { vertices, edges } = s.board;
  let best = 0;
  const used = new Set<number>();
  const blocked = (v: number) => {
    const b = s.buildings[v];
    return b != null && b.owner !== p;
  };
  const dfs = (v: number, len: number) => {
    if (len > best) best = len;
    if (len > 0 && blocked(v)) return;
    for (const e of vertices[v].edges) {
      if (s.roads[e] !== p || used.has(e)) continue;
      used.add(e);
      const [a, b] = edges[e].v;
      dfs(a === v ? b : a, len + 1);
      used.delete(e);
    }
  };
  for (const e of edges) {
    if (s.roads[e.id] !== p) continue;
    dfs(e.v[0], 0);
    dfs(e.v[1], 0);
  }
  return best;
}

export function updateAwards(s: GameState): void {
  const lens = s.players.map((pl) => longestRoad(s, pl.id));
  s.players.forEach((pl, i) => (pl.roadLength = lens[i]));
  const max = Math.max(...lens);
  const prevLR = s.longestRoadOwner;
  if (max < 5) s.longestRoadOwner = null;
  else if (prevLR !== null && lens[prevLR] === max) {
    /* holder keeps on tie */
  } else {
    const c = lens.map((l, i) => (l === max ? i : -1)).filter((i) => i >= 0);
    s.longestRoadOwner = c.length === 1 ? c[0] : null;
  }
  if (s.longestRoadOwner !== prevLR) {
    s.log.push(
      s.longestRoadOwner === null
        ? 'Longest Road is now unclaimed'
        : `${s.players[s.longestRoadOwner].name} takes Longest Road (${max})`,
    );
  }

  for (const pl of s.players) {
    const la = s.largestArmyOwner;
    if (pl.knightsPlayed >= 3 && la !== pl.id && (la === null || pl.knightsPlayed > s.players[la].knightsPlayed)) {
      s.largestArmyOwner = pl.id;
      s.log.push(`${pl.name} takes Largest Army (${pl.knightsPlayed})`);
    }
  }
}
