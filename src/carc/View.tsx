import { useEffect, useMemo, useRef, useState } from 'react';
import type { ViewProps } from '../net/protocol';
import { CAction, CState, canPlace, frontier, key, meepleOptions, unkey } from './engine';
import { TILE } from './tiles';
import { MeepleIcon, TileArt, anchor, rotPt } from './TileArt';
import { Modal } from '../ui/Widgets';

const T = 100; // tile size in SVG units
const FEATURE_NAME = { city: 'city', road: 'road', field: 'field (farmer)', monastery: 'monastery' } as const;

export function CarcView(props: ViewProps<CState, CAction>) {
  const { game: s, seat, dispatch, error, onQuit, quitLabel = 'New game', banner, speed, setSpeed } = props;
  const cur = s.players[s.current];
  const canAct = s.phase !== 'gameOver' && !cur.isAI && (seat === 'hotseat' || seat === s.current);
  const me = typeof seat === 'number' ? seat : s.current;

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [s.log.length]);
  const [sel, setSel] = useState<{ x: number; y: number } | null>(null);
  const [rot, setRot] = useState(0);
  useEffect(() => {
    setSel(null);
  }, [s.turn, s.phase]);

  // Cells where the drawn tile fits in at least one rotation.
  const legal = useMemo(() => {
    const m = new Map<string, number[]>();
    if (s.phase !== 'place' || !s.drawn) return m;
    for (const [x, y] of frontier(s)) {
      const rs = [0, 1, 2, 3].filter((r) => canPlace(s, s.drawn!, x, y, r));
      if (rs.length) m.set(key(x, y), rs);
    }
    return m;
  }, [s]);

  const selRots = sel ? legal.get(key(sel.x, sel.y)) ?? [] : [];
  const rotate = (dir: 1 | -1) => {
    if (sel && selRots.length) {
      const i = selRots.indexOf(rot);
      setRot(selRots[(i + dir + selRots.length) % selRots.length]);
    } else setRot((rot + dir + 4) % 4);
  };
  const choose = (x: number, y: number) => {
    const rs = legal.get(key(x, y));
    if (!rs) return;
    if (sel && sel.x === x && sel.y === y && rs.includes(rot)) {
      dispatch({ type: 'place', x, y, r: rot });
      return;
    }
    setSel({ x, y });
    setRot(rs.includes(rot) ? rot : rs[0]);
  };
  const confirm = () => sel && selRots.includes(rot) && dispatch({ type: 'place', x: sel.x, y: sel.y, r: rot });

  useEffect(() => {
    if (!canAct) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'r' || e.key === 'R') rotate(e.shiftKey ? -1 : 1);
      if (e.key === 'Enter' && s.phase === 'place') confirm();
      if ((e.key === 'Escape' || e.key === 's') && s.phase === 'meeple') dispatch({ type: 'meeple', f: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const options = canAct ? meepleOptions(s) : [];

  // ---- board geometry ----
  const cells = Object.keys(s.board).map(unkey);
  const all = [...cells, ...(s.phase === 'place' ? frontier(s) : [])];
  const xs = all.map((c) => c[0]);
  const ys = all.map((c) => c[1]);
  const minX = Math.min(...xs) - 0.5, maxX = Math.max(...xs) + 1.5;
  const minY = Math.min(...ys) - 0.5, maxY = Math.max(...ys) + 1.5;
  const vb = `${minX * T} ${minY * T} ${(maxX - minX) * T} ${(maxY - minY) * T}`;

  const instruction =
    s.phase === 'gameOver'
      ? 'Game over'
      : !canAct
        ? `${cur.name} is ${s.phase === 'place' ? 'placing a tile' : 'deciding on a meeple'}…`
        : s.phase === 'place'
          ? sel
            ? 'Rotate if needed, then click the tile again (or Place) to confirm'
            : 'Click a highlighted square to place your tile'
          : options.length
            ? 'Click a circle to place a meeple, or skip'
            : cur.meeples
              ? 'No free features on this tile — skip'
              : 'You have no meeples left — skip';

  return (
    <div className="game">
      <div className="board-wrap carc-wrap">
        {banner}
        <svg className="board carc-board" viewBox={vb}>
          {Object.entries(s.board).map(([k, p]) => {
            const [x, y] = unkey(k);
            return (
              <g key={k} transform={`translate(${x * T} ${y * T})`}>
                <TileArt t={p.t} r={p.r} />
              </g>
            );
          })}

          {/* last placed tile */}
          {s.last && (
            <rect
              x={s.last.x * T + 2} y={s.last.y * T + 2} width={T - 4} height={T - 4}
              fill="none" stroke={s.players[(s.current - (s.phase === 'meeple' ? 0 : 1) + s.players.length) % s.players.length].color}
              strokeWidth={5} pointerEvents="none"
            />
          )}

          {/* meeples */}
          {Object.entries(s.board).map(([k, p]) => {
            if (!p.meeple) return null;
            const [x, y] = unkey(k);
            const [ax, ay] = rotPt(anchor(p.t, p.meeple.f), p.r);
            return <MeepleIcon key={`m${k}`} x={x * T + ax} y={y * T + ay} color={s.players[p.meeple.owner].color} size={1.3} />;
          })}

          {/* legal spots */}
          {canAct &&
            s.phase === 'place' &&
            [...legal.keys()].map((k) => {
              const [x, y] = unkey(k);
              const active = sel && sel.x === x && sel.y === y;
              return (
                <rect
                  key={`l${k}`}
                  className="carc-spot"
                  x={x * T + 3} y={y * T + 3} width={T - 6} height={T - 6} rx={6}
                  fill={active ? 'none' : 'rgba(255,255,255,.12)'}
                  stroke="#ffe08a" strokeWidth={active ? 0 : 2} strokeDasharray="8 6"
                  onClick={() => choose(x, y)}
                />
              );
            })}

          {/* ghost tile */}
          {canAct && sel && s.drawn && (
            <g transform={`translate(${sel.x * T} ${sel.y * T})`} onClick={() => choose(sel.x, sel.y)} className="carc-ghost">
              <TileArt t={s.drawn} r={rot} />
              <rect width={T} height={T} fill="none" stroke={selRots.includes(rot) ? '#ffe08a' : '#ff6b6b'} strokeWidth={4} />
            </g>
          )}

          {/* meeple choices */}
          {options.map((f) => {
            const p = s.board[key(s.last!.x, s.last!.y)];
            const [ax, ay] = rotPt(anchor(p.t, f), p.r);
            const ft = TILE[p.t].features[f].type;
            return (
              <g key={`o${f}`} className="carc-option" onClick={() => dispatch({ type: 'meeple', f })}>
                <title>Place a meeple on this {FEATURE_NAME[ft]}</title>
                <circle cx={s.last!.x * T + ax} cy={s.last!.y * T + ay} r={11} fill={cur.color} fillOpacity={0.55} stroke="#fff" strokeWidth={2.5} />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="sidebar">
        <div className="row between">
          <h2>Carcassonne</h2>
          <div className="row">
            {setSpeed && (
              <label className="small">
                AI speed{' '}
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  <option value={1200}>Slow</option>
                  <option value={600}>Normal</option>
                  <option value={250}>Fast</option>
                  <option value={40}>Instant</option>
                </select>
              </label>
            )}
            <button onClick={onQuit}>{quitLabel}</button>
          </div>
        </div>

        <div className="status" style={{ borderLeftColor: cur.color }}>
          <div className="row between">
            <span>Turn {s.turn} — <b>{cur.name}</b>{cur.isAI ? ' (AI)' : ''}</span>
            <span className="small muted">{s.bag.length} tiles left</span>
          </div>
          <div className="instr">{instruction}</div>
          {error && <div className="error">{error}</div>}
        </div>

        {s.phase === 'place' && s.drawn && (
          <div className="panel carc-current">
            <svg viewBox="-4 -4 108 108" width={108} height={108}>
              <TileArt t={s.drawn} r={rot} />
              <rect width={100} height={100} fill="none" stroke="#000" strokeOpacity={0.4} />
            </svg>
            {canAct && (
              <div className="carc-controls">
                <div className="row">
                  <button onClick={() => rotate(-1)} title="Rotate left (Shift+R)">⟲</button>
                  <button onClick={() => rotate(1)} title="Rotate right (R)">⟳</button>
                </div>
                <button className="primary" disabled={!sel || !selRots.includes(rot)} onClick={confirm}>Place tile</button>
                <div className="small muted">R rotates · Enter places</div>
              </div>
            )}
          </div>
        )}

        {canAct && s.phase === 'meeple' && (
          <div className="actions">
            <button className="primary" onClick={() => dispatch({ type: 'meeple', f: null })}>
              {options.length ? 'Skip meeple' : 'End turn'}
            </button>
          </div>
        )}

        <div className="panel players">
          {s.players.map((p) => (
            <div key={p.id} className={`player ${s.current === p.id ? 'current' : ''}`}>
              <span className="swatch" style={{ background: p.color }} />
              <span className="pname">
                {p.name}
                {p.isAI && <i className="small muted"> AI</i>}
                {p.id === me && seat !== 'hotseat' && seat !== null && <i className="small muted"> (you)</i>}
              </span>
              <span title="Score"><b>{p.score}</b> pts</span>
              <span className="carc-meeples" title={`${p.meeples} meeples in supply`}>
                <svg viewBox="-14 -14 28 28" width={14} height={14}><MeepleIcon x={0} y={0} color={p.color} /></svg>×{p.meeples}
              </span>
            </div>
          ))}
        </div>

        <details className="panel small">
          <summary>Scoring rules</summary>
          <ul className="carc-rules">
            <li><b>Road</b>: 1 point per tile (finished or not).</li>
            <li><b>City</b>: finished 2 per tile + 2 per shield; unfinished 1 + 1.</li>
            <li><b>Monastery</b>: 1 + 1 per surrounding tile (9 when surrounded).</li>
            <li><b>Farmers</b> (game end): 3 per finished city touching the field.</li>
            <li>Most meeples in a feature wins it; ties all score. You can't place on a feature someone already holds, but separate features can later join.</li>
          </ul>
        </details>

        <div className="log" ref={logRef}>
          {s.log.slice(-80).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>

      {s.phase === 'gameOver' && (
        <Modal>
          <h2>{s.winners!.map((w) => s.players[w].name).join(' & ')} {s.winners!.length > 1 ? 'tie!' : 'wins!'}</h2>
          {[...s.players].sort((a, b) => b.score - a.score).map((p) => (
            <div key={p.id} className="row between" style={{ minWidth: 220 }}>
              <span style={{ color: p.color === '#222222' ? '#ccc' : p.color }}>{p.name}</span>
              <b>{p.score}</b>
            </div>
          ))}
          <button className="primary" onClick={onQuit}>Back to menu</button>
        </Modal>
      )}
    </div>
  );
}
