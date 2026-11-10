import { useEffect, useRef, useState } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { GuestMsg, HostMsg, LobbySeat, PEER_PREFIX, PING_MS, TIMEOUT_MS } from './protocol';
import { GAMES } from '../games';

export function GuestScreen({ room, name, onQuit }: { room: string; name: string; onQuit: () => void }) {
  const [status, setStatus] = useState('Connecting…');
  const [rejected, setRejected] = useState('');
  const [gameId, setGameId] = useState<string | null>(null);
  const [lobby, setLobby] = useState<LobbySeat[] | null>(null);
  const [seat, setSeat] = useState<number | null>(null);
  const [game, setGame] = useState<unknown | null>(null);
  const [extra, setExtra] = useState<unknown | null>(null);
  const [connected, setConnected] = useState<boolean[]>([]);
  const [error, setError] = useState('');
  const connRef = useRef<DataConnection | null>(null);

  useEffect(() => {
    let dead = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastSeen = Date.now();
    const peer = new Peer();

    const connect = () => {
      if (dead) return;
      clearTimeout(retry);
      connRef.current?.close();
      lastSeen = Date.now();
      setStatus('Connecting to host…');
      const conn = peer.connect(PEER_PREFIX + room, { reliable: true });
      connRef.current = conn;
      conn.on('open', () => {
        setStatus('');
        conn.send({ t: 'hello', name } satisfies GuestMsg);
      });
      conn.on('data', (data) => {
        const msg = data as HostMsg;
        lastSeen = Date.now();
        switch (msg.t) {
          case 'lobby':
            setGameId(msg.game);
            setLobby(msg.seats);
            setSeat(msg.seat);
            break;
          case 'state':
            setGameId(msg.game);
            setGame(msg.state);
            setSeat(msg.seat);
            setExtra(msg.extra);
            setConnected(msg.connected);
            setError('');
            break;
          case 'error':
            setError(msg.message);
            break;
          case 'ping':
            break;
          case 'rejected':
            dead = true;
            setRejected(msg.reason);
            break;
        }
      });
      conn.on('close', () => {
        if (dead || connRef.current !== conn) return;
        setStatus('Lost connection to host, retrying…');
        retry = setTimeout(connect, 3000);
      });
    };

    peer.on('open', connect);
    const beat = setInterval(() => {
      const c = connRef.current;
      if (dead || !c) return;
      if (c.open && Date.now() - lastSeen > TIMEOUT_MS) {
        setStatus('Host stopped responding, reconnecting…');
        connect();
      } else if (c.open) {
        c.send({ t: 'ping' } satisfies GuestMsg);
      }
    }, PING_MS);
    peer.on('disconnected', () => !dead && peer.reconnect());
    peer.on('error', (e) => {
      if (dead) return;
      if (e.type === 'peer-unavailable') {
        setStatus('Host not reachable (is their tab open?). Retrying…');
        clearTimeout(retry);
        retry = setTimeout(connect, 4000);
      } else {
        setStatus(`Network error: ${e.type}`);
      }
    });
    return () => {
      dead = true;
      clearTimeout(retry);
      clearInterval(beat);
      peer.destroy();
    };
  }, [room, name]);

  const send = (msg: GuestMsg) => {
    const c = connRef.current;
    if (!c?.open) {
      setError('Not connected to the host');
      return false;
    }
    c.send(msg);
    return true;
  };

  const entry = gameId ? GAMES[gameId] : null;
  const over = !!(entry && game && entry.def.actor(game) === null);
  const leave = () => {
    if (!game || over || confirm('Leave the game? You can rejoin with the same name.')) onQuit();
  };

  if (rejected || (gameId && !entry)) {
    return (
      <div className="setup">
        <h1>Couldn't join</h1>
        <p>{rejected || 'The host is playing a game this version does not know. Try reloading the page.'}</p>
        <button onClick={onQuit}>Back</button>
      </div>
    );
  }

  if (!entry || !game || seat === null) {
    return (
      <div className="setup">
        <h1>Joining {entry ? entry.def.title : 'game'} ({room})</h1>
        {status && <div className="muted">{status}</div>}
        {lobby && (
          <div className="panel">
            <div>Waiting for the host to start…</div>
            {lobby.map((s, i) => (
              <div key={i}>
                {s.name}
                {i === seat && <i className="small muted"> (you)</i>}
                {i === 0 && <i className="small muted"> (host)</i>}
                {!s.human && <i className="small muted"> — open seat</i>}
              </div>
            ))}
          </div>
        )}
        <button onClick={leave}>Leave</button>
      </div>
    );
  }

  const players = (game as { players: { id: number; name: string; isAI: boolean }[] }).players;
  const offline = players.filter((p, i) => i > 0 && i !== seat && !p.isAI && connected[i] === false);
  const { View } = entry;

  return (
    <View
      game={game}
      seat={seat}
      dispatch={(a) => send({ t: 'action', action: a })}
      sendCustom={(c) => send({ t: 'custom', data: c })}
      extra={extra}
      error={error}
      onQuit={leave}
      quitLabel="Leave"
      banner={
        <>
          {status && <div className="banner">{status}</div>}
          {offline.map((p) => (
            <div key={p.id} className="banner">{p.name} disconnected — waiting for them or the host.</div>
          ))}
        </>
      }
    />
  );
}
