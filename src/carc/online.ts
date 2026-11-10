import type { OnlineGame } from '../net/protocol';
import { CAction, CState, applyCarc, createCarc } from './engine';
import { aiCarc } from './ai';

export const carcGame: OnlineGame<CState, CAction> = {
  id: 'carcassonne',
  title: 'Carcassonne',
  blurb: 'Lay tiles to build cities, roads and farms; claim them with your meeples.',
  minPlayers: 2,
  maxPlayers: 5,
  create: createCarc,
  apply: applyCarc,
  aiAct: aiCarc,
  actor: (s) => (s.phase === 'gameOver' ? null : s.current),
  isAI: (s, seat) => s.players[seat].isAI,
  setAI: (s, seat, ai) => ({ ...s, players: s.players.map((p) => (p.id === seat ? { ...p, isAI: ai } : p)) }),
  authorize: (s, seat) => (s.phase === 'gameOver' ? 'The game is over' : s.current !== seat ? "It's not your turn" : null),
  // Only the draw order is secret.
  redact: (s) => ({ ...s, seed: 0, bag: s.bag.map(() => '?') }),
  turn: (s) => s.turn,
};
