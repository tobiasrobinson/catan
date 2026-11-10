import { ReactNode, useEffect, useRef, useState } from 'react';
import { Action, GameState, ResCount } from '../engine/types';
import { applyAction } from '../engine/reducer';
import {
  actingPlayer, emptyRes, legalCities, legalRoads, legalSettlements, legalSetupRoads, robberVictims, totalCards,
} from '../engine/rules';
import { aiAct } from '../ai/heuristic';
import { Offer } from '../net/protocol';
import { Board } from './Board';
import { BuildMode, Sidebar } from './Sidebar';
import { Modal, ResChip, ResEditor } from './Widgets';
import { RESOURCES } from '../engine/types';

/** Online trade plumbing; absent in local games. */
export interface OnlineTrade {
  offer: Offer | null;
  propose: (give: ResCount, get: ResCount) => void;
  cancel: () => void;
  respond: (accept: boolean) => void;
}

export interface GameViewProps {
  game: GameState;
  dispatch: (a: Action) => boolean;
  error: string;
  /** 'hotseat' = several humans share this screen; number = this screen controls that seat; null = spectator */
  seat: 'hotseat' | number | null;
  onQuit: () => void;
  speed: number;
  setSpeed: (n: number) => void;
  trade?: OnlineTrade;
  banner?: ReactNode;
  hideSpeed?: boolean;
  quitLabel?: string;
}

export function useSpeed() {
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem('catan-speed')) || 600);
  useEffect(() => localStorage.setItem('catan-speed', String(speed)), [speed]);
  return [speed, setSpeed] as const;
}

/** Runs AI turns. Only the screen that owns the authoritative game state should call this. */
export function useAI(game: GameState, setGame: (g: GameState) => void, speed: number) {
  const actorPl = game.players[actingPlayer(game)];
  useEffect(() => {
    if (game.phase === 'gameOver' || !actorPl.isAI) return;
    const delay = game.phase.startsWith('setup') ? Math.min(speed, 500) : speed;
    const id = setTimeout(() => {
      try {
        setGame(applyAction(game, aiAct(game)));
      } catch (e) {
        console.error('AI error', e);
        try {
          setGame(applyAction(game, { type: 'endTurn' }));
        } catch {
          /* stuck; leave for debugging */
        }
      }
    }, delay);
    return () => clearTimeout(id);
  }, [game, speed, actorPl.isAI]);
}

