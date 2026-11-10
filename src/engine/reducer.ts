import { Action, DevType, GameState, Player, RESOURCES, ResCount, Resource } from './types';
import { generateBoard } from './board';
import { makeRng, mulberry, shuffle } from './rng';
import {
  COSTS, PIECES, WIN_VP, canPlaceRoad, canPlaceSettlement, canPlayDev, emptyRes, hasRes, legalRoads,
  pieceCounts, portRatios, robberVictims, totalCards, updateAwards, victoryPoints,
} from './rules';

export interface PlayerConfig {
  name: string;
  isAI: boolean;
}

export const COLORS = ['#d32f2f', '#1e63c4', '#f57c00', '#f5f5f5'];

export function createGame(configs: PlayerConfig[], seed = Math.floor(Math.random() * 2 ** 31)): GameState {
  const rand = makeRng(seed);
  const board = generateBoard(rand);
  const deck = shuffle<DevType>(
    [
      ...Array<DevType>(14).fill('knight'),
      'roadBuilding', 'roadBuilding', 'yearOfPlenty', 'yearOfPlenty', 'monopoly', 'monopoly',
      ...Array<DevType>(5).fill('victoryPoint'),
    ],
    rand,
  );
  const idx = configs.map((_, i) => i);
  const players: Player[] = configs.map((c, i) => ({
    id: i, name: c.name, color: COLORS[i], isAI: c.isAI, resources: emptyRes(), devCards: [],
    knightsPlayed: 0, roadLength: 0,
  }));
  return {
    seed,
    board,
    players,
    buildings: board.vertices.map(() => null),
    roads: board.edges.map(() => null),
    robber: board.tiles.find((t) => t.terrain === 'desert')!.id,
    bank: { wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 },
    devDeck: deck,
    current: 0,
    phase: 'setupSettlement',
    setupOrder: [...idx, ...[...idx].reverse()],
    setupIndex: 0,
    lastSetupVertex: null,
    turn: 1,
    dice: null,
    discards: idx.map(() => 0),
    robberReturn: 'main',
    freeRoads: 0,
    playedDevThisTurn: false,
    tradesThisTurn: 0,
    longestRoadOwner: null,
    largestArmyOwner: null,
    winner: null,
    rng: Math.floor(rand() * 2 ** 31),
    log: [`Game started (seed ${seed})`],
  };
}

function fail(msg: string): never {
  throw new Error(msg);
}
function rand(s: GameState): number {
  const [r, n] = mulberry(s.rng);
  s.rng = n;
  return r;
}
function log(s: GameState, msg: string) {
  s.log.push(msg);
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
}
function pay(s: GameState, p: number, cost: ResCount) {
  for (const r of RESOURCES) {
    s.players[p].resources[r] -= cost[r];
    s.bank[r] += cost[r];
  }
}
export const fmtRes = (c: ResCount) =>
  RESOURCES.filter((r) => c[r]).map((r) => `${c[r]} ${r}`).join(', ') || 'nothing';

function validCounts(c: ResCount) {
  return RESOURCES.every((r) => Number.isInteger(c[r]) && c[r] >= 0);
}

function produce(s: GameState, roll: number) {
  const gains = s.players.map(() => emptyRes());
  for (const r of RESOURCES) {
    const demand = s.players.map(() => 0);
    for (const t of s.board.tiles) {
      if (t.number !== roll || t.id === s.robber || t.terrain !== r) continue;
      for (const v of t.vertices) {
        const b = s.buildings[v];
        if (b) demand[b.owner] += b.city ? 2 : 1;
      }
    }
    const total = demand.reduce((a, b) => a + b, 0);
    if (!total) continue;
    const receivers = demand.filter((d) => d > 0).length;
    if (total > s.bank[r]) {
      if (receivers > 1) {
        log(s, `Bank is short on ${r}; nobody receives it`);
        continue;
      }
      const p = demand.findIndex((d) => d > 0);
      demand[p] = s.bank[r];
    }
    demand.forEach((d, p) => {
      gains[p][r] += d;
      s.players[p].resources[r] += d;
      s.bank[r] -= d;
    });
  }
  gains.forEach((g, p) => {
    if (totalCards(g)) log(s, `${s.players[p].name} receives ${fmtRes(g)}`);
  });
}

function takeDev(s: GameState, p: number, type: DevType) {
  if (!canPlayDev(s, p, type)) fail(`Cannot play ${type} now`);
  const pl = s.players[p];
  const i = pl.devCards.findIndex((c) => c.type === type && c.boughtTurn < s.turn);
  pl.devCards.splice(i, 1);
  s.playedDevThisTurn = true;
}

