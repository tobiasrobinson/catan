import { useEffect, useRef, useState } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { GameEntry, GuestMsg, HostMsg, LobbySeat, PEER_PREFIX, PING_MS, TIMEOUT_MS, makeRoomCode } from './protocol';
import { useAI, useSpeed } from './rooms';

const SAVE_KEY = 'room-host-v2';
const OLD_CATAN_KEY = 'catan-host-v1';

export interface HostSave {
  gameId: string;
  room: string;
  count: number;
  seats: LobbySeat[];
  game: unknown | null;
}

export function loadHostSave(): HostSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return JSON.parse(raw) as HostSave;
    // Hosted games from before multi-game support were always Catan.
    const old = localStorage.getItem(OLD_CATAN_KEY);
    if (old) return { gameId: 'catan', ...(JSON.parse(old) as Omit<HostSave, 'gameId'>) };
  } catch {
    /* corrupt save */
  }
  return null;
}
export function clearHostSave() {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(OLD_CATAN_KEY);
}

interface Guest {
  conn: DataConnection;
  seat: number | null;
  lastSeen: number;
}

const aiSeat = (i: number): LobbySeat => ({ name: `Computer ${i}`, human: false, connected: false });

export function HostScreen({
  entry, hostName, resume, onQuit,
}: { entry: GameEntry; hostName: string; resume: HostSave | null; onQuit: () => void }) {
  const { def, View } = entry;
  const [room] = useState(() => resume?.room ?? makeRoomCode());
  const [count, setCount] = useState(resume?.count ?? Math.min(4, def.maxPlayers));
  const [seats, setSeats] = useState<LobbySeat[]>(() => {
    if (resume) return resume.seats.map((s, i) => ({ ...s, connected: i === 0 }));
    return Array.from({ length: def.maxPlayers }, (_, i) => (i === 0 ? { name: hostName, human: true, connected: true } : aiSeat(i)));
  });
  const [game, setGame] = useState<unknown | null>(resume?.game ?? null);
  const [extra, setExtra] = useState<unknown | null>(null);
  const [status, setStatus] = useState('Connecting to matchmaking server…');
  const [error, setError] = useState('');
  const [speed, setSpeed] = useSpeed();

  const guests = useRef(new Map<string, Guest>());
  // Latest values for use inside PeerJS callbacks.
  const st = useRef({ game, extra, seats, count });
  st.current = { game, extra, seats, count };

  const send = (conn: DataConnection, msg: HostMsg) => {
    if (conn.open) conn.send(msg);
  };

  // ---- state changes (shared by host UI, guests and AI) ----

  /** Apply an action without permission checks. Returns an error or null. */
  const step = (a: unknown): string | null => {
    const { game, extra } = st.current;
    if (!game) return 'The game has not started';
    try {
      const next = def.apply(game, a);
      const x = def.extras ? def.extras.after(game, next, a, extra) : null;
      st.current.game = next;
      st.current.extra = x;
      setGame(next);
      setExtra(x);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  /** Returns an error message, or null on success. */
  const handle = (seat: number, msg: GuestMsg): string | null => {
    const { game, extra } = st.current;
    if (!game) return 'The game has not started';
    if (msg.t === 'action') return def.authorize(game, seat, msg.action, extra) ?? step(msg.action);
    if (msg.t === 'custom' && def.extras) {
      const r = def.extras.onCustom(game, seat, msg.data, extra);
      if ('error' in r) return r.error;
      st.current.extra = r.x;
      setExtra(r.x);
    }
    return null;
  };

  const onHello = (id: string, name: string) => {
    const g = guests.current.get(id);
    if (!g) return;
    name = name.trim().slice(0, 20) || 'Guest';
    const { seats, game, count } = st.current;
    // Rejoin: same name as an existing human seat (e.g. after a page reload).
    let seat = seats.findIndex((s, i) => i > 0 && i < count && s.human && s.name.toLowerCase() === name.toLowerCase());
    if (seat < 0 && !game) seat = seats.findIndex((s, i) => i > 0 && i < count && !s.human);
    if (seat < 0) {
      send(g.conn, { t: 'rejected', reason: game ? 'This game has already started.' : 'The room is full.' });
      setTimeout(() => g.conn.close(), 500);
      return;
    }
    for (const [oid, o] of guests.current) {
      if (oid !== id && o.seat === seat) {
        o.seat = null;
        o.conn.close();
      }
    }
    g.seat = seat;
    setSeats((prev) => prev.map((s, i) => (i === seat ? { name: game ? s.name : name, human: true, connected: true } : s)));
    // If the AI was covering for them, hand control back.
    if (game && def.isAI(game, seat)) setGame(def.setAI(game, seat, false));
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
      if (game) send(g.conn, { t: 'state', game: def.id, state: def.redact(game, g.seat), seat: g.seat, extra, connected });
      else send(g.conn, { t: 'lobby', game: def.id, seats: seats.slice(0, count), seat: g.seat });
    }
  }, [game, extra, seats, count]);

  useEffect(() => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ gameId: def.id, room, count, seats, game } satisfies HostSave));
    localStorage.removeItem(OLD_CATAN_KEY);
  }, [room, count, seats, game]);

  useAI(def, game, step, speed);

  const quit = () => {
    if (game && def.actor(game) !== null && !confirm('End this online game for everyone?')) return;
    clearHostSave();
    onQuit();
  };

  const link = `${location.origin}${location.pathname}?join=${room}`;

  if (!game) {
    const kick = (i: number) => {
      for (const g of guests.current.values()) if (g.seat === i) g.conn.close();
      setSeats((prev) => prev.map((s, j) => (j === i ? aiSeat(i) : s)));
    };
    const begin = () => setGame(def.create(seats.slice(0, count).map((s) => ({ name: s.name, isAI: !s.human }))));
    const counts = Array.from({ length: def.maxPlayers - def.minPlayers + 1 }, (_, i) => def.minPlayers + i);
    return (
      <div className="setup">
        <h1>Host {def.title}</h1>
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
            {counts.map((n) => (
              <button
                key={n}
                className={count === n ? 'active' : ''}
                disabled={seats.slice(n).some((s) => s.human)}
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

  const nPlayers = (game as { players: unknown[] }).players.length;
  const dropped = seats.map((s, i) => ({ ...s, i })).filter((s) => s.i > 0 && s.i < nPlayers && s.human && !s.connected);

  const banner = (
    <>
      {status && <div className="banner">{status}</div>}
      {dropped.map((s) => (
        <div key={s.i} className="banner">
          {s.name} disconnected.{' '}
          {def.isAI(game, s.i) ? (
            <i>AI is playing for them until they rejoin.</i>
          ) : (
            <button onClick={() => setGame(def.setAI(game, s.i, true))}>Let AI play for {s.name}</button>
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
    <View
      game={game}
      seat={0}
      dispatch={(a) => local({ t: 'action', action: a })}
      sendCustom={(c) => local({ t: 'custom', data: c })}
      extra={extra}
      error={error}
      onQuit={quit}
      quitLabel="End game"
      speed={speed}
      setSpeed={setSpeed}
      banner={banner}
    />
  );
}
