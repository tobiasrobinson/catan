import { Action, GameState, RESOURCES, ResCount } from '../engine/types';
import { actingPlayer } from '../engine/rules';

export type Resp = 'accept' | 'decline' | 'pending';

/** A trade offer from the current player, open to everyone else. */
export interface Offer {
  id: number;
  from: number;
  give: ResCount;
  get: ResCount;
  responses: Record<number, Resp>;
}

export interface LobbySeat {
  name: string;
  /** true = seat is filled by a remote guest (or the host for seat 0) */
  human: boolean;
  connected: boolean;
}

/** Host -> guest */
export type HostMsg =
  | { t: 'lobby'; seats: LobbySeat[]; seat: number }
  | { t: 'state'; game: GameState; seat: number; offer: Offer | null; connected: boolean[] }
  | { t: 'error'; message: string }
  | { t: 'rejected'; reason: string }
  | { t: 'ping' };

/** Guest -> host */
export type GuestMsg =
  | { t: 'hello'; name: string }
  | { t: 'action'; action: Action }
  | { t: 'offer'; give: ResCount; get: ResCount }
  | { t: 'cancelOffer' }
  | { t: 'respond'; id: number; accept: boolean }
  | { t: 'ping' };

/** Both sides ping every PING_MS; a link silent for TIMEOUT_MS is treated as dropped. */
export const PING_MS = 2000;
export const TIMEOUT_MS = 8000;

export const PEER_PREFIX = 'catan-p2p-v1-';

export function makeRoomCode(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

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
