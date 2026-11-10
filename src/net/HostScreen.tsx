import { useEffect, useRef, useState } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { Action, GameState, ResCount } from '../engine/types';
import { applyAction, createGame } from '../engine/reducer';
import { hasRes, totalCards } from '../engine/rules';
import { aiAcceptTrade } from '../ai/heuristic';
import { GameView, useAI, useSpeed } from '../ui/GameView';
import {
  GuestMsg, HostMsg, LobbySeat, Offer, PEER_PREFIX, PING_MS, TIMEOUT_MS, authorize, makeRoomCode, redact,
} from './protocol';

export const HOST_SAVE_KEY = 'catan-host-v1';

interface HostSave {
  room: string;
  count: number;
  seats: LobbySeat[];
  game: GameState | null;
}

export function loadHostSave(): HostSave | null {
  try {
    const raw = localStorage.getItem(HOST_SAVE_KEY);
    return raw ? (JSON.parse(raw) as HostSave) : null;
  } catch {
    return null;
  }
}

interface Guest {
  conn: DataConnection;
  seat: number | null;
  lastSeen: number;
}

const aiSeat = (i: number): LobbySeat => ({ name: `Computer ${i}`, human: false, connected: false });

export function HostScreen({ hostName, resume, onQuit }: { hostName: string; resume: HostSave | null; onQuit: () => void }) {
  const [room] = useState(() => resume?.room ?? makeRoomCode());
  const [count, setCount] = useState(resume?.count ?? 4);
  const [seats, setSeats] = useState<LobbySeat[]>(
    () => resume?.seats.map((s, i) => (i === 0 ? { ...s, connected: true } : { ...s, connected: false }))
      ?? [{ name: hostName, human: true, connected: true }, aiSeat(1), aiSeat(2), aiSeat(3)],
  );
  const [game, setGame] = useState<GameState | null>(resume?.game ?? null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [status, setStatus] = useState('Connecting to matchmaking server…');
  const [error, setError] = useState('');
  const [speed, setSpeed] = useSpeed();

  const guests = useRef(new Map<string, Guest>());
  // Latest values for use inside PeerJS callbacks.
  const st = useRef({ game, offer, seats, count });
  st.current = { game, offer, seats, count };

  const send = (conn: DataConnection, msg: HostMsg) => {
    if (conn.open) conn.send(msg);
  };

  // ---- message handling (shared by the host's own UI and remote guests) ----

  /** Returns an error message, or null on success. */
  const handle = (seat: number, msg: GuestMsg): string | null => {
    const { game, offer } = st.current;
    if (!game) return 'The game has not started';
    switch (msg.t) {
      case 'action': {
        const err = authorize(game, seat, msg.action, offer);
        if (err) return err;
        try {
          const next = applyAction(game, msg.action);
          st.current.game = next;
          setGame(next);
          if (msg.action.type === 'playerTrade') setOffer(null);
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      }
      case 'offer': {
        if (game.current !== seat || game.phase !== 'main') return 'You can only offer trades on your turn';
        if (!totalCards(msg.give) || !totalCards(msg.get)) return 'Both sides must give something';
        if (!hasRes(game.players[seat].resources, msg.give)) return 'You lack those cards';
        const responses: Offer['responses'] = {};
        for (const o of game.players) {
          if (o.id === seat) continue;
          if (!hasRes(o.resources, msg.get)) responses[o.id] = 'decline';
          else if (o.isAI) responses[o.id] = aiAcceptTrade(game, o.id, seat, msg.give, msg.get) ? 'accept' : 'decline';
          else responses[o.id] = 'pending';
        }
        setOffer({ id: (offer?.id ?? 0) + 1, from: seat, give: msg.give, get: msg.get, responses });
        return null;
      }
      case 'cancelOffer':
        if (offer?.from === seat) setOffer(null);
        return null;
      case 'respond': {
        if (!offer || offer.id !== msg.id || offer.responses[seat] !== 'pending') return null;
        const ok = msg.accept && hasRes(game.players[seat].resources, offer.get);
        setOffer({ ...offer, responses: { ...offer.responses, [seat]: ok ? 'accept' : 'decline' } });
        return null;
      }
      case 'hello':
      case 'ping':
        return null;
    }
  };

  const onHello = (id: string, name: string) => {
    const g = guests.current.get(id);
    if (!g) return;
    name = name.trim().slice(0, 20) || 'Guest';
    const { seats, game, count } = st.current;
    // Rejoin: same name as an existing human seat (e.g. after a page reload).
    let seat = seats.findIndex((s, i) => i > 0 && s.human && s.name.toLowerCase() === name.toLowerCase());
    if (seat < 0 && !game) seat = seats.findIndex((s, i) => i > 0 && i < count && !s.human);
    if (seat < 0) {
      send(g.conn, { t: 'rejected', reason: game ? 'This game has already started.' : 'The room is full.' });
      setTimeout(() => g.conn.close(), 500);
      return;
    }
    // Kick any stale connection holding this seat.
    for (const [oid, o] of guests.current) {
      if (oid !== id && o.seat === seat) {
        o.seat = null;
        o.conn.close();
      }
    }
    g.seat = seat;
    setSeats((prev) => prev.map((s, i) => (i === seat ? { name: game ? s.name : name, human: true, connected: true } : s)));
    // If the AI was covering for them, hand control back.
    if (game?.players[seat].isAI) {
      setGame({ ...game, players: game.players.map((p) => (p.id === seat ? { ...p, isAI: false } : p)) });
    }
  };

  const dropGuest = (id: string) => {
    const g = guests.current.get(id);
    if (!g) return;
    guests.current.delete(id);
    g.conn.close();
    if (g.seat === null) return;
    const seat = g.seat;
    if ([...guests.current.values()].some((o) => o.seat === seat)) return;
    setSeats((prev) => prev.map((s, i) => (i !== seat ? s : st.current.game ? { ...s, connected: false } : aiSeat(i))));
  };

  // ---- PeerJS setup ----
  useEffect(() => {
    let peer: Peer | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let dead = false;

    const start = () => {
      peer = new Peer(PEER_PREFIX + room);
      peer.on('open', () => setStatus(''));
      peer.on('disconnected', () => {
        if (dead) return;
        setStatus('Lost matchmaking server, reconnecting…');
        peer?.reconnect();
      });
      peer.on('error', (e) => {
        if (dead) return;
        if (e.type === 'unavailable-id' && attempts++ < 20) {
          // Our previous session (before a reload) still holds the ID; it frees up shortly.
          setStatus('Reclaiming room code…');
          peer?.destroy();
          retry = setTimeout(start, 3000);
        } else if (e.type !== 'peer-unavailable') {
          setStatus(`Network error: ${e.type}`);
        }
      });
      peer.on('connection', (conn) => {
        conn.on('open', () => guests.current.set(conn.connectionId, { conn, seat: null, lastSeen: Date.now() }));
        conn.on('data', (data) => {
          const msg = data as GuestMsg;
          const g = guests.current.get(conn.connectionId);
          if (!g) return;
          g.lastSeen = Date.now();
          if (msg.t === 'ping') return;
          if (msg.t === 'hello') return onHello(conn.connectionId, msg.name);
          if (g.seat === null) return;
          const err = handle(g.seat, msg);
          if (err) send(conn, { t: 'error', message: err });
        });
        conn.on('close', () => dropGuest(conn.connectionId));
        conn.on('error', () => dropGuest(conn.connectionId));
      });
    };
    start();

    // Heartbeat: WebRTC often never fires 'close' when a tab just disappears.
    const beat = setInterval(() => {
      const now = Date.now();
      for (const [id, g] of guests.current) {
        if (now - g.lastSeen > TIMEOUT_MS) dropGuest(id);
        else send(g.conn, { t: 'ping' });
      }
    }, PING_MS);

    return () => {
      dead = true;
      clearTimeout(retry);
      clearInterval(beat);
      peer?.destroy();
    };
  }, [room]);

  // ---- broadcast state to guests whenever it changes ----
  useEffect(() => {
    const connected = seats.map((s) => s.connected);
    for (const g of guests.current.values()) {
      if (g.seat === null) continue;
      if (game) send(g.conn, { t: 'state', game: redact(game, g.seat), seat: g.seat, offer, connected });
      else send(g.conn, { t: 'lobby', seats: seats.slice(0, count), seat: g.seat });
    }
  }, [game, offer, seats, count]);

  // Offers expire when the turn moves on.
  useEffect(() => setOffer(null), [game?.turn, game?.phase === 'main']);

  useEffect(() => {
    localStorage.setItem(HOST_SAVE_KEY, JSON.stringify({ room, count, seats, game } satisfies HostSave));
  }, [room, count, seats, game]);

  useAI(game ?? DUMMY, (g) => setGame(g), game ? speed : 1e9);

  const quit = () => {
    if (!confirm('End this online game for everyone?')) return;
    localStorage.removeItem(HOST_SAVE_KEY);
    onQuit();
  };

  const link = `${location.origin}${location.pathname}?join=${room}`;

  if (!game) {
    const kick = (i: number) => {
      for (const g of guests.current.values()) if (g.seat === i) g.conn.close();
      setSeats((prev) => prev.map((s, j) => (j === i ? aiSeat(i) : s)));
    };
    const begin = () => {
      const used = seats.slice(0, count);
      setGame(createGame(used.map((s) => ({ name: s.name, isAI: !s.human }))));
    };
    return (
      <div className="setup">
        <h1>Host a game</h1>
        {status && <div className="muted">{status}</div>}
        <div className="panel">
          <div>Send this link to your friends:</div>
          <div className="row">
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
            <button onClick={() => navigator.clipboard?.writeText(link)}>Copy</button>
          </div>
          <div className="small muted">Room code: <b>{room}</b>. Keep this tab open — the game runs in your browser.</div>
        </div>
        <div className="panel">
          <div className="row">
            Players:
            {[3, 4].map((n) => (
              <button
                key={n}
                className={count === n ? 'active' : ''}
                disabled={n < count && seats[n].human}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
          {seats.slice(0, count).map((s, i) => (
            <div key={i} className="row between">
              <span>
                {s.name}
                {i === 0 && <i className="small muted"> (you)</i>}
                {!s.human && <i className="small muted"> — open seat, AI if nobody joins</i>}
              </span>
              {i > 0 && s.human && <button onClick={() => kick(i)}>Remove</button>}
            </div>
          ))}
          <button className="primary" onClick={begin}>Start game</button>
        </div>
        <button onClick={quit}>Cancel</button>
      </div>
    );
  }

  const dropped = seats
    .map((s, i) => ({ ...s, i }))
    .filter((s) => s.i > 0 && s.i < game.players.length && s.human && !s.connected);

  const banner = (
    <>
      {status && <div className="banner">{status}</div>}
      {dropped.map((s) => (
        <div key={s.i} className="banner">
          {s.name} disconnected.{' '}
          {game.players[s.i].isAI ? (
            <i>AI is playing for them until they rejoin.</i>
          ) : (
            <button
              onClick={() =>
                setGame({ ...game, players: game.players.map((p) => (p.id === s.i ? { ...p, isAI: true } : p)) })
              }
            >
              Let AI play for {s.name}
            </button>
          )}
        </div>
      ))}
      <div className="banner small muted">Invite link: {link}</div>
    </>
  );

  const local = (msg: GuestMsg) => {
    const err = handle(0, msg);
    setError(err ?? '');
    return !err;
  };

  return (
    <GameView
      game={game}
      dispatch={(a: Action) => local({ t: 'action', action: a })}
      error={error}
      seat={0}
      onQuit={quit}
      speed={speed}
      setSpeed={setSpeed}
      banner={banner}
      quitLabel="End game"
      trade={{
        offer,
        propose: (give: ResCount, get: ResCount) => local({ t: 'offer', give, get }),
        cancel: () => local({ t: 'cancelOffer' }),
        respond: (accept) => offer && local({ t: 'respond', id: offer.id, accept }),
      }}
    />
  );
}

// useAI needs a game object even before one exists; with a huge delay it never fires.
const DUMMY = createGame([{ name: '', isAI: false }, { name: '', isAI: false }, { name: '', isAI: false }], 1);
