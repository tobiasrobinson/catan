import { Board, Edge, Port, RESOURCES, Resource, Terrain, Tile, Vertex } from './types';
import { shuffle } from './rng';

const SQ3 = Math.sqrt(3);
const NEIGHBORS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export function pips(n: number | null): number {
  return n == null ? 0 : 6 - Math.abs(7 - n);
}

/** Standard 19-hex board in axial coords (pointy-top, unit hex size). */
export function generateBoard(rand: () => number): Board {
  const coords: [number, number][] = [];
  for (let r = -2; r <= 2; r++)
    for (let q = -2; q <= 2; q++) if (Math.abs(q + r) <= 2) coords.push([q, r]);

  const terrains = shuffle<Terrain>(
    [
      ...Array<Terrain>(4).fill('wood'),
      ...Array<Terrain>(3).fill('brick'),
      ...Array<Terrain>(4).fill('sheep'),
      ...Array<Terrain>(4).fill('wheat'),
      ...Array<Terrain>(3).fill('ore'),
      'desert',
    ],
    rand,
  );

  const tiles: Tile[] = coords.map(([q, r], id) => ({
    id, q, r, x: SQ3 * (q + r / 2), y: 1.5 * r, terrain: terrains[id], number: null, vertices: [],
  }));

  const vertices: Vertex[] = [];
  const vkey = new Map<string, number>();
  const edges: Edge[] = [];
  const ekey = new Map<string, number>();

  for (const t of tiles) {
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      const x = t.x + Math.cos(a);
      const y = t.y + Math.sin(a);
      const k = `${Math.round(x * 100)},${Math.round(y * 100)}`;
      let id = vkey.get(k);
      if (id === undefined) {
        id = vertices.length;
        vkey.set(k, id);
        vertices.push({ id, x, y, tiles: [], adj: [], edges: [] });
      }
      vertices[id].tiles.push(t.id);
      ids.push(id);
    }
    t.vertices = ids;
    for (let i = 0; i < 6; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % 6];
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      let id = ekey.get(k);
      if (id === undefined) {
        id = edges.length;
        ekey.set(k, id);
        edges.push({ id, v: [a, b], tiles: [] });
        vertices[a].adj.push(b);
        vertices[b].adj.push(a);
        vertices[a].edges.push(id);
        vertices[b].edges.push(id);
      }
      edges[id].tiles.push(t.id);
    }
  }

  // Number tokens; avoid adjacent 6/8.
  const idx = new Map(coords.map(([q, r], i) => [`${q},${r}`, i]));
  const tileNeighbors = (t: Tile) =>
    NEIGHBORS.map(([dq, dr]) => idx.get(`${t.q + dq},${t.r + dr}`)).filter(
      (x): x is number => x !== undefined,
    );
  const nums = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  const red = (n: number | null) => n === 6 || n === 8;
  for (let attempt = 0; attempt < 2000; attempt++) {
    const sh = shuffle(nums, rand);
    let i = 0;
    for (const t of tiles) t.number = t.terrain === 'desert' ? null : sh[i++];
    const bad = tiles.some((t) => red(t.number) && tileNeighbors(t).some((n) => red(tiles[n].number)));
    if (!bad) break;
  }

  // Ports: 9 spread evenly around the coast.
  const coastal = edges
    .filter((e) => e.tiles.length === 1)
    .map((e) => {
      const a = vertices[e.v[0]];
      const b = vertices[e.v[1]];
      return { e, ang: Math.atan2((a.y + b.y) / 2, (a.x + b.x) / 2) };
    })
    .sort((a, b) => a.ang - b.ang);
  const types = shuffle<Resource | 'any'>(['any', 'any', 'any', 'any', ...RESOURCES], rand);
  const ports: Port[] = types.map((type, i) => {
    const e = coastal[Math.round((i * coastal.length) / 9)].e;
    return { type, edge: e.id, vertices: [e.v[0], e.v[1]] };
  });

  return { tiles, vertices, edges, ports };
}
