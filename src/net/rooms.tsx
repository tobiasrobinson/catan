import { useEffect, useRef, useState } from 'react';
import type { GameEntry, OnlineGame, PlayerSetup } from './protocol';

export function useSpeed() {
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem('catan-speed')) || 600);
  useEffect(() => localStorage.setItem('catan-speed', String(speed)), [speed]);
  return [speed, setSpeed] as const;
}

/**
 * Plays AI turns. Only the screen that owns the authoritative state (local or host)
 * should run this. `step` applies an action and returns an error message or null.
 */
export function useAI<S, A>(def: OnlineGame<S, A, any, any>, game: S | null, step: (a: A) => string | null, speed: number) {
  const actor = game ? def.actor(game) : null;
  const aiTurn = game !== null && actor !== null && def.isAI(game, actor);
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    if (!aiTurn || !game) return;
    const id = setTimeout(() => {
      let err: string | null;
      try {
        err = stepRef.current(def.aiAct(game));
      } catch (e) {
        err = (e as Error).message;
      }
      if (err) {
        console.error('AI error', err);
        const fb = def.aiFallback?.(game);
        if (fb) stepRef.current(fb);
      }
    }, speed);
    return () => clearTimeout(id);
  }, [game, speed, aiTurn]);
}

/** A game played entirely on this device (vs AI and/or hot-seat). */
export function LocalRoom({ entry, initial, onQuit }: { entry: GameEntry; initial: unknown; onQuit: () => void }) {
  const { def, View } = entry;
  const [game, setGame] = useState(initial);
  const [error, setError] = useState('');
  const [speed, setSpeed] = useSpeed();
  const ref = useRef(game);
  ref.current = game;

  const step = (a: unknown): string | null => {
    try {
      const next = def.apply(ref.current, a);
      ref.current = next;
      setGame(next);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  useAI(def, game, step, speed);
  useEffect(() => localStorage.setItem(entry.saveKey, JSON.stringify(game)), [game]);

  const n = (game as { players: { isAI: boolean; id: number }[] }).players;
  const humans = n.filter((p) => !p.isAI);
  return (
    <View
      game={game}
      seat={humans.length > 1 ? 'hotseat' : humans[0]?.id ?? null}
      dispatch={(a) => {
        const err = step(a);
        setError(err ?? '');
        return !err;
      }}
      error={error}
      extra={null}
      onQuit={() => {
        if (def.actor(game) === null || confirm('Abandon this game?')) {
          localStorage.removeItem(entry.saveKey);
          onQuit();
        }
      }}
      speed={speed}
      setSpeed={setSpeed}
    />
  );
}

export function LocalSetup({ entry, onStart, onBack }: { entry: GameEntry; onStart: (g: unknown) => void; onBack: () => void }) {
  const { def } = entry;
  const [players, setPlayers] = useState<PlayerSetup[]>(() =>
    Array.from({ length: def.maxPlayers }, (_, i) => (i === 0 ? { name: 'You', isAI: false } : { name: `Computer ${i}`, isAI: true })),
  );
  const [count, setCount] = useState(Math.min(4, def.maxPlayers));
  const [seed, setSeed] = useState('');

  const update = (i: number, patch: Partial<PlayerSetup>) => setPlayers(players.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const counts = Array.from({ length: def.maxPlayers - def.minPlayers + 1 }, (_, i) => def.minPlayers + i);

  return (
    <div className="setup">
      <h1>{def.title} — local game</h1>
      <div className="panel">
        <div className="row">
          Players:
          {counts.map((n) => (
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
          <input placeholder="Seed (optional)" value={seed} onChange={(e) => setSeed(e.target.value)} />
        </div>
        <button
          className="primary"
          onClick={() => onStart(def.create(players.slice(0, count), seed.trim() ? Number(seed) || hashString(seed) : undefined))}
        >
          Start game
        </button>
      </div>
      <p className="small muted">Multiple humans = hot-seat on this device. The game auto-saves in this browser.</p>
      <button onClick={onBack}>Back</button>
    </div>
  );
}

function hashString(s: string) {
  let h = 0;
  for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
