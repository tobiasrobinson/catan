export type Resource = 'wood' | 'brick' | 'sheep' | 'wheat' | 'ore';
export const RESOURCES: Resource[] = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
export type Terrain = Resource | 'desert';
export type ResCount = Record<Resource, number>;
export type DevType = 'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly' | 'victoryPoint';

export interface Tile {
  id: number;
  q: number;
  r: number;
  x: number;
  y: number;
  terrain: Terrain;
  number: number | null;
  vertices: number[];
}
export interface Vertex {
  id: number;
  x: number;
  y: number;
  tiles: number[];
  adj: number[];
  edges: number[];
}
export interface Edge {
  id: number;
  v: [number, number];
  tiles: number[];
}
export interface Port {
  type: Resource | 'any';
  edge: number;
  vertices: [number, number];
}
export interface Board {
  tiles: Tile[];
  vertices: Vertex[];
  edges: Edge[];
  ports: Port[];
}

export interface Building {
  owner: number;
  city: boolean;
}
export interface DevCard {
  type: DevType;
  boughtTurn: number;
}
export interface Player {
  id: number;
  name: string;
  color: string;
  isAI: boolean;
  resources: ResCount;
  devCards: DevCard[];
  knightsPlayed: number;
  roadLength: number;
}

export type Phase =
  | 'setupSettlement'
  | 'setupRoad'
  | 'roll'
  | 'discard'
  | 'robber'
  | 'main'
  | 'roadBuilding'
  | 'gameOver';

export interface GameState {
  seed: number;
  board: Board;
  players: Player[];
  buildings: (Building | null)[];
  roads: (number | null)[];
  robber: number;
  bank: ResCount;
  devDeck: DevType[];
  current: number;
  phase: Phase;
  setupOrder: number[];
  setupIndex: number;
  lastSetupVertex: number | null;
  turn: number;
  dice: [number, number] | null;
  discards: number[];
  robberReturn: 'roll' | 'main';
  freeRoads: number;
  playedDevThisTurn: boolean;
  tradesThisTurn: number;
  longestRoadOwner: number | null;
  largestArmyOwner: number | null;
  winner: number | null;
  rng: number;
  log: string[];
}

export type Action =
  | { type: 'buildSettlement'; vertex: number }
  | { type: 'buildRoad'; edge: number }
  | { type: 'buildCity'; vertex: number }
  | { type: 'rollDice' }
  | { type: 'discard'; player: number; cards: ResCount }
  | { type: 'moveRobber'; tile: number; victim: number | null }
  | { type: 'buyDev' }
  | { type: 'playKnight' }
  | { type: 'playRoadBuilding' }
  | { type: 'playYearOfPlenty'; resources: [Resource, Resource] }
  | { type: 'playMonopoly'; resource: Resource }
  | { type: 'bankTrade'; give: Resource; get: Resource }
  | { type: 'playerTrade'; partner: number; give: ResCount; get: ResCount }
  | { type: 'endTurn' };