export function applyAction(prev: GameState, a: Action): GameState {
  if (prev.phase === 'gameOver') fail('Game is over');
  const s = structuredClone(prev);
  const p = s.current;
  const pl = s.players[p];
  const name = pl.name;

  switch (a.type) {
    case 'buildSettlement': {
      if (s.phase === 'setupSettlement') {
        if (!canPlaceSettlement(s, p, a.vertex, true)) fail('Cannot place a settlement there');
        s.buildings[a.vertex] = { owner: p, city: false };
        s.lastSetupVertex = a.vertex;
        log(s, `${name} placed a settlement`);
        if (s.setupIndex >= s.players.length) {
          const got = emptyRes();
          for (const t of s.board.vertices[a.vertex].tiles) {
            const terr = s.board.tiles[t].terrain;
            if (terr !== 'desert' && s.bank[terr] > 0) {
              got[terr]++;
              pl.resources[terr]++;
              s.bank[terr]--;
            }
          }
          log(s, `${name} receives ${fmtRes(got)}`);
        }
        s.phase = 'setupRoad';
      } else {
        if (s.phase !== 'main') fail('You cannot build now');
        if (!hasRes(pl.resources, COSTS.settlement)) fail('Not enough resources');
        if (pieceCounts(s, p).settlements >= PIECES.settlement) fail('No settlements left');
        if (!canPlaceSettlement(s, p, a.vertex, false)) fail('Cannot place a settlement there');
        pay(s, p, COSTS.settlement);
        s.buildings[a.vertex] = { owner: p, city: false };
        log(s, `${name} built a settlement`);
      }
      updateAwards(s);
      break;
    }
    case 'buildRoad': {
      if (s.phase === 'setupRoad') {
        const e = s.board.edges[a.edge];
        if (!e || s.roads[a.edge] !== null || !e.v.includes(s.lastSetupVertex!)) fail('Road must touch your new settlement');
        s.roads[a.edge] = p;
        s.setupIndex++;
        if (s.setupIndex >= s.setupOrder.length) {
          s.current = s.setupOrder[0];
          s.phase = 'roll';
          log(s, 'Setup complete');
        } else {
          s.current = s.setupOrder[s.setupIndex];
          s.phase = 'setupSettlement';
        }
        s.lastSetupVertex = s.phase === 'setupSettlement' ? null : s.lastSetupVertex;
      } else if (s.phase === 'roadBuilding') {
        if (!canPlaceRoad(s, p, a.edge)) fail('Cannot place a road there');
        s.roads[a.edge] = p;
        s.freeRoads--;
        log(s, `${name} built a free road`);
        if (s.freeRoads <= 0 || pieceCounts(s, p).roads >= PIECES.road || legalRoads(s, p).length === 0)
          s.phase = 'main';
      } else {
        if (s.phase !== 'main') fail('You cannot build now');
        if (!hasRes(pl.resources, COSTS.road)) fail('Not enough resources');
        if (pieceCounts(s, p).roads >= PIECES.road) fail('No roads left');
        if (!canPlaceRoad(s, p, a.edge)) fail('Cannot place a road there');
        pay(s, p, COSTS.road);
        s.roads[a.edge] = p;
        log(s, `${name} built a road`);
      }
      updateAwards(s);
      break;
    }
    case 'buildCity': {
      if (s.phase !== 'main') fail('You cannot build now');
      const b = s.buildings[a.vertex];
      if (!b || b.owner !== p || b.city) fail('Cities must upgrade your own settlement');
      if (pieceCounts(s, p).cities >= PIECES.city) fail('No cities left');
      if (!hasRes(pl.resources, COSTS.city)) fail('Not enough resources');
      pay(s, p, COSTS.city);
      b.city = true;
      log(s, `${name} built a city`);
      break;
    }
    case 'rollDice': {
      if (s.phase !== 'roll') fail('Not time to roll');
      const d1 = 1 + Math.floor(rand(s) * 6);
      const d2 = 1 + Math.floor(rand(s) * 6);
      s.dice = [d1, d2];
      const sum = d1 + d2;
      log(s, `${name} rolled ${sum}`);
      if (sum === 7) {
        s.discards = s.players.map((x) => {
          const c = totalCards(x.resources);
          return c > 7 ? Math.floor(c / 2) : 0;
        });
        s.robberReturn = 'main';
        s.phase = s.discards.some((d) => d > 0) ? 'discard' : 'robber';
      } else {
        produce(s, sum);
        s.phase = 'main';
      }
      break;
    }
    case 'discard': {
      if (s.phase !== 'discard') fail('No discard needed');
      const need = s.discards[a.player];
      if (!need) fail('That player does not need to discard');
      const hand = s.players[a.player].resources;
      if (!validCounts(a.cards) || totalCards(a.cards) !== need || !hasRes(hand, a.cards))
        fail(`Must discard exactly ${need} cards you own`);
      pay(s, a.player, a.cards);
      s.discards[a.player] = 0;
      log(s, `${s.players[a.player].name} discarded ${fmtRes(a.cards)}`);
      if (s.discards.every((d) => d === 0)) s.phase = 'robber';
      break;
    }
    case 'moveRobber': {
      if (s.phase !== 'robber') fail('Not time to move the robber');
      if (a.tile === s.robber || !s.board.tiles[a.tile]) fail('Robber must move to a different tile');
      s.robber = a.tile;
      const victims = robberVictims(s, a.tile);
      log(s, `${name} moved the robber`);
      if (victims.length) {
        if (a.victim === null || !victims.includes(a.victim)) fail('Choose a valid player to steal from');
        const v = s.players[a.victim];
        const pool = RESOURCES.flatMap((r) => Array<Resource>(v.resources[r]).fill(r));
        const r = pool[Math.floor(rand(s) * pool.length)];
        v.resources[r]--;
        pl.resources[r]++;
        log(s, `${name} stole a card from ${v.name}`);
      }
      s.phase = s.robberReturn;
      break;
    }
    case 'buyDev': {
      if (s.phase !== 'main') fail('Not now');
      if (!s.devDeck.length) fail('No development cards left');
      if (!hasRes(pl.resources, COSTS.dev)) fail('Not enough resources');
      pay(s, p, COSTS.dev);
      pl.devCards.push({ type: s.devDeck.pop()!, boughtTurn: s.turn });
      log(s, `${name} bought a development card`);
      break;
    }
    case 'playKnight': {
      const before = s.phase;
      takeDev(s, p, 'knight');
      pl.knightsPlayed++;
      log(s, `${name} played a Knight`);
      updateAwards(s);
      s.robberReturn = before === 'roll' ? 'roll' : 'main';
      s.phase = 'robber';
      break;
    }
    case 'playRoadBuilding': {
      const left = PIECES.road - pieceCounts(s, p).roads;
      if (left <= 0 || legalRoads(s, p).length === 0) fail('No place to build roads');
      takeDev(s, p, 'roadBuilding');
      s.freeRoads = Math.min(2, left);
      s.phase = 'roadBuilding';
      log(s, `${name} played Road Building`);
      break;
    }
    case 'playYearOfPlenty': {
      const need = emptyRes();
      for (const r of a.resources) need[r]++;
      if (!hasRes(s.bank, need)) fail('Bank does not have those resources');
      takeDev(s, p, 'yearOfPlenty');
      for (const r of RESOURCES) {
        pl.resources[r] += need[r];
        s.bank[r] -= need[r];
      }
      log(s, `${name} played Year of Plenty (${fmtRes(need)})`);
      break;
    }
    case 'playMonopoly': {
      takeDev(s, p, 'monopoly');
      let n = 0;
      for (const o of s.players) {
        if (o.id === p) continue;
        n += o.resources[a.resource];
        o.resources[a.resource] = 0;
      }
      pl.resources[a.resource] += n;
      log(s, `${name} played Monopoly on ${a.resource} and took ${n}`);
      break;
    }
    case 'bankTrade': {
      if (s.phase !== 'main') fail('Not now');
      if (a.give === a.get) fail('Pick two different resources');
      const ratio = portRatios(s, p)[a.give];
      if (pl.resources[a.give] < ratio) fail(`Need ${ratio} ${a.give}`);
      if (s.bank[a.get] < 1) fail(`Bank has no ${a.get}`);
      pl.resources[a.give] -= ratio;
      s.bank[a.give] += ratio;
      pl.resources[a.get]++;
      s.bank[a.get]--;
      log(s, `${name} traded ${ratio} ${a.give} for 1 ${a.get} with the bank`);
      break;
    }
    case 'playerTrade': {
      if (s.phase !== 'main') fail('Not now');
      const partner = s.players[a.partner];
      if (!partner || a.partner === p) fail('Invalid trade partner');
      if (!validCounts(a.give) || !validCounts(a.get)) fail('Invalid trade');
      if (!totalCards(a.give) || !totalCards(a.get)) fail('Both sides must give something');
      if (RESOURCES.some((r) => a.give[r] && a.get[r])) fail('Cannot trade like for like');
      if (!hasRes(pl.resources, a.give)) fail('You lack those cards');
      if (!hasRes(partner.resources, a.get)) fail(`${partner.name} lacks those cards`);
      for (const r of RESOURCES) {
        pl.resources[r] += a.get[r] - a.give[r];
        partner.resources[r] += a.give[r] - a.get[r];
      }
      s.tradesThisTurn++;
      log(s, `${name} traded ${fmtRes(a.give)} to ${partner.name} for ${fmtRes(a.get)}`);
      break;
    }
    case 'endTurn': {
      if (s.phase !== 'main') fail('Cannot end turn now');
      s.current = (p + 1) % s.players.length;
      s.turn++;
      s.phase = 'roll';
      s.dice = null;
      s.playedDevThisTurn = false;
      s.tradesThisTurn = 0;
      s.freeRoads = 0;
      break;
    }
  }

  if (s.phase !== 'setupSettlement' && s.phase !== 'setupRoad' && victoryPoints(s, s.current, true) >= WIN_VP) {
    s.phase = 'gameOver';
    s.winner = s.current;
    log(s, `${s.players[s.current].name} wins with ${victoryPoints(s, s.current, true)} VP!`);
  }
  return s;
}
