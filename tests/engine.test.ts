import { describe, expect, it } from 'vitest';
import { createGame, applyAction } from '../src/engine/reducer';
import { aiAct } from '../src/ai/heuristic';
import { RESOURCES, GameState } from '../src/engine/types';
import { canPlaceSettlement, longestRoad, portRatios } from '../src/engine/rules';

const cfg = (n: number, ai = true) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, isAI: ai }));

describe('board', () => {
  it('has the standard topology', () => {
    const g = createGame(cfg(4), 1);
    expect(g.board.tiles).toHaveLength(19);
    expect(g.board.vertices).toHaveLength(54);
    expect(g.board.edges).toHaveLength(72);
    expect(g.board.ports).toHaveLength(9);
    expect(g.board.tiles.filter((t) => t.number === null)).toHaveLength(1);
    const portVerts = g.board.ports.flatMap((p) => p.vertices);
    expect(new Set(portVerts).size).toBe(18);
  });
  it('is reproducible from a seed', () => {
    expect(createGame(cfg(3), 42).board).toEqual(createGame(cfg(3), 42).board);
  });
});

describe('rules', () => {
  it('enforces the distance rule', () => {
    let g = createGame(cfg(3), 5);
    g = applyAction(g, { type: 'buildSettlement', vertex: 0 });
    const adj = g.board.vertices[0].adj[0];
    expect(canPlaceSettlement(g, 1, adj, true)).toBe(false);
  });

  it('computes longest road and breaks it with an opponent settlement', () => {
    const g = createGame(cfg(3), 7);
    // 5 edges around the centre hex
    const vs = g.board.tiles[9].vertices;
    const edgeBetween = (a: number, b: number) =>
      g.board.vertices[a].edges.find((e) => g.board.edges[e].v.includes(b))!;
    for (let i = 0; i < 5; i++) g.roads[edgeBetween(vs[i], vs[i + 1])] = 0;
    expect(longestRoad(g, 0)).toBe(5);
    // opponent settlement at vs[2] splits it 2 + 3
    g.buildings[vs[2]] = { owner: 1, city: false };
    expect(longestRoad(g, 0)).toBe(3);
    // own settlement does not break it
    g.buildings[vs[2]] = { owner: 0, city: false };
    expect(longestRoad(g, 0)).toBe(5);
  });

  it('gives port ratios', () => {
    const g = createGame(cfg(3), 9);
    const port = g.board.ports[0];
    g.buildings[port.vertices[0]] = { owner: 0, city: false };
    const r = portRatios(g, 0);
    if (port.type === 'any') expect(Object.values(r).every((x) => x === 3)).toBe(true);
    else expect(r[port.type]).toBe(2);
  });
});

function checkInvariants(g: GameState) {
  for (const r of RESOURCES) {
    const total = g.bank[r] + g.players.reduce((a, p) => a + p.resources[r], 0);
    expect(total).toBe(19);
    expect(g.bank[r]).toBeGreaterThanOrEqual(0);
    for (const p of g.players) expect(p.resources[r]).toBeGreaterThanOrEqual(0);
  }
  const dev = g.devDeck.length + g.players.reduce((a, p) => a + p.devCards.length + p.knightsPlayed, 0);
  expect(dev).toBeLessThanOrEqual(25);
}

describe('AI simulation', () => {
  it('AI-only games run to completion without illegal actions', () => {
    let finished = 0;
    const turns: number[] = [];
    const N = 60;
    for (let seed = 1; seed <= N; seed++) {
      let g = createGame(cfg(seed % 2 ? 4 : 3), seed);
      let steps = 0;
      while (g.phase !== 'gameOver' && steps < 5000) {
        g = applyAction(g, aiAct(g));
        steps++;
        if (steps % 50 === 0) checkInvariants(g);
      }
      checkInvariants(g);
      if (g.phase === 'gameOver') {
        finished++;
        turns.push(g.turn);
      }
    }
    const avg = turns.reduce((a, b) => a + b, 0) / turns.length;
    console.log(`finished ${finished}/${N}, avg turns ${avg.toFixed(1)}`);
    expect(finished).toBeGreaterThanOrEqual(N * 0.9);
  }, 120000);
});