export function GameView({ game, dispatch, error, seat, onQuit, speed, setSpeed, trade, banner, hideSpeed, quitLabel }: GameViewProps) {
  const [mode, setMode] = useState<BuildMode>(null);
  const [revealed, setRevealed] = useState<number | null>(null);
  const [robberTile, setRobberTile] = useState<number | null>(null);

  const actor = actingPlayer(game);
  const actorPl = game.players[actor];
  const hotseat = seat === 'hotseat';
  const canAct =
    !actorPl.isAI && game.phase !== 'gameOver' && (hotseat ? revealed === actor : seat === actor);
  const viewer: number | null = hotseat ? (!actorPl.isAI && revealed === actor ? actor : null) : seat;
  const needsPass = hotseat && !actorPl.isAI && revealed !== actor && game.phase !== 'gameOver';

  useEffect(() => {
    setMode(null);
    setRobberTile(null);
  }, [game.phase, game.current]);

  // Highlights
  let hv: Set<number> | undefined;
  let he: Set<number> | undefined;
  let ht: Set<number> | undefined;
  if (canAct) {
    const p = game.current;
    if (game.phase === 'setupSettlement') hv = new Set(legalSettlements(game, p, true));
    else if (game.phase === 'setupRoad') he = new Set(legalSetupRoads(game));
    else if (game.phase === 'roadBuilding') he = new Set(legalRoads(game, p));
    else if (game.phase === 'robber') ht = new Set(game.board.tiles.filter((t) => t.id !== game.robber).map((t) => t.id));
    else if (game.phase === 'main') {
      if (mode === 'road') he = new Set(legalRoads(game, p));
      if (mode === 'settlement') hv = new Set(legalSettlements(game, p));
      if (mode === 'city') hv = new Set(legalCities(game, p));
    }
  }

  const onVertex = (v: number) => {
    if (mode === 'city') dispatch({ type: 'buildCity', vertex: v });
    else dispatch({ type: 'buildSettlement', vertex: v });
    setMode(null);
  };
  const onEdge = (e: number) => {
    dispatch({ type: 'buildRoad', edge: e });
    setMode(null);
  };
  const onTile = (t: number) => {
    const victims = robberVictims(game, t);
    if (victims.length <= 1) dispatch({ type: 'moveRobber', tile: t, victim: victims[0] ?? null });
    else setRobberTile(t);
  };

  const incoming =
    trade?.offer && typeof seat === 'number' && trade.offer.from !== seat && trade.offer.responses[seat] === 'pending'
      ? trade.offer
      : null;

  return (
    <div className="game">
      <div className="board-wrap">
        {banner}
        <Board game={game} vertices={hv} edges={he} tiles={ht} onVertex={onVertex} onEdge={onEdge} onTile={onTile} />
      </div>
      <Sidebar
        game={game}
        viewer={viewer}
        canAct={canAct}
        mode={mode}
        setMode={setMode}
        dispatch={dispatch}
        error={error}
        onQuit={onQuit}
        speed={speed}
        setSpeed={setSpeed}
        trade={trade}
        hideSpeed={hideSpeed}
        quitLabel={quitLabel}
      />

      {needsPass && (
        <Modal>
          <h2 style={{ color: actorPl.color }}>Pass the device to {actorPl.name}</h2>
          <button className="primary" onClick={() => setRevealed(actor)}>I'm {actorPl.name} — show my hand</button>
        </Modal>
      )}

      {canAct && game.phase === 'discard' && <DiscardDialog key={actor} game={game} p={actor} dispatch={dispatch} />}

      {canAct && robberTile !== null && (
        <Modal>
          <h3>Steal from whom?</h3>
          {robberVictims(game, robberTile).map((v) => (
            <button key={v} onClick={() => dispatch({ type: 'moveRobber', tile: robberTile, victim: v })}>
              {game.players[v].name} ({totalCards(game.players[v].resources)} cards)
            </button>
          ))}
          <button onClick={() => setRobberTile(null)}>Cancel</button>
        </Modal>
      )}

      {incoming && trade && game.phase !== 'gameOver' && (
        <Modal>
          <h3 style={{ color: game.players[incoming.from].color }}>{game.players[incoming.from].name} offers a trade</h3>
          <div className="row wrap">You give: <Chips c={incoming.get} /></div>
          <div className="row wrap">You get: <Chips c={incoming.give} /></div>
          <div className="row">
            <button className="primary" onClick={() => trade.respond(true)}>Accept</button>
            <button onClick={() => trade.respond(false)}>Decline</button>
          </div>
        </Modal>
      )}

      {game.phase === 'gameOver' && (
        <Modal>
          <h2 style={{ color: game.players[game.winner!].color }}>{game.players[game.winner!].name} wins!</h2>
          <p>Finished on turn {game.turn}.</p>
          <button className="primary" onClick={onQuit}>Back to menu</button>
        </Modal>
      )}
    </div>
  );
}

const Chips = ({ c }: { c: ResCount }) => (
  <>{RESOURCES.filter((r) => c[r]).map((r) => <ResChip key={r} r={r} n={c[r]} />)}</>
);

function DiscardDialog({ game, p, dispatch }: { game: GameState; p: number; dispatch: (a: Action) => boolean }) {
  const [cards, setCards] = useState(emptyRes());
  const need = game.discards[p];
  const pl = game.players[p];
  return (
    <Modal>
      <h3>{pl.name}: discard {need} cards ({totalCards(cards)}/{need})</h3>
      <ResEditor value={cards} onChange={setCards} max={pl.resources} />
      <button
        className="primary"
        disabled={totalCards(cards) !== need}
        onClick={() => dispatch({ type: 'discard', player: p, cards })}
      >
        Discard
      </button>
    </Modal>
  );
}

/** Local (single-screen) game: owns state, runs AI, auto-saves. */
export function LocalGame({ initial, onQuit, saveKey }: { initial: GameState; onQuit: () => void; saveKey: string }) {
  const [game, setGame] = useState(initial);
  const [error, setError] = useState('');
  const [speed, setSpeed] = useSpeed();
  const ref = useRef(game);
  ref.current = game;
  useAI(game, setGame, speed);
  useEffect(() => localStorage.setItem(saveKey, JSON.stringify(game)), [game]);

  const humans = game.players.filter((p) => !p.isAI);
  const dispatch = (a: Action) => {
    try {
      setGame(applyAction(ref.current, a));
      setError('');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  return (
    <GameView
      game={game}
      dispatch={dispatch}
      error={error}
      seat={humans.length > 1 ? 'hotseat' : humans[0]?.id ?? null}
      onQuit={() => {
        if (game.phase === 'gameOver' || confirm('Abandon this game?')) {
          localStorage.removeItem(saveKey);
          onQuit();
        }
      }}
      speed={speed}
      setSpeed={setSpeed}
    />
  );
}
