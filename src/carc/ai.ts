import { CAction, CState, Region, isComplete, key, legalPlacements, majority, meepleOptions, neighbours8, regionValue, regions } from './engine';

/**
 * Greedy heuristic: try every legal placement × meeple choice and score the
 * resulting board for the current player — points already locked in plus a
 * discounted guess at what unfinished regions will be worth.
 */
export function aiCarc(s: CState): CAction {
  const me = s.current;
  if (s.phase === 'meeple') {
    const best = bestMeeple(s, me);
    return { type: 'meeple', f: best.f };
  }
  let best = { score: -Infinity, x: 0, y: 0, r: 0 };
  for (const p of legalPlacements(s, s.drawn!)) {
    const placed = withTile(s, p.x, p.y, p.r);
    const { score } = bestMeeple(placed, me);
    // Tiny jitter so equal moves don't always pick the same corner.
    const v = score + Math.random() * 0.01;
    if (v > best.score) best = { score: v, ...p };
  }
  return { type: 'place', x: best.x, y: best.y, r: best.r };
}

function withTile(s: CState, x: number, y: number, r: number): CState {
  return {
    ...s,
    board: { ...s.board, [key(x, y)]: { t: s.drawn!, r, meeple: null } },
    last: { x, y },
    drawn: null,
    phase: 'meeple',
  };
}

function bestMeeple(s: CState, me: number): { f: number | null; score: number } {
  let best: { f: number | null; score: number } = { f: null, score: evaluate(s, me) };
  const k = key(s.last!.x, s.last!.y);
  for (const f of meepleOptions(s)) {
    const t = {
      ...s,
      board: { ...s.board, [k]: { ...s.board[k], meeple: { owner: me, f } } },
      players: s.players.map((p) => (p.id === me ? { ...p, meeples: p.meeples - 1 } : p)),
    };
    const v = evaluate(t, me);
    if (v > best.score) best = { f, score: v };
  }
  return best;
}

/** How much a region is likely to be worth if it's left to grow. */
function potential(s: CState, reg: Region, progress: number, completeCities: Set<number>): number {
  if (isComplete(s, reg)) return regionValue(s, reg, false);
  switch (reg.type) {
    case 'road':
      return reg.tiles.size * 0.9 + (reg.open <= 1 ? 1 : 0);
    case 'city': {
      // Each open edge needs another tile; big open cities often stay unfinished.
      const finishOdds = Math.max(0.15, 0.9 - 0.15 * reg.open - 0.6 * progress);
      const full = 2 * (reg.tiles.size + reg.pennants) + 2;
      const partial = reg.tiles.size + reg.pennants;
      return finishOdds * full + (1 - finishOdds) * partial;
    }
    case 'monastery': {
      const n = neighbours8(s, reg.parts[0][0]);
      return 1 + n + (8 - n) * (0.8 - 0.6 * progress);
    }
    case 'field': {
      let v = 0;
      for (const c of reg.cities) v += completeCities.has(c) ? 3 : 3 * (0.5 - 0.3 * progress);
      return v;
    }
  }
}

export function evaluate(s: CState, me: number): number {
  const progress = 1 - s.bag.length / 71;
  const R = regions(s);
  const done = new Set(R.list.filter((r) => r.type === 'city' && r.open === 0).map((r) => r.id));
  const others = s.players.length - 1;
  let v = 0;
  for (const reg of R.list) {
    if (!reg.meeples.length) continue;
    const owners = majority(reg);
    const val = potential(s, reg, progress, done);
    if (owners.includes(me)) v += val;
    // Points for an opponent are bad, but each opponent is only one of several rivals.
    for (const o of owners) if (o !== me) v -= val / others;
    // Meeples stuck in unfinished things are a cost; farmers never come back.
    const mine = reg.meeples.filter((m) => m.owner === me).length;
    if (!isComplete(s, reg)) v -= mine * (reg.type === 'field' ? 4 * (1 - progress) + 1 : 1.2);
  }
  // Running low on meeples hurts flexibility.
  const left = s.players[me].meeples;
  if (left <= 1) v -= 3;
  else if (left <= 3) v -= 1;
  return v;
}
