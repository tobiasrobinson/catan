import { useEffect, useRef, useState } from 'react';
import { Action, DevType, GameState, RESOURCES, ResCount, Resource } from '../engine/types';
import {
  COSTS, PIECES, canPlayDev, emptyRes, hasRes, legalCities, legalRoads, legalSettlements, pieceCounts,
  portRatios, totalCards, victoryPoints,
} from '../engine/rules';
import { aiAcceptTrade } from '../ai/heuristic';
import { CostChips, ResChip, ResEditor, ResSelect } from './Widgets';
import { DEV_DESC, DEV_LABEL, RES_LABEL } from './theme';
import type { OnlineTrade } from './GameView';
import type { Resp } from '../engine/online';

export type BuildMode = 'road' | 'settlement' | 'city' | null;

interface Props {
  game: GameState;
  viewer: number | null;
  canAct: boolean;
  mode: BuildMode;
  setMode: (m: BuildMode) => void;
  dispatch: (a: Action) => boolean;
  error: string;
  onQuit: () => void;
  speed?: number;
  setSpeed?: (n: number) => void;
  trade?: OnlineTrade;
  hideSpeed?: boolean;
  quitLabel?: string;
}

function instruction(g: GameState, mode: BuildMode): string {
  const n = g.players[g.current].name;
  switch (g.phase) {
    case 'setupSettlement': return `${n}: place a starting settlement`;
    case 'setupRoad': return `${n}: place a road next to it`;
    case 'roll': return `${n}: roll the dice`;
    case 'discard': return `Discarding: ${g.players.filter((p) => g.discards[p.id] > 0).map((p) => `${p.name} (${g.discards[p.id]})`).join(', ')}`;
    case 'robber': return `${n}: move the robber (click a tile)`;
    case 'roadBuilding': return `${n}: place ${g.freeRoads} free road(s)`;
    case 'main': return mode ? `Click a highlighted spot to build a ${mode} (or cancel)` : `${n}: build, trade, or end turn`;
    case 'gameOver': return `${g.players[g.winner!].name} wins!`;
  }
}

