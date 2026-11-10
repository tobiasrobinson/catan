import { GameState } from '../engine/types';
import { pips } from '../engine/board';
import { TERRAIN_COLORS, RES_LABEL } from './theme';

const S = 60;
const hexPoints = (x: number, y: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(x + Math.cos(a)) * S},${(y + Math.sin(a)) * S}`;
  }).join(' ');

const SEA = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i);
  return `${Math.cos(a) * 330},${Math.sin(a) * 330}`;
}).join(' ');

interface Props {
  game: GameState;
  vertices?: Set<number>;
  edges?: Set<number>;
  tiles?: Set<number>;
  onVertex?: (v: number) => void;
  onEdge?: (e: number) => void;
  onTile?: (t: number) => void;
}

export function Board({ game, vertices, edges, tiles, onVertex, onEdge, onTile }: Props) {
  const { board } = game;
  const V = board.vertices;
  const color = (p: number) => game.players[p].color;

  return (
    <svg viewBox="-340 -310 680 620" className="board">
      <polygon points={SEA} fill="#2f6db5" stroke="#1d4f8c" strokeWidth={6} />

      {board.ports.map((port, i) => {
        const a = V[port.vertices[0]];
        const b = V[port.vertices[1]];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const len = Math.hypot(mx, my);
        const px = (mx + (mx / len) * 0.6) * S;
        const py = (my + (my / len) * 0.6) * S;
        return (
          <g key={i}>
            <line x1={a.x * S} y1={a.y * S} x2={px} y2={py} stroke="#e8d7a8" strokeWidth={4} />
            <line x1={b.x * S} y1={b.y * S} x2={px} y2={py} stroke="#e8d7a8" strokeWidth={4} />
            <circle cx={px} cy={py} r={19} fill={port.type === 'any' ? '#fff' : TERRAIN_COLORS[port.type]} stroke="#333" strokeWidth={1.5} />
            <text x={px} y={py - 2} className="port-text">{port.type === 'any' ? '3:1' : '2:1'}</text>
            <text x={px} y={py + 9} className="port-sub">{port.type === 'any' ? 'any' : RES_LABEL[port.type]}</text>
          </g>
        );
      })}

      {board.tiles.map((t) => {
        const clickable = tiles?.has(t.id);
        const n = t.number;
        return (
          <g key={t.id} onClick={clickable ? () => onTile?.(t.id) : undefined} className={clickable ? 'clickable' : ''}>
            <polygon
              points={hexPoints(t.x, t.y)}
              fill={TERRAIN_COLORS[t.terrain]}
              stroke={clickable ? '#fff' : '#5b4a2f'}
              strokeWidth={clickable ? 4 : 2}
            />
            <text x={t.x * S} y={t.y * S - 30} className="terrain-label">{t.terrain === 'desert' ? 'Desert' : RES_LABEL[t.terrain]}</text>
            {n !== null && (
              <g>
                <circle cx={t.x * S} cy={t.y * S} r={18} fill="#fdf6e3" stroke="#6b5a3a" />
                <text x={t.x * S} y={t.y * S + 1} className={`num ${n === 6 || n === 8 ? 'red' : ''}`}>{n}</text>
                <text x={t.x * S} y={t.y * S + 13} className={`pips ${n === 6 || n === 8 ? 'red' : ''}`}>{'•'.repeat(pips(n))}</text>
              </g>
            )}
            {game.robber === t.id && (
              <g>
                <ellipse cx={t.x * S + (n ? 28 : 0)} cy={t.y * S + 10} rx={10} ry={6} fill="#111" />
                <rect x={t.x * S + (n ? 28 : 0) - 8} y={t.y * S - 14} width={16} height={24} rx={8} fill="#222" />
                <circle cx={t.x * S + (n ? 28 : 0)} cy={t.y * S - 18} r={7} fill="#222" />
              </g>
            )}
          </g>
        );
      })}

      {board.edges.map((e) => {
        const o = game.roads[e.id];
        if (o === null) return null;
        const [a, b] = e.v.map((v) => V[v]);
        return (
          <g key={e.id}>
            <line x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke="#111" strokeWidth={10} strokeLinecap="round" />
            <line x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke={color(o)} strokeWidth={6} strokeLinecap="round" />
          </g>
        );
      })}

      {edges &&
        [...edges].map((id) => {
          const [a, b] = board.edges[id].v.map((v) => V[v]);
          // shorten slightly so vertex targets stay clickable
          const k = 0.15;
          return (
            <line
              key={id}
              className="hl-edge"
              x1={(a.x + (b.x - a.x) * k) * S}
              y1={(a.y + (b.y - a.y) * k) * S}
              x2={(b.x + (a.x - b.x) * k) * S}
              y2={(b.y + (a.y - b.y) * k) * S}
              onClick={() => onEdge?.(id)}
            />
          );
        })}

      {game.buildings.map((b, i) => {
        if (!b) return null;
        const x = V[i].x * S;
        const y = V[i].y * S;
        const pts = b.city
          ? '-14,9 14,9 14,-5 2,-5 2,-11 -6,-18 -14,-11'
          : '-9,7 9,7 9,-3 0,-11 -9,-3';
        return (
          <polygon
            key={i}
            points={pts}
            transform={`translate(${x},${y})`}
            fill={color(b.owner)}
            stroke="#111"
            strokeWidth={2}
            className={vertices?.has(i) ? 'clickable' : ''}
            onClick={vertices?.has(i) ? () => onVertex?.(i) : undefined}
          />
        );
      })}

      {vertices &&
        [...vertices].map((id) =>
          game.buildings[id] ? (
            <circle key={id} cx={V[id].x * S} cy={V[id].y * S} r={17} className="hl-ring" onClick={() => onVertex?.(id)} />
          ) : (
            <circle key={id} cx={V[id].x * S} cy={V[id].y * S} r={9} className="hl-vertex" onClick={() => onVertex?.(id)} />
          ),
        )}
    </svg>
  );
}
