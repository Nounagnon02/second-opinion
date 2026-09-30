import { describe, expect, it } from 'vitest';
import {
  normalizeRwaInfo,
  normalizeRwaIssuer,
  normalizeRwaIssuers,
  normalizeRwaMap,
  normalizeRwaQuotes,
} from '../src/normalize/rwa.js';
import { damaged, recordedSource } from './helpers/normalize.js';

describe('normalizeRwaMap (E13)', () => {
  const normalized = normalizeRwaMap(recordedSource('E13', 'E13-rwa-map-gold'));

  it('reads the symbol to rwa_id entry and the paging around it', () => {
    expect(normalized.issues).toEqual([]);
    expect(normalized.page).toEqual({ totalSize: 1, hasMore: false });
    expect(normalized.items).toEqual([
      { rwaId: 1, symbol: 'GOLD', name: 'Gold', slug: 'gold', assetType: 'commodity', rank: 1, hasTokens: true },
    ]);
  });
});

describe('normalizeRwaQuotes (E14)', () => {
  const normalized = normalizeRwaQuotes(recordedSource('E14', 'E14-rwa-quotes-gold'));
  const gold = normalized.items[0];

  it('reads the aggregates of the asset without an unusable field', () => {
    expect(normalized.issues).toEqual([]);
    expect(normalized.items.flatMap((item) => item.issues)).toEqual([]);
    expect(normalized.page).toBeNull();
    expect(gold).toMatchObject({
      asset: { rwaId: 1, symbol: 'GOLD', assetType: 'commodity', hasTokens: true },
      averageTokenizedPriceUsd: 4255.05199754471,
      tokenizedMarketCapUsd: 4591297899.720992,
      tokenizedVolume24hUsd: 446853351.8036597,
      lastUpdated: '2026-09-24T16:02:03.000Z',
    });
    expect(gold?.ageSeconds).toBeCloseTo(124.977, 3);
  });

  it('counts the traditional-finance venues without reading fields it has never observed', () => {
    // The array was empty in the recorded answer, so the shape of its items is unknown (D6).
    expect(gold?.tradfiMarketCount).toBe(0);
  });

  it('brings every wrapper back to the common model, with its issuer', () => {
    expect(gold?.wrappers).toHaveLength(7);
    expect(gold?.wrappers[0]).toMatchObject({
      kind: 'rwa_wrapper',
      asset: { cmcId: 4705, symbol: 'PAXG', name: 'PAX Gold' },
      priceUsd: 4253.420091887455,
      volume24hUsd: 224569605.417406,
      marketCapUsd: 1849827810.4,
      issuerId: '68904c24abae9b5b9fb35815',
      issuerName: 'Paxos',
      // E14 dates its tokens with no timestamp of their own (D7).
      lastUpdated: null,
      ageSeconds: null,
      liquidityUsd: null,
      venue: null,
      issues: [],
    });
  });

  it('keeps the wrappers priced on another unit, which C5 has to explain rather than drop', () => {
    const prices = new Map(gold?.wrappers.map((wrapper) => [wrapper.asset.symbol, wrapper.priceUsd]));
    expect(prices.get('XAUt')).toBe(4258.253106142238);
    expect(prices.get('CGO')).toBe(136.6823118203415);
    expect(prices.get('VNXAU')).toBe(137.26762775441745);
  });

  it('writes down a wrapper price the answer could not give, and keeps the others', () => {
    const broken = damaged('E14', 'E14-rwa-quotes-gold', (data) => {
      const token = (data as { rwa_assets: { tokens: { price: number | null }[] }[] }).rwa_assets[0]?.tokens[0];
      if (token) token.price = null;
    });
    const result = normalizeRwaQuotes(broken);

    expect(result.items[0]?.wrappers[0]?.priceUsd).toBeNull();
    expect(result.items[0]?.wrappers[0]?.issues).toEqual([
      { field: 'data.rwa_assets[0].tokens[0].price', problem: 'null', required: true, seen: 'null' },
    ]);
    expect(result.items[0]?.wrappers[1]?.priceUsd).toBe(4258.253106142238);
  });

  it('falls back to the asset-level aggregates when the answer has no USD quote', () => {
    const noQuotes = damaged('E14', 'E14-rwa-quotes-gold', (data) => {
      const asset = (data as { rwa_assets: { quotes?: unknown }[] }).rwa_assets[0];
      if (asset) delete asset.quotes;
    });
    const result = normalizeRwaQuotes(noQuotes);

    expect(result.items[0]?.averageTokenizedPriceUsd).toBe(4255.05199754471);
    // The asset-level timestamp differs from the quote one; it is the only one left, and it is reported as such.
    expect(result.items[0]?.lastUpdated).toBe('2026-09-24T16:02:38.215Z');
    expect(result.items[0]?.issues).toEqual([]);
  });
});

