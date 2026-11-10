import { Action, GameState, RESOURCES, ResCount } from './types';
import { actingPlayer, hasRes, totalCards } from './rules';
import { applyAction, createGame } from './reducer';
import { aiAcceptTrade, aiAct } from '../ai/heuristic';
import type { OnlineGame } from '../net/protocol';

export type Resp = 'accept' | 'decline' | 'pending';

/** A trade offer from the current player, open to everyone else. */
export interface Offer {
  id: number;
  from: number;
  give: ResCount;
  get: ResCount;
  responses: Record<number, Resp>;
}

export type CatanCustom =
  | { t: 'offer'; give: ResCount; get: ResCount }
  | { t: 'cancelOffer' }
  | { t: 'respond'; id: number; accept: boolean };

/**
 * Check that `seat` is allowed to perform `a` right now. The reducer validates
 * the game rules; this only checks *who* is acting. Returns an error or null.
 */
export function authorize(g: GameState, seat: number, a: Action, offer: Offer | null): string | null {
  if (g.phase === 'gameOver') return 'The game is over';
  if (a.type === 'discard') {
    return a.player === seat && g.discards[seat] > 0 ? null : 'You do not need to discard';
  }
  if (actingPlayer(g) !== seat || g.current !== seat) return "It's not your turn";
  if (a.type === 'playerTrade' && !g.players[a.partner]?.isAI) {
    const ok =
      offer &&
      offer.from === seat &&
      offer.responses[a.partner] === 'accept' &&
      RESOURCES.every((r) => offer.give[r] === a.give[r] && offer.get[r] === a.get[r]);
    if (!ok) return `${g.players[a.partner]?.name ?? 'That player'} has not accepted this trade`;
  }
  return null;
}

/** Strip information a given seat should not see (other hands' dev cards, deck order, rng). */
export function redact(g: GameState, seat: number): GameState {
  const reveal = g.phase === 'gameOver';
  return {
    ...g,
    rng: 0,
    seed: 0,
    devDeck: g.devDeck.map(() => 'knight'),
    // The seed determines the deck order and dice, so scrub it from the log too.
    log: g.log.slice(-100).map((l) => l.replace(/\(seed \d+\)/, '').trimEnd()),
    players: g.players.map((p) =>
      p.id === seat || reveal ? p : { ...p, devCards: p.devCards.map((c) => ({ ...c, type: 'knight' as const })) },
    ),
  };
}

export const catanGame: OnlineGame<GameState, Action, Offer, CatanCustom> = {
  id: 'catan',
  title: 'Catan',
  blurb: 'Build roads and settlements, trade resources, first to 10 points.',
  minPlayers: 3,
  maxPlayers: 4,
  create: (players, seed) => createGame(players, seed),
  apply: applyAction,
  aiAct,
  aiFallback: () => ({ type: 'endTurn' }),
  actor: (s) => (s.phase === 'gameOver' ? null : actingPlayer(s)),
  isAI: (s, seat) => s.players[seat].isAI,
  setAI: (s, seat, ai) => ({ ...s, players: s.players.map((p) => (p.id === seat ? { ...p, isAI: ai } : p)) }),
  authorize,
  redact,
  turn: (s) => s.turn,
  extras: {
    onCustom(game, seat, c, offer) {
      switch (c.t) {
        case 'offer': {
          if (game.current !== seat || game.phase !== 'main') return { error: 'You can only offer trades on your turn' };
          if (!totalCards(c.give) || !totalCards(c.get)) return { error: 'Both sides must give something' };
          if (!hasRes(game.players[seat].resources, c.give)) return { error: 'You lack those cards' };
          const responses: Offer['responses'] = {};
          for (const o of game.players) {
            if (o.id === seat) continue;
            if (!hasRes(o.resources, c.get)) responses[o.id] = 'decline';
            else if (o.isAI) responses[o.id] = aiAcceptTrade(game, o.id, seat, c.give, c.get) ? 'accept' : 'decline';
            else responses[o.id] = 'pending';
          }
          return { x: { id: (offer?.id ?? 0) + 1, from: seat, give: c.give, get: c.get, responses } };
        }
        case 'cancelOffer':
          return { x: offer?.from === seat ? null : offer };
        case 'respond': {
          if (!offer || offer.id !== c.id || offer.responses[seat] !== 'pending') return { x: offer };
          const ok = c.accept && hasRes(game.players[seat].resources, offer.get);
          return { x: { ...offer, responses: { ...offer.responses, [seat]: ok ? 'accept' : 'decline' } } };
        }
      }
    },
    // Offers expire after a trade happens or once the turn/phase moves on.
    after: (prev, next, a, offer) =>
      a.type === 'playerTrade' || next.turn !== prev.turn || next.phase !== 'main' ? null : offer,
  },
};
