import { useState } from 'react';
import { GameState } from './engine/types';
import { createGame, PlayerConfig } from './engine/reducer';
import { LocalGame } from './ui/GameView';
import { HostScreen, loadHostSave } from './net/HostScreen';
import { GuestScreen } from './net/GuestScreen';

const SAVE_KEY = 'catan-save-v1';
const NAME_KEY = 'catan-name';

function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

type Screen =
  | { t: 'menu' }
  | { t: 'localSetup' }
  | { t: 'local'; game: GameState }
  | { t: 'host'; resume: boolean }
  | { t: 'join'; room: string };

const joinParam = () => new URLSearchParams(location.search).get('join')?.trim().toLowerCase() || '';

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
      return <LocalGame initial={screen.game} saveKey={SAVE_KEY} onQuit={toMenu} />;
    case 'localSetup':
      return <SetupScreen onStart={(game) => setScreen({ t: 'local', game })} onBack={toMenu} />;
    case 'host':
      return <HostScreen hostName={name.trim() || 'Host'} resume={screen.resume ? loadHostSave() : null} onQuit={toMenu} />;
    case 'join':
      if (joined && name.trim()) return <GuestScreen room={screen.room} name={name.trim()} onQuit={toMenu} />;
      return (
        <div className="setup">
          <h1>Join Catan game</h1>
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
  const [code, setCode] = useState('');
  const saved = loadSave();
  const hosted = loadHostSave();
  const room = code.trim().toLowerCase().replace(/.*[?&]join=/, '');
  return (
    <div className="setup">
      <h1>Catan</h1>
      <div className="panel">
        <h3>Play online with friends</h3>
        <input placeholder="Your name" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
        {hosted?.game && hosted.game.phase !== 'gameOver' && (
          <button className="primary" onClick={() => go({ t: 'host', resume: true })}>
            Resume hosted game (turn {hosted.game.turn}, room {hosted.room})
          </button>
        )}
        <button className="primary" disabled={!name.trim()} onClick={() => go({ t: 'host', resume: false })}>
          Host a new game
        </button>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (room) go({ t: 'join', room }); }}>
          <input placeholder="Room code or invite link" value={code} onChange={(e) => setCode(e.target.value)} />
          <button disabled={!room}>Join</button>
        </form>
      </div>
      <div className="panel">
        <h3>Play on this device</h3>
        {saved && saved.phase !== 'gameOver' && (
          <button onClick={() => go({ t: 'local', game: saved })}>Continue saved game (turn {saved.turn})</button>
        )}
        <button onClick={() => go({ t: 'localSetup' })}>New local game</button>
      </div>
    </div>
  );
}

function SetupScreen({ onStart, onBack }: { onStart: (g: GameState) => void; onBack: () => void }) {
  const [players, setPlayers] = useState<PlayerConfig[]>([
    { name: 'You', isAI: false },
    { name: 'Computer 1', isAI: true },
    { name: 'Computer 2', isAI: true },
    { name: 'Computer 3', isAI: true },
  ]);
  const [count, setCount] = useState(4);
  const [seed, setSeed] = useState('');

  const update = (i: number, patch: Partial<PlayerConfig>) =>
    setPlayers(players.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const start = () => {
    const s = seed.trim() ? Number(seed) || hashString(seed) : undefined;
    onStart(createGame(players.slice(0, count), s));
  };

  return (
    <div className="setup">
      <h1>Local game</h1>
      <div className="panel">
        <div className="row">
          Players:
          {[3, 4].map((n) => (
            <button key={n} className={count === n ? 'active' : ''} onClick={() => setCount(n)}>{n}</button>
          ))}
        </div>
        {players.slice(0, count).map((p, i) => (
          <div key={i} className="row">
            <input value={p.name} onChange={(e) => update(i, { name: e.target.value })} />
            <button className={!p.isAI ? 'active' : ''} onClick={() => update(i, { isAI: false })}>Human</button>
            <button className={p.isAI ? 'active' : ''} onClick={() => update(i, { isAI: true })}>Computer</button>
          </div>
        ))}
        <div className="row">
          <input placeholder="Board seed (optional)" value={seed} onChange={(e) => setSeed(e.target.value)} />
        </div>
        <button className="primary" onClick={start}>Start game</button>
      </div>
      <p className="small muted">
        Multiple humans = hot-seat: hands are hidden between turns. Game auto-saves in this browser.
      </p>
      <button onClick={onBack}>Back</button>
    </div>
  );
}

function hashString(s: string) {
  let h = 0;
  for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
