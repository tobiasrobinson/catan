import { describe, expect, it } from 'vitest';
import { TILES, TILE, oppositePort, rotPort, sideType } from '../src/carc/tiles';
import { aiCarc } from '../src/carc/ai';
import {
  CState, applyCarc, canPlace, createCarc, key, legalPlacements, meepleOptions, regions,
} from '../src/carc/engine';

const two = () => createCarc([{ name: 'A', isAI: false }, { name: 'B', isAI: false }], 3);

/** Force the next tile to be `t` for player `p`. */
function give(s: CState, t: string, p = s.current): CState {
  return { ...s, drawn: t, current: p, phase: 'place' };
}
const play = (s: CState, t: string, x: number, y: number, r: number, f: number | null = null) =>
  applyCarc(applyCarc(give(s, t), { type: 'place', x, y, r }), { type: 'meeple', f });

describe('tile set', () => {
  it('has 72 tiles including the start tile', () => {
    expect(TILES.reduce((n, t) => n + t.count, 0) + 1).toBe(72);
    expect(TILES).toHaveLength(24);
  });
  it('every tile assigns each of the 12 edge ports to exactly one feature', () => {
    for (const t of TILES) {
      const ports = t.features.flatMap((f) => f.ports).sort((a, b) => a - b);
      expect(ports, t.id).toEqual([...Array(12).keys()]);
    }
  });
  it('field-city adjacency only points at cities', () => {
    for (const t of TILES)
      for (const f of t.features) for (const c of f.cities ?? []) expect(t.features[c].type, t.id).toBe('city');
  });
  it('port geometry is consistent', () => {
    for (let p = 0; p < 12; p++) {
      expect(oppositePort(oppositePort(p))).toBe(p);
      expect(rotPort(p, 4)).toBe(p);
    }
    expect(oppositePort(0)).toBe(8); // N-west meets S-west
    expect(oppositePort(4)).toBe(10);
    expect(sideType(TILE.E, 0, 0)).toBe('city');
    expect(sideType(TILE.E, 1, 1)).toBe('city'); // rotated clockwise, city faces east
  });
});

describe('placement', () => {
  it('requires matching edges and a neighbour', () => {
    const s = two(); // start tile D at 0,0: city N, road E-W, field S
    expect(canPlace(s, 'E', 0, -1, 2)).toBe(true); // city facing south onto start city
    expect(canPlace(s, 'E', 0, -1, 0)).toBe(false); // field onto city
    expect(canPlace(s, 'U', 1, 0, 1)).toBe(true); // road continues east
    expect(canPlace(s, 'U', 1, 0, 0)).toBe(false);
    expect(canPlace(s, 'B', 5, 5, 0)).toBe(false); // not adjacent
    expect(() => applyCarc(give(s, 'E'), { type: 'place', x: 0, y: -1, r: 0 })).toThrow();
  });
});

