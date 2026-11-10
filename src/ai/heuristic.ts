import { Action, GameState, RESOURCES, ResCount, Resource } from '../engine/types';
import { pips } from '../engine/board';
import {
  COSTS, PIECES, actingPlayer, canPlayDev, emptyRes, hasRes, legalCities, legalRoads, legalSettlements,
  legalSetupRoads, pieceCounts, portRatios, robberVictims, totalCards, touchesOwnRoad, vertexOpen,
  victoryPoints,
} from '../engine/rules';

const WEIGHT: ResCount = { wood: 1.1, brick: 1.1, sheep: 0.85, wheat: 1.05, ore: 1.0 };

type Goal = 'city' | 'settlement' | 'road' | 'dev';
const GOAL_COST: Record<Goal, ResCount> = {
  city: COSTS.city, settlement: COSTS.settlement, road: COSTS.road, dev: COSTS.dev,
};

function argmax<T>(xs: T[], f: (x: T) => number): T {
  let best = xs[0];
  let bv = -Infinity;
  for (const x of xs) {
    const v = f(x);
    if (v > bv) {
      bv = v;
      best = x;
    }
  }
  return best;
}

const deficit = (r: ResCount, c: ResCount) => RESOURCES.reduce((s, k) => s + Math.max(0, c[k] - r[k]), 0);

/** Expected pips per resource from a player's buildings. */
export function production(s: GameState, p: number): ResCount {
  const out = emptyRes();
  for (const v of s.board.vertices) {
    const b = s.buildings[v.id];
    if (b?.owner !== p) continue;
    for (const t of v.tiles) {
      const tile = s.board.tiles[t];
      if (tile.terrain !== 'desert') out[tile.terrain] += pips(tile.number) * (b.city ? 2 : 1);
    }
  }
  return out;
}

export function vertexScore(s: GameState, p: number, v: number): number {
  const prod = production(s, p);
  let score = 0;
  const seen = new Set<Resource>();
  for (const t of s.board.vertices[v].tiles) {
    const tile = s.board.tiles[t];
    if (tile.terrain === 'desert') continue;
    const pp = pips(tile.number);
    score += pp * WEIGHT[tile.terrain];
    if (prod[tile.terrain] === 0 && !seen.has(tile.terrain)) score += 2.5;
    if (tile.id === s.robber) score -= pp * 0.5;
    seen.add(tile.terrain);
  }
  for (const port of s.board.ports) {
    if (!port.vertices.includes(v)) continue;
    if (port.type === 'any') score += 1.5;
    else score += prod[port.type] * 0.3 + (seen.has(port.type) ? 1.5 : 0.3);
  }
  return score;
}

function vertexPips(s: GameState, v: number) {
  return s.board.vertices[v].tiles.reduce((a, t) => a + pips(s.board.tiles[t].number), 0);
}

/** Best settlement-spot value reachable within 2 edges from `start`. */
function spotValue(s: GameState, p: number, start: number): number {
  let best = -Infinity;
  const dist = new Map([[start, 0]]);
  const q = [start];
  while (q.length) {
    const v = q.shift()!;
    const d = dist.get(v)!;
    if (vertexOpen(s, v)) best = Math.max(best, vertexScore(s, p, v) - 2.5 * d);
    if (d >= 2) continue;
    const b = s.buildings[v];
    if (b && b.owner !== p) continue;
    for (const e of s.board.vertices[v].edges) {
      if (s.roads[e] !== null) continue;
      const [a, c] = s.board.edges[e].v;
      const o = a === v ? c : a;
      if (!dist.has(o)) {
        dist.set(o, d + 1);
        q.push(o);
      }
    }
  }
  return best;
}

export function bestRoad(s: GameState, p: number): { edge: number; value: number } | null {
  let best: { edge: number; value: number } | null = null;
  const connected = (v: number) => s.buildings[v]?.owner === p || touchesOwnRoad(s, p, v);
  for (const e of legalRoads(s, p)) {
    const [a, b] = s.board.edges[e].v;
    const far = connected(a) ? b : a;
    const value = spotValue(s, p, far);
    if (!best || value > best.value) best = { edge: e, value };
  }
  return best;
}

