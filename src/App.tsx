import { useState } from 'react';
import { GAMES } from './games';
import type { GameEntry } from './net/protocol';
import { LocalRoom, LocalSetup } from './net/rooms';
import { HostScreen, clearHostSave, loadHostSave } from './net/HostScreen';
import { GuestScreen } from './net/GuestScreen';

const NAME_KEY = 'catan-name';

type Screen =
  | { t: 'menu' }
  | { t: 'localSetup'; game: string }
  | { t: 'local'; game: string; state: unknown }
  | { t: 'host'; game: string; resume: boolean }
  | { t: 'join'; room: string };

const joinParam = () => new URLSearchParams(location.search).get('join')?.trim().toLowerCase() || '';

function loadLocal(entry: GameEntry): unknown | null {
  try {
    const raw = localStorage.getItem(entry.saveKey);
    const s = raw ? JSON.parse(raw) : null;
    return s && entry.def.actor(s) !== null ? s : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    const room = joinParam();
    return room ? { t: 'join', room } : { t: 'menu' };
  });
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [joined, setJoined] = useState(false);

  const toMenu = () => {
    if (joinParam()) history.replaceState(null, '', location.pathname);
    setJoined(false);
    setScreen({ t: 'menu' });
  };
  const saveName = (n: string) => {
    setName(n);
    localStorage.setItem(NAME_KEY, n);
  };

  switch (screen.t) {
    case 'local':
      return <LocalRoom key={screen.game} entry={GAMES[screen.game]} initial={screen.state} onQuit={toMenu} />;
    case 'localSetup':
      return (
        <LocalSetup
          entry={GAMES[screen.game]}
          onStart={(state) => setScreen({ t: 'local', game: screen.game, state })}
          onBack={toMenu}
        />
      );
    case 'host':
      return (
        <HostScreen
          entry={GAMES[screen.game]}
          hostName={name.trim() || 'Host'}
          resume={screen.resume ? loadHostSave() : null}
          onQuit={toMenu}
        />
      );
    case 'join':
      if (joined && name.trim()) return <GuestScreen room={screen.room} name={name.trim()} onQuit={toMenu} />;
      return (
        <div className="setup">
          <h1>Join game</h1>
          <div className="panel">
            <div className="small muted">Room <b>{screen.room}</b></div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) setJoined(true); }}>
              <input autoFocus placeholder="Your name" maxLength={20} value={name} onChange={(e) => saveName(e.target.value)} />
              <button className="primary" disabled={!name.trim()}>Join</button>
            </form>
            <div className="small muted">Rejoining after a disconnect? Use the same name.</div>
          </div>
          <button onClick={toMenu}>Back</button>
        </div>
      );
    case 'menu':
      return <Menu name={name} setName={saveName} go={setScreen} />;
  }
}

function Menu({ name, setName, go }: { name: string; setName: (n: string) => void; go: (s: Screen) => void }) {
  const [gameId, setGameId] = useState(() => localStorage.getItem('last-game') ?? 'catan');
  const [code, setCode] = useState('');
  const entry = GAMES[gameId] ?? GAMES.catan;
  const pick = (id: string) => {
    setGameId(id);
    localStorage.setItem('last-game', id);
  };
  const saved = loadLocal(entry);
  const hosted = loadHostSave();
  const hostedEntry = hosted && GAMES[hosted.gameId];
  const canResume = !!(hosted?.game && hostedEntry && hostedEntry.def.actor(hosted.game) !== null);
  const room = code.trim().toLowerCase().replace(/.*[?&]join=/, '');

  return (
    <div className="setup">
      <h1>Board games</h1>

      <div className="panel">
        <input placeholder="Your name" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (room) go({ t: 'join', room }); }}>
          <input placeholder="Join: room code or invite link" value={code} onChange={(e) => setCode(e.target.value)} />
          <button disabled={!room}>Join</button>
        </form>
        {canResume && hosted && hostedEntry && (
          <div className="row">
            <button className="primary" onClick={() => go({ t: 'host', game: hosted.gameId, resume: true })}>
              Resume hosted {hostedEntry.def.title} (room {hosted.room})
            </button>
            <button onClick={() => { clearHostSave(); go({ t: 'menu' }); setCode(''); }} title="Discard">✕</button>
          </div>
        )}
      </div>

      <div className="games">
        {Object.entries(GAMES).map(([id, g]) => (
          <button key={id} className={`game-card ${id === gameId ? 'active' : ''}`} onClick={() => pick(id)}>
            <b>{g.def.title}</b>
            <span className="small">{g.def.blurb}</span>
            <span className="small muted">{g.def.minPlayers}–{g.def.maxPlayers} players</span>
          </button>
        ))}
      </div>

      <div className="panel">
        <h3>{entry.def.title}</h3>
        <button className="primary" disabled={!name.trim()} onClick={() => go({ t: 'host', game: gameId, resume: false })}>
          Host online game{!name.trim() && ' (enter your name first)'}
        </button>
        {saved !== null && (
          <button onClick={() => go({ t: 'local', game: gameId, state: saved })}>Continue local game</button>
        )}
        <button onClick={() => go({ t: 'localSetup', game: gameId })}>New local game</button>
      </div>
    </div>
  );
}