export function Sidebar(props: Props) {
  const { game, viewer, canAct, mode, setMode, dispatch, error, onQuit, speed, setSpeed, trade, hideSpeed, quitLabel = 'New game' } = props;
  const cur = game.players[game.current];
  const myTurn = canAct && viewer === game.current;
  const p = game.current;
  const res = cur.resources;
  const pc = pieceCounts(game, p);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [game.log.length]);

  const canRoad = hasRes(res, COSTS.road) && pc.roads < PIECES.road && legalRoads(game, p).length > 0;
  const canSettle = hasRes(res, COSTS.settlement) && pc.settlements < PIECES.settlement && legalSettlements(game, p).length > 0;
  const canCity = hasRes(res, COSTS.city) && pc.cities < PIECES.city && legalCities(game, p).length > 0;

  const why = (cost: typeof COSTS.road, used: number, max: number, spots: number, noSpot: string, ok: string) =>
    !hasRes(res, cost) ? 'Not enough resources'
      : used >= max ? 'No pieces left'
      : spots === 0 ? noSpot
      : ok;
  const roadTip = why(COSTS.road, pc.roads, PIECES.road, legalRoads(game, p).length,
    'No open edge connected to your roads or buildings', 'Build a road connected to your network');
  const settleTip = why(COSTS.settlement, pc.settlements, PIECES.settlement, legalSettlements(game, p).length,
    'No legal spot: a settlement must touch your road and be at least two intersections away from any other settlement or city (no neighbouring intersection may be occupied). Extend your roads first.',
    'Build a settlement on a highlighted corner (1 VP)');
  const cityTip = why(COSTS.city, pc.cities, PIECES.city, legalCities(game, p).length,
    'You have no settlements to upgrade', 'Upgrade a settlement to a city (2 VP, double production)');

  return (
    <div className="sidebar">
      <div className="row between">
        <h2>Catan</h2>
        <div className="row">
          {!hideSpeed && <label className="small">
            AI speed{' '}
            <select value={speed} onChange={(e) => setSpeed?.(Number(e.target.value))}>
              <option value={1200}>Slow</option>
              <option value={600}>Normal</option>
              <option value={250}>Fast</option>
              <option value={40}>Instant</option>
            </select>
          </label>}
          <button onClick={onQuit}>{quitLabel}</button>
        </div>
      </div>

      <div className="status" style={{ borderLeftColor: cur.color }}>
        <div className="row between">
          <span>Turn {game.turn} — <b>{cur.name}</b>{cur.isAI ? ' (AI)' : ''}</span>
          {game.dice && (
            <span className="dice">
              <span>{game.dice[0]}</span>
              <span>{game.dice[1]}</span>
              <b>= {game.dice[0] + game.dice[1]}</b>
            </span>
          )}
        </div>
        <div className="instr">{instruction(game, mode)}</div>
        {error && <div className="error">{error}</div>}
      </div>

      {myTurn && game.phase === 'roll' && (
        <div className="actions">
          <button className="primary" onClick={() => dispatch({ type: 'rollDice' })}>Roll dice</button>
          {canPlayDev(game, p, 'knight') && <button title={DEV_DESC.knight} onClick={() => dispatch({ type: 'playKnight' })}>Play Knight</button>}
        </div>
      )}

      {myTurn && game.phase === 'main' && (
        <div className="actions">
          <button title={roadTip} className={mode === 'road' ? 'active' : ''} disabled={!canRoad} onClick={() => setMode(mode === 'road' ? null : 'road')}>
            Road <CostChips cost={COSTS.road} />
          </button>
          <button title={settleTip} className={mode === 'settlement' ? 'active' : ''} disabled={!canSettle} onClick={() => setMode(mode === 'settlement' ? null : 'settlement')}>
            Settlement <CostChips cost={COSTS.settlement} />
          </button>
          <button title={cityTip} className={mode === 'city' ? 'active' : ''} disabled={!canCity} onClick={() => setMode(mode === 'city' ? null : 'city')}>
            City <CostChips cost={COSTS.city} />
          </button>
          <button title="Buy a random development card: Knight, Road Building, Year of Plenty, Monopoly, or Victory Point" disabled={!hasRes(res, COSTS.dev) || !game.devDeck.length} onClick={() => dispatch({ type: 'buyDev' })}>
            Dev card <CostChips cost={COSTS.dev} />
          </button>
          <button className="primary" onClick={() => dispatch({ type: 'endTurn' })}>End turn</button>
        </div>
      )}

      {viewer !== null && <Hand game={game} p={viewer} myTurn={myTurn} dispatch={dispatch} />}

      {myTurn && game.phase === 'main' && <TradePanel game={game} p={p} dispatch={dispatch} online={trade} />}

      <Players game={game} viewer={viewer} />

      <div className="log" ref={logRef}>
        {game.log.slice(-80).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}

function Hand({ game, p, myTurn, dispatch }: { game: GameState; p: number; myTurn: boolean; dispatch: (a: Action) => boolean }) {
  const pl = game.players[p];
  const [yop, setYop] = useState<[Resource, Resource]>(['wood', 'brick']);
  const [mono, setMono] = useState<Resource>('wheat');
  const groups = new Map<DevType, { total: number; fresh: number }>();
  for (const c of pl.devCards) {
    const g = groups.get(c.type) ?? { total: 0, fresh: 0 };
    g.total++;
    if (c.boughtTurn === game.turn) g.fresh++;
    groups.set(c.type, g);
  }
  const can = (t: DevType) => myTurn && canPlayDev(game, p, t);

  return (
    <div className="panel">
      <h3>{pl.name}'s hand ({totalCards(pl.resources)})</h3>
      <div className="hand">
        {RESOURCES.map((r) => (
          <ResChip key={r} r={r} n={pl.resources[r]} />
        ))}
      </div>
      {groups.size > 0 && (
        <div className="devs">
          {[...groups].map(([t, g]) => (
            <div key={t} className="dev row" title={`${DEV_LABEL[t]}: ${DEV_DESC[t]}${g.fresh > 0 ? '\nCards bought this turn cannot be played until next turn.' : ''}`}>
              <span>
                {DEV_LABEL[t]} ×{g.total}
                {g.fresh > 0 && <i className="small"> ({g.fresh} new)</i>}
              </span>
              {t === 'knight' && can(t) && <button onClick={() => dispatch({ type: 'playKnight' })}>Play</button>}
              {t === 'roadBuilding' && can(t) && <button onClick={() => dispatch({ type: 'playRoadBuilding' })}>Play</button>}
              {t === 'yearOfPlenty' && can(t) && (
                <span className="row">
                  <ResSelect value={yop[0]} onChange={(r) => setYop([r, yop[1]])} />
                  <ResSelect value={yop[1]} onChange={(r) => setYop([yop[0], r])} />
                  <button onClick={() => dispatch({ type: 'playYearOfPlenty', resources: yop })}>Play</button>
                </span>
              )}
              {t === 'monopoly' && can(t) && (
                <span className="row">
                  <ResSelect value={mono} onChange={setMono} />
                  <button onClick={() => dispatch({ type: 'playMonopoly', resource: mono })}>Play</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TradePanel({ game, p, dispatch, online }: { game: GameState; p: number; dispatch: (a: Action) => boolean; online?: OnlineTrade }) {
  const res = game.players[p].resources;
  const ratios = portRatios(game, p);
  const [give, setGive] = useState<Resource>('wood');
  const [get, setGet] = useState<Resource>('brick');
  const [offerGive, setOfferGive] = useState<ResCount>(emptyRes());
  const [offerGet, setOfferGet] = useState<ResCount>(emptyRes());
  const [localResponses, setResponses] = useState<Record<number, Resp> | null>(null);
  // Online: the host owns the offer and collects responses from every player.
  const myOffer = online?.offer && online.offer.from === p ? online.offer : null;
  const responses = online ? myOffer?.responses ?? null : localResponses;

  useEffect(() => setResponses(null), [game.turn, offerGive, offerGet]);

  const offerValid =
    totalCards(offerGive) > 0 &&
    totalCards(offerGet) > 0 &&
    hasRes(res, offerGive) &&
    !RESOURCES.some((r) => offerGive[r] && offerGet[r]);

  const propose = () => {
    if (online) return online.propose(offerGive, offerGet);
    const r: Record<number, Resp> = {};
    for (const o of game.players) {
      if (o.id === p) continue;
      r[o.id] = o.isAI ? (aiAcceptTrade(game, o.id, p, offerGive, offerGet) ? 'accept' : 'decline') : 'pending';
    }
    setResponses(r);
  };
  const doTrade = (partner: number) => {
    const give = myOffer?.give ?? offerGive;
    const get = myOffer?.get ?? offerGet;
    if (dispatch({ type: 'playerTrade', partner, give, get })) {
      setOfferGive(emptyRes());
      setOfferGet(emptyRes());
      setResponses(null);
    }
  };

  return (
    <div className="panel">
      <h3>Trade</h3>
      <div className="row wrap">
        <span>Bank: give {ratios[give]}</span>
        <ResSelect value={give} onChange={setGive} />
        <span>for 1</span>
        <ResSelect value={get} onChange={setGet} />
        <button
          disabled={give === get || res[give] < ratios[give] || game.bank[get] < 1}
          onClick={() => dispatch({ type: 'bankTrade', give, get })}
        >
          Trade
        </button>
      </div>
      <div className="small muted">
        Your rates: {RESOURCES.map((r) => `${RES_LABEL[r]} ${ratios[r]}:1`).join(' · ')}
      </div>

      <details>
        <summary>Offer to players</summary>
        <div className="small">You give:</div>
        <ResEditor value={offerGive} onChange={setOfferGive} max={res} />
        <div className="small">You get:</div>
        <ResEditor value={offerGet} onChange={setOfferGet} />
        <div className="row">
          <button disabled={!offerValid} onClick={propose}>Propose</button>
          {myOffer && <button onClick={online!.cancel}>Withdraw offer</button>}
        </div>
        {myOffer && (
          <div className="small muted row">
            Open offer: give <CostChips cost={myOffer.give} /> for <CostChips cost={myOffer.get} />
          </div>
        )}
        {responses && (
          <div className="responses">
            {Object.entries(responses).map(([id, r]) => {
              const o = game.players[Number(id)];
              return (
                <div key={id} className="row between">
                  <span style={{ color: o.color }}>{o.name}</span>
                  {r === 'decline' && <span className="muted">declines</span>}
                  {r === 'accept' && <button onClick={() => doTrade(o.id)}>Trade with {o.name}</button>}
                  {r === 'pending' && online && <span className="muted">waiting…</span>}
                  {r === 'pending' && !online && (
                    <span className="row">
                      <button onClick={() => doTrade(o.id)}>{o.name} accepts</button>
                      <button onClick={() => setResponses({ ...localResponses, [id]: 'decline' })}>Decline</button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </details>
    </div>
  );
}

function Players({ game, viewer }: { game: GameState; viewer: number | null }) {
  return (
    <div className="panel players">
      {game.players.map((pl) => {
        const pub = victoryPoints(game, pl.id, false);
        const all = victoryPoints(game, pl.id, true);
        const showHidden = viewer === pl.id || game.phase === 'gameOver';
        return (
          <div key={pl.id} className={`player ${game.current === pl.id ? 'current' : ''}`}>
            <span className="swatch" style={{ background: pl.color }} />
            <span className="pname">
              {pl.name}
              {pl.isAI && <i className="small muted"> AI</i>}
            </span>
            <span title="Victory points"><b>{showHidden ? all : pub}</b> VP{showHidden && all > pub ? '*' : ''}</span>
            <span title="Resource cards">Cards {totalCards(pl.resources)}</span>
            <span title="Dev cards">Dev {pl.devCards.length}</span>
            <span title="Knights played">Knights {pl.knightsPlayed}</span>
            <span title="Longest road">Road {pl.roadLength}</span>
            {game.longestRoadOwner === pl.id && <span className="badge">Longest Road</span>}
            {game.largestArmyOwner === pl.id && <span className="badge">Largest Army</span>}
          </div>
        );
      })}
    </div>
  );
}