function chooseGoal(s: GameState, p: number): Goal {
  const res = s.players[p].resources;
  const pc = pieceCounts(s, p);
  const canSettle = pc.settlements < PIECES.settlement && legalSettlements(s, p).length > 0;
  const canCity = pc.cities < PIECES.city && legalCities(s, p).length > 0;
  if (canSettle && canCity)
    return deficit(res, COSTS.city) < deficit(res, COSTS.settlement) ? 'city' : 'settlement';
  if (canSettle) return 'settlement';
  const road = pc.settlements < PIECES.settlement && pc.roads < PIECES.road ? bestRoad(s, p) : null;
  const roadOk = road !== null && road.value > -Infinity;
  if (canCity && (deficit(res, COSTS.city) <= 2 || !roadOk)) return 'city';
  if (roadOk) return 'road';
  if (canCity) return 'city';
  return 'dev';
}

function robberHurts(s: GameState, p: number): boolean {
  const tile = s.board.tiles[s.robber];
  return tile.number !== null && tile.vertices.some((v) => s.buildings[v]?.owner === p);
}

function chooseRobber(s: GameState, p: number): Action {
  let best = -Infinity;
  let tile = s.board.tiles.find((t) => t.id !== s.robber)!.id;
  for (const t of s.board.tiles) {
    if (t.id === s.robber) continue;
    let score = 0;
    let own = false;
    for (const v of t.vertices) {
      const b = s.buildings[v];
      if (!b) continue;
      if (b.owner === p) own = true;
      else score += (b.city ? 2 : 1) * (1 + 0.2 * victoryPoints(s, b.owner, false));
    }
    score *= pips(t.number);
    if (own) score -= 100;
    if (robberVictims(s, t.id).length) score += 0.5;
    if (score > best) {
      best = score;
      tile = t.id;
    }
  }
  const victims = robberVictims(s, tile);
  const victim = victims.length
    ? argmax(victims, (v) => victoryPoints(s, v, false) * 10 + totalCards(s.players[v].resources))
    : null;
  return { type: 'moveRobber', tile, victim };
}

function chooseDiscard(s: GameState, p: number): ResCount {
  const res = { ...s.players[p].resources };
  const need = GOAL_COST[chooseGoal(s, p)];
  const drop = emptyRes();
  for (let i = 0; i < s.discards[p]; i++) {
    const r = argmax(
      RESOURCES.filter((k) => res[k] > 0),
      (k) => res[k] - need[k],
    );
    res[r]--;
    drop[r]++;
  }
  return drop;
}

function bankTradeFor(s: GameState, p: number, cost: ResCount): Action | null {
  const res = s.players[p].resources;
  const ratio = portRatios(s, p);
  for (const get of RESOURCES) {
    if (res[get] >= cost[get] || s.bank[get] < 1) continue;
    let give: Resource | null = null;
    let left = -1;
    for (const g of RESOURCES) {
      if (g === get) continue;
      const sur = res[g] - cost[g];
      if (sur >= ratio[g] && sur - ratio[g] > left) {
        left = sur - ratio[g];
        give = g;
      }
    }
    if (give) return { type: 'bankTrade', give, get };
  }
  return null;
}

/** Would AI `partner` accept receiving `give` in exchange for paying `get` to `proposer`? */
export function aiAcceptTrade(s: GameState, partner: number, proposer: number, give: ResCount, get: ResCount): boolean {
  const pr = s.players[partner].resources;
  if (!hasRes(pr, get)) return false;
  if (victoryPoints(s, proposer, false) >= 8) return false;
  const cost = GOAL_COST[chooseGoal(s, partner)];
  const after = { ...pr };
  for (const r of RESOURCES) after[r] += give[r] - get[r];
  const before = deficit(pr, cost);
  const aft = deficit(after, cost);
  return aft < before || (aft === before && totalCards(give) > totalCards(get));
}

function playerTradeFor(s: GameState, p: number, cost: ResCount): Action | null {
  if (s.tradesThisTurn >= 2) return null;
  const res = s.players[p].resources;
  const surplus = RESOURCES.filter((r) => res[r] > cost[r]).sort((a, b) => res[b] - cost[b] - (res[a] - cost[a]));
  for (const get of RESOURCES) {
    if (res[get] >= cost[get]) continue;
    for (const g of surplus) {
      for (const o of s.players) {
        if (o.id === p || !o.isAI || o.resources[get] < 1) continue;
        const give = emptyRes();
        give[g] = 1;
        const want = emptyRes();
        want[get] = 1;
        if (aiAcceptTrade(s, o.id, p, give, want)) return { type: 'playerTrade', partner: o.id, give, get: want };
      }
    }
  }
  return null;
}