describe('normalizeRwaQuotes (E16)', () => {
  const normalized = normalizeRwaQuotes(recordedSource('E16', 'E16-rwa-assets-list'));

  it('reads the assets list with the same model, and reports no wrapper because it lists none', () => {
    expect(normalized.issues).toEqual([]);
    expect(normalized.items.flatMap((item) => item.issues)).toEqual([]);
    expect(normalized.items).toHaveLength(20);
    expect(normalized.page).toEqual({ totalSize: 7942, hasMore: true });
    expect(normalized.items[0]).toMatchObject({
      asset: { rwaId: 119, symbol: 'IWN', assetType: 'etf' },
      averageTokenizedPriceUsd: 219.10223278486023,
      wrappers: [],
      tradfiMarketCount: null,
    });
  });
});

describe('normalizeRwaInfo (E17)', () => {
  const normalized = normalizeRwaInfo(recordedSource('E17', 'E17-rwa-info-gold'));

  it('reads the two fields the answer actually filled in', () => {
    expect(normalized.issues).toEqual([]);
    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0]?.asset).toMatchObject({ rwaId: 1, symbol: 'GOLD', assetType: 'commodity' });
    expect(normalized.items[0]?.description).toMatch(/^### What is gold/);
    expect(normalized.items[0]?.addedAt).toBe('2025-07-17T06:57:15.000Z');
    expect(normalized.items[0]?.issues).toEqual([]);
  });
});

describe('normalizeRwaIssuers (E18) and normalizeRwaIssuer (E19)', () => {
  const list = normalizeRwaIssuers(recordedSource('E18', 'E18-rwa-issuers-list'));
  const one = normalizeRwaIssuer(recordedSource('E19', 'E19-rwa-issuer-paxos'));

  it('reads the issuer list, whose websites and logos are sometimes absent', () => {
    expect(list.issues).toEqual([]);
    expect(list.items.flatMap((issuer) => issuer.issues)).toEqual([]);
    expect(list.items).toHaveLength(25);
    expect(list.page).toEqual({ totalSize: 25, hasMore: false });
    expect(list.items[0]).toMatchObject({
      issuerId: '6878977dcbbf471de3366e85',
      name: 'Backed Assets',
      website: 'https://assets.backed.fi/',
      numTokens: 1176,
      tokens: [],
    });
    expect(list.items.filter((issuer) => issuer.website === null).length).toBe(3);
  });

  it('reads the tokens of one issuer: the wrapper to asset pairs C5 needs (D6)', () => {
    expect(one.issues).toEqual([]);
    expect(one.items).toHaveLength(1);
    expect(one.page).toEqual({ totalSize: 1, hasMore: false });
    expect(one.items[0]).toMatchObject({
      issuerId: '68904c24abae9b5b9fb35815',
      name: 'Paxos',
      numTokens: 1,
      tokens: [{ cmcId: 4705, rwaId: 1, symbol: 'PAXG', name: 'PAX Gold' }],
      issues: [],
    });
  });
});