describe('scoring', () => {
  it('scores a completed 2-tile city at 4 points and returns the meeple', () => {
    let s = two();
    s = applyCarc(give(s, 'E', 0), { type: 'place', x: 0, y: -1, r: 2 });
    const cityF = TILE.E.features.findIndex((f) => f.type === 'city');
    expect(meepleOptions(s)).toContain(cityF);
    s = applyCarc(s, { type: 'meeple', f: cityF });
    expect(s.players[0].score).toBe(4);
    expect(s.players[0].meeples).toBe(7);
    expect(s.board[key(0, -1)].meeple).toBeNull();
  });

  it('forbids a meeple on an already-claimed region', () => {
    let s = two();
    // A claims the road going east
    s = play(s, 'U', 1, 0, 1, TILE.U.features.findIndex((f) => f.type === 'road'));
    expect(s.players[0].meeples).toBe(6);
    // B extends the same road west — road option must be missing
    s = applyCarc(give(s, 'U', 1), { type: 'place', x: -1, y: 0, r: 1 });
    const roadF = TILE.U.features.findIndex((f) => f.type === 'road');
    expect(meepleOptions(s)).not.toContain(roadF);
  });

  it('scores a road closed by two ends', () => {
    let s = two();
    const roadOnV = TILE.V.features.findIndex((f) => f.type === 'road');
    // V curve: road S-W. Rotated 3 → road W? rotate until road touches W and N/S; just search for fitting rotations.
    const fit = (t: string, x: number, y: number) => legalPlacements(give(s, t), t).find((p) => p.x === x && p.y === y)!;
    // L at (1,0) ends the road east (L has a village); claim the road on the start-adjacent tile
    const pL = fit('L', 1, 0);
    expect(pL).toBeDefined();
    s = applyCarc(give(s, 'L', 0), { type: 'place', ...pL });
    // meeple on the L road that points west (toward start)
    const R = regions(s);
    const lRoads = TILE.L.features.map((f, i) => [f, i] as const).filter(([f]) => f.type === 'road').map(([, i]) => i);
    const westRoad = lRoads.find((i) => R.list[R.of.get(`${key(1, 0)}#${i}`)!].tiles.has(key(0, 0)))!;
    s = applyCarc(s, { type: 'meeple', f: westRoad });
    expect(s.players[0].score).toBe(0); // still open to the west
    const pX = fit('X', -1, 0);
    s = applyCarc(applyCarc(give(s, 'X', 1), { type: 'place', ...pX }), { type: 'meeple', f: null });
    expect(s.players[0].score).toBe(3); // L + start + X
    expect(s.players[0].meeples).toBe(7);
    void roadOnV;
  });

  it('scores monasteries and farms at the end of the game', () => {
    let s = two();
    // Complete the start city with E above it (no meeple), then put a farmer south of the road.
    s = play(s, 'E', 0, -1, 2);
    const farmF = TILE.B.features.findIndex((f) => f.type === 'field');
    const monF = TILE.B.features.findIndex((f) => f.type === 'monastery');
    s = play(s, 'B', 0, 1, 0, monF); // player B's monastery south of start
    // Player A drops a farmer on the field next to the completed city (north strip of D is field [3,11])
    s = play(s, 'B', 1, 1, 0, farmF);
    s = { ...s, bag: [] };
    s = applyCarc(applyCarc(give(s, 'B', 1), { type: 'place', x: -1, y: 1, r: 0 }), { type: 'meeple', f: null });
    expect(s.phase).toBe('gameOver');
    // B's monastery at (0,1): neighbours (0,0),(1,1),(-1,1) = 3 -> 1 + 3 = 4
    expect(s.players[1].score).toBe(4);
    // A's farm: the big southern field touches no city (the start tile's south field doesn't border it) → 0.
    // A got nothing from E (no meeple).
    expect(s.players[0].score).toBe(0);
  });

  it('awards 3 points per completed city to the farmer majority', () => {
    let s = two();
    s = play(s, 'E', 0, -1, 2); // complete start city (no meeple)
    // F: city E+W, fields N and S each border it. Put F east of... simpler: use the D north strip field.
    // Place U east of start continuing the road; its north field joins D's [3,11] strip which borders the city.
    const uNorth = TILE.U.features.findIndex((f, i) => f.type === 'field' && i === 2); // ports 8..0 (west/north side)
    s = play(s, 'U', 1, 0, 1, uNorth);
    s = { ...s, bag: [] };
    s = applyCarc(applyCarc(give(s, 'U', 1), { type: 'place', x: -1, y: 0, r: 1 }), { type: 'meeple', f: null });
    const R = regions(s);
    const farm = R.list.find((r) => r.type === 'field' && r.meeples.length)!;
    expect(farm.tiles.has(key(0, 0))).toBe(true);
    expect(farm.meeples[0].owner).toBe(1); // turns alternate: B placed the U with the farmer
    expect(s.players[1].score).toBe(3);
    expect(s.players[0].score).toBe(0);
  });
});

describe('full games', () => {
  it('random legal play always terminates with sane state', () => {
    for (let seed = 1; seed <= 15; seed++) {
      let s = createCarc([0, 1, 2, 3, 4].slice(0, 2 + (seed % 4)).map((i) => ({ name: `P${i}`, isAI: true })), seed);
      let rnd = seed;
      const pick = <T,>(a: T[]) => a[(rnd = (rnd * 1103515245 + 12345) % 2 ** 31) % a.length];
      let guard = 0;
      while (s.phase !== 'gameOver' && guard++ < 500) {
        if (s.phase === 'place') s = applyCarc(s, { type: 'place', ...pick(legalPlacements(s, s.drawn!)) });
        else s = applyCarc(s, { type: 'meeple', f: pick([null, ...meepleOptions(s)]) });
      }
      expect(s.phase).toBe('gameOver');
      expect(Object.keys(s.board).length).toBeGreaterThan(60);
      // Meeples are conserved: in supply + on board = 7 each
      for (const p of s.players) {
        const onBoard = Object.values(s.board).filter((b) => b.meeple?.owner === p.id).length;
        expect(p.meeples + onBoard).toBe(7);
      }
      expect(s.winners!.length).toBeGreaterThan(0);
    }
  });
});

describe('AI', () => {
  it('beats a random player and finishes a game quickly', () => {
    let wins = 0;
    const t0 = Date.now();
    for (let seed = 1; seed <= 6; seed++) {
      let s = createCarc([{ name: 'AI', isAI: true }, { name: 'Rnd', isAI: true }], seed);
      let rnd = seed;
      const pick = <T,>(a: T[]) => a[(rnd = (rnd * 1103515245 + 12345) % 2 ** 31) % a.length];
      while (s.phase !== 'gameOver') {
        if (s.current === 0) s = applyCarc(s, aiCarc(s));
        else if (s.phase === 'place') s = applyCarc(s, { type: 'place', ...pick(legalPlacements(s, s.drawn!)) });
        else s = applyCarc(s, { type: 'meeple', f: pick([null, ...meepleOptions(s)]) });
      }
      if (s.players[0].score > s.players[1].score) wins++;
    }
    console.log(`AI won ${wins}/6 vs random in ${Date.now() - t0}ms`);
    expect(wins).toBeGreaterThanOrEqual(5);
  }, 60000);
});