function yopPicks(s: GameState, res: ResCount, cost: ResCount): [Resource, Resource] | null {
  const bank = { ...s.bank };
  const picks: Resource[] = [];
  for (const r of RESOURCES) {
    for (let i = res[r]; i < cost[r] && picks.length < 2; i++) {
      if (bank[r] > 0) {
        bank[r]--;
        picks.push(r);
      }
    }
  }
  for (const r of ['ore', 'wheat', 'sheep', 'wood', 'brick'] as Resource[]) {
    while (picks.length < 2 && bank[r] > 0) {
      bank[r]--;
      picks.push(r);
    }
  }
  return picks.length === 2 ? [picks[0], picks[1]] : null;
}

function mainAction(s: GameState, p: number): Action {
  const pl = s.players[p];
  const res = pl.resources;
  const pc = pieceCounts(s, p);

  if (canPlayDev(s, p, 'knight')) {
    const holder = s.largestArmyOwner;
    const need = holder === null ? 3 : s.players[holder].knightsPlayed + 1;
    if (robberHurts(s, p) || (holder !== p && pl.knightsPlayed + 1 >= need)) return { type: 'playKnight' };
  }
  if (canPlayDev(s, p, 'monopoly')) {
    const counts = RESOURCES.map((r) => s.players.reduce((a, o) => a + (o.id === p ? 0 : o.resources[r]), 0));
    const i = counts.indexOf(Math.max(...counts));
    if (counts[i] >= 4) return { type: 'playMonopoly', resource: RESOURCES[i] };
  }
  if (canPlayDev(s, p, 'roadBuilding') && pc.roads <= PIECES.road - 2) {
    const b = bestRoad(s, p);
    if (b && b.value > -Infinity) return { type: 'playRoadBuilding' };
  }
  const goal = chooseGoal(s, p);
  const cost = GOAL_COST[goal];
  if (canPlayDev(s, p, 'yearOfPlenty') && deficit(res, cost) > 0) {
    const picks = yopPicks(s, res, cost);
    if (picks) return { type: 'playYearOfPlenty', resources: picks };
  }
  if (pc.cities < PIECES.city && hasRes(res, COSTS.city)) {
    const c = legalCities(s, p);
    if (c.length) return { type: 'buildCity', vertex: argmax(c, (v) => vertexPips(s, v)) };
  }
  if (pc.settlements < PIECES.settlement && hasRes(res, COSTS.settlement)) {
    const c = legalSettlements(s, p);
    if (c.length) return { type: 'buildSettlement', vertex: argmax(c, (v) => vertexScore(s, p, v)) };
  }
  if (goal === 'road' && pc.roads < PIECES.road && hasRes(res, COSTS.road)) {
    const b = bestRoad(s, p);
    if (b) return { type: 'buildRoad', edge: b.edge };
  }
  if (goal === 'dev' && s.devDeck.length && hasRes(res, COSTS.dev)) return { type: 'buyDev' };

  const bt = bankTradeFor(s, p, cost);
  if (bt) return bt;
  const pt = playerTradeFor(s, p, cost);
  if (pt) return pt;

  if (s.devDeck.length && hasRes(res, COSTS.dev) && totalCards(res) >= 8) return { type: 'buyDev' };
  return { type: 'endTurn' };
}

/** Choose the next action for whichever AI player must act. */
export function aiAct(s: GameState): Action {
  const p = actingPlayer(s);
  switch (s.phase) {
    case 'setupSettlement': {
      const spots = legalSettlements(s, p, true);
      return { type: 'buildSettlement', vertex: argmax(spots, (v) => vertexScore(s, p, v)) };
    }
    case 'setupRoad': {
      const v = s.lastSetupVertex!;
      const es = legalSetupRoads(s);
      return {
        type: 'buildRoad',
        edge: argmax(es, (e) => {
          const [a, b] = s.board.edges[e].v;
          return spotValue(s, p, a === v ? b : a);
        }),
      };
    }
    case 'roll':
      if (canPlayDev(s, p, 'knight') && robberHurts(s, p)) return { type: 'playKnight' };
      return { type: 'rollDice' };
    case 'discard':
      return { type: 'discard', player: p, cards: chooseDiscard(s, p) };
    case 'robber':
      return chooseRobber(s, p);
    case 'roadBuilding': {
      const b = bestRoad(s, p);
      return { type: 'buildRoad', edge: b ? b.edge : legalRoads(s, p)[0] };
    }
    case 'main':
      return mainAction(s, p);
    default:
      throw new Error('AI has nothing to do');
  }
}
