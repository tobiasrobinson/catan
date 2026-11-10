import { describe, expect, it } from 'vitest';
import { createGame } from '../src/engine/reducer';
import { emptyRes } from '../src/engine/rules';
import { authorize, Offer, redact } from '../src/net/protocol';

const humans = () => createGame([0, 1, 2].map((i) => ({ name: `P${i}`, isAI: false })), 7);

describe('online authorization', () => {
  it('only lets the current player act', () => {
    const g = humans();
    expect(authorize(g, 0, { type: 'buildSettlement', vertex: 0 }, null)).toBeNull();
    expect(authorize(g, 1, { type: 'buildSettlement', vertex: 0 }, null)).toMatch(/not your turn/);
  });

  it('lets anyone discard their own cards, but not others', () => {
    const g = { ...humans(), phase: 'discard' as const, discards: [0, 4, 0] };
    const cards = emptyRes();
    expect(authorize(g, 1, { type: 'discard', player: 1, cards }, null)).toBeNull();
    expect(authorize(g, 0, { type: 'discard', player: 1, cards }, null)).not.toBeNull();
    expect(authorize(g, 2, { type: 'discard', player: 2, cards }, null)).not.toBeNull();
  });

  it('requires a human partner to have accepted the exact trade', () => {
    const g = { ...humans(), phase: 'main' as const };
    const give = { ...emptyRes(), wood: 1 };
    const get = { ...emptyRes(), ore: 1 };
    const trade = { type: 'playerTrade' as const, partner: 1, give, get };
    const offer = (r: 'accept' | 'pending'): Offer => ({ id: 1, from: 0, give, get, responses: { 1: r, 2: 'pending' } });
    expect(authorize(g, 0, trade, null)).not.toBeNull();
    expect(authorize(g, 0, trade, offer('pending'))).not.toBeNull();
    expect(authorize(g, 0, trade, offer('accept'))).toBeNull();
    expect(authorize(g, 0, { ...trade, get: { ...emptyRes(), ore: 3 } }, offer('accept'))).not.toBeNull();
  });
});

describe('redaction', () => {
  it("hides other players' dev cards, the deck and rng", () => {
    const g = humans();
    g.players[1].devCards = [{ type: 'victoryPoint', boughtTurn: 1 }];
    g.players[2].devCards = [{ type: 'monopoly', boughtTurn: 1 }];
    const r = redact(g, 2);
    expect(r.players[1].devCards).toEqual([{ type: 'knight', boughtTurn: 1 }]);
    expect(r.players[2].devCards).toEqual([{ type: 'monopoly', boughtTurn: 1 }]);
    expect(new Set(r.devDeck)).toEqual(new Set(['knight']));
    expect(r.devDeck).toHaveLength(g.devDeck.length);
    expect(r.rng).toBe(0);
    expect(r.seed).toBe(0);
    expect(r.log.join()).not.toMatch(/\d{3,}/);
    expect(g.players[1].devCards[0].type).toBe('victoryPoint'); // original untouched
  });
});
