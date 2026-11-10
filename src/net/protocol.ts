import type { ComponentType, ReactNode } from 'react';

// ---------------------------------------------------------------- game definitions

export interface PlayerSetup {
  name: string;
  isAI: boolean;
}

/** Game-specific out-of-band state handled by the host (e.g. Catan trade offers). */
export interface Extras<S, A, X, C> {
  /** Handle a custom message from `seat`. Return the new extra state, or { error }. */
  onCustom(s: S, seat: number, c: C, x: X | null): { x: X | null } | { error: string };
  /** Called after every successful action (human or AI) to update/expire extra state. */
  after(prev: S, next: S, a: A, x: X | null): X | null;
}

/** Everything the generic host/guest/local code needs to know about a game. */
export interface OnlineGame<S, A, X = null, C = never> {
  id: string;
  title: string;
  blurb: string;
  minPlayers: number;
  maxPlayers: number;
  create(players: PlayerSetup[], seed?: number): S;
  /** Apply an action; throws an Error with a user-facing message if illegal. */
  apply(s: S, a: A): S;
  aiAct(s: S): A;
  /** Tried if the AI's move is rejected, so a buggy AI can't stall the game. */
  aiFallback?(s: S): A;
  /** Seat whose input is awaited, or null when the game is over. */
  actor(s: S): number | null;
  isAI(s: S, seat: number): boolean;
  setAI(s: S, seat: number, ai: boolean): S;
  /** Is `seat` allowed to do `a` right now? (rules are checked by apply) */
  authorize(s: S, seat: number, a: A, x: X | null): string | null;
  /** What `seat` is allowed to see. */
  redact(s: S, seat: number): S;
  turn(s: S): number;
  extras?: Extras<S, A, X, C>;
}

export interface ViewProps<S, A, X = null, C = never> {
  game: S;
  /** 'hotseat' = several humans share this screen; number = this screen controls that seat */
  seat: number | 'hotseat' | null;
  dispatch: (a: A) => boolean;
  error: string;
  extra: X | null;
  /** Only present in online games. */
  sendCustom?: (c: C) => boolean;
  onQuit: () => void;
  quitLabel?: string;
  banner?: ReactNode;
  /** AI speed control; absent for guests (the host runs the AI). */
  speed?: number;
  setSpeed?: (n: number) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface GameEntry {
  def: OnlineGame<any, any, any, any>;
  View: ComponentType<ViewProps<any, any, any, any>>;
  saveKey: string;
}

// ---------------------------------------------------------------- wire protocol

export interface LobbySeat {
  name: string;
  /** filled by a person (the host for seat 0, or a guest) */
  human: boolean;
  connected: boolean;
}

/** Host -> guest */
export type HostMsg =
  | { t: 'lobby'; game: string; seats: LobbySeat[]; seat: number }
  | { t: 'state'; game: string; state: unknown; seat: number; extra: unknown; connected: boolean[] }
  | { t: 'error'; message: string }
  | { t: 'rejected'; reason: string }
  | { t: 'ping' };

/** Guest -> host */
export type GuestMsg =
  | { t: 'hello'; name: string }
  | { t: 'action'; action: unknown }
  | { t: 'custom'; data: unknown }
  | { t: 'ping' };

/** Both sides ping every PING_MS; a link silent for TIMEOUT_MS is treated as dropped. */
export const PING_MS = 2000;
export const TIMEOUT_MS = 8000;

// Unchanged from the Catan-only version so old invite links keep working.
export const PEER_PREFIX = 'catan-p2p-v1-';

export function makeRoomCode(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
