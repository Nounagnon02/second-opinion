import { describe, expect, it } from 'vitest';
import { normalizeDexPairs, normalizeDexPools, normalizeDexTokenPrice } from '../src/normalize/dex.js';
import { damaged, recordedSource } from './helpers/normalize.js';

describe('normalizeDexPairs (E08, E09)', () => {
  const pairs = normalizeDexPairs(recordedSource('E08', 'E08-dex-spot-pairs-paxg-uniswap'));
  const quotes = normalizeDexPairs(recordedSource('E09', 'E09-dex-pair-quotes-paxg-weth'));

  it('reads the two endpoints with one model: they send the same pair and quote fields', () => {
    expect(pairs.source.endpoint).toBe('E08');
    expect(quotes.source.endpoint).toBe('E09');
    expect(pairs.issues).toEqual([]);
    expect(quotes.issues).toEqual([]);
    expect(quotes.items.flatMap((item) => item.issues)).toEqual([]);
  });

  it('brings a pair back to the common model, on its base asset', () => {
    expect(quotes.items).toHaveLength(1);
    expect(quotes.items[0]).toMatchObject({
      kind: 'dex_pair',
      asset: { cmcId: 4705, symbol: 'PAXG', name: 'Paxos Gold', slug: null },
      priceUsd: 4264.153800061066,
      volume24hUsd: 351538.4385732713,
      liquidityUsd: 16257792.367634999,
      // `fully_diluted_value` measures something else and is not reported as a market capitalisation.
      marketCapUsd: null,
      lastUpdated: '2026-09-24T16:05:21.861Z',
      venue: {
        name: 'uniswap-v2',
        address: '0x9c4fe5ffd9a9fc5678cfbd93aa2d4fd684b67c4c',
        network: 'Ethereum',
        pair: 'PAXG/WETH',
      },
    });
    expect(quotes.items[0]?.ageSeconds).toBeCloseTo(138.3, 3);
  });

  it('carries the liquidity and volume C4 reads, including the thin pair of the recorded sample', () => {
    expect(pairs.items).toHaveLength(100);
    const thin = pairs.items.find((item) => item.venue?.pair === 'BULL/WETH');
    expect(thin).toMatchObject({ liquidityUsd: 171.00653494046296, volume24hUsd: 39995193.45976359 });
  });

  it('keeps the stale pairs of the recorded sample measurable by C3', () => {
    const ages = pairs.items.map((item) => item.ageSeconds ?? 0);
    expect(Math.min(...ages)).toBeGreaterThan(0);
    // A pair last updated in May 2025, more than a year before the answer (observation 11 of docs/ENDPOINTS.md).
    expect(Math.max(...ages)).toBeGreaterThan(365 * 24 * 3600);
  });

  it('writes down the base asset identifiers E08 left null, without dropping the pair', () => {
    const unidentified = pairs.items.filter((item) => item.asset.cmcId === null);
    expect(unidentified).toHaveLength(12);
    expect(unidentified[0]?.asset.symbol).toBe('BULL');
    expect(unidentified[0]?.priceUsd).toBeGreaterThan(0);
    expect(unidentified[0]?.issues).toEqual([
      { field: 'data[3].base_asset_ucid', problem: 'null', required: true, seen: 'null' },
    ]);
  });
});

describe('normalizeDexTokenPrice (E10)', () => {
  const normalized = normalizeDexTokenPrice(recordedSource('E10', 'E10-dex-token-price-paxg'));

  it('reads the short field names and the millisecond epoch of the answer', () => {
    expect(normalized.issues).toEqual([]);
    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0]).toMatchObject({
      kind: 'dex_token',
      priceUsd: 4264.153800061066,
      volume24hUsd: 1415750.2817323464,
      liquidityUsd: 21006101.629415408,
      marketCapUsd: 1843664828.207288,
      lastUpdated: '2026-09-24T16:05:11.000Z',
      venue: { name: 'Ethereum', address: '0x45804880de22913dafe09f4980848ece6ecbaf78', network: 'Ethereum' },
      issues: [],
    });
    expect(normalized.items[0]?.ageSeconds).toBeCloseTo(105.496, 3);
  });

  it('names no asset, because the answer carries neither a CMC identifier nor a symbol', () => {
    expect(normalized.items[0]?.asset).toEqual({ cmcId: null, symbol: null, name: null, slug: null });
  });

  it('reports a data that is not the expected object, and returns no observation', () => {
    const broken = normalizeDexTokenPrice({ ...recordedSource('E10', 'E10-dex-token-price-paxg'), data: [] });
    expect(broken.items).toEqual([]);
    expect(broken.issues).toEqual([{ field: 'data', problem: 'not_an_object', required: true, seen: 'array' }]);
  });

  it('writes down a timestamp it cannot read rather than falling back to the local clock', () => {
    const noClock = damaged('E10', 'E10-dex-token-price-paxg', (data) => {
      (data as { ts: string }).ts = '1790265911';
    });
    const result = normalizeDexTokenPrice(noClock);

    expect(result.items[0]?.lastUpdated).toBeNull();
    expect(result.items[0]?.ageSeconds).toBeNull();
    expect(result.items[0]?.issues).toEqual([
      { field: 'data.ts', problem: 'not_a_timestamp', required: true, seen: 'string' },
    ]);
  });
});

describe('normalizeDexPools (E11)', () => {
  const normalized = normalizeDexPools(recordedSource('E11', 'E11-dex-token-pools-paxg'));

  it('reads the decimal strings and the publication epoch of every pool', () => {
    expect(normalized.issues).toEqual([]);
    expect(normalized.items.flatMap((pool) => pool.issues)).toEqual([]);
    expect(normalized.items).toHaveLength(10);
    expect(normalized.items[0]).toMatchObject({
      address: '0x9c4fe5ffd9a9fc5678cfbd93aa2d4fd684b67c4c',
      exchange: 'Uniswap v2',
      exchangeId: 1069,
      liquidityUsd: 16257792.367634999,
      volume24hUsd: 351538.4385732713,
      publishedAt: '2020-05-20T23:27:50.000Z',
      baseIndex: 0,
    });
  });

  it('keeps both sides of a pool, in the order the answer lists them', () => {
    expect(normalized.items[0]?.tokens).toEqual([
      {
        address: '0x45804880de22913dafe09f4980848ece6ecbaf78',
        symbol: 'PAXG',
        name: 'Paxos Gold',
        liquidity: 1909.1949866975258,
        liquidityUsd: 8141101.057583791,
      },
      {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        symbol: 'WETH',
        name: 'Wrapped Ether',
        liquidity: 3032.960513394198,
        liquidityUsd: 8116691.310051207,
      },
    ]);
  });

  it('agrees with E09 on the liquidity of the deepest pool, which C4 reads', () => {
    const deepest = [...normalized.items].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0];
    const pair = normalizeDexPairs(recordedSource('E09', 'E09-dex-pair-quotes-paxg-weth')).items[0];

    expect(deepest?.address).toBe(pair?.venue?.address);
    expect(deepest?.liquidityUsd).toBeCloseTo(pair?.liquidityUsd ?? 0, 6);
  });

  it('writes down a liquidity sent in a shape it cannot read', () => {
    const broken = damaged('E11', 'E11-dex-token-pools-paxg', (data) => {
      const pools = data as { liqUsd: string }[];
      if (pools[0]) pools[0].liqUsd = 'n/a';
    });
    const result = normalizeDexPools(broken);

    expect(result.items[0]?.liquidityUsd).toBeNull();
    expect(result.items[0]?.issues).toEqual([
      { field: 'data[0].liqUsd', problem: 'not_a_number', required: true, seen: 'string' },
    ]);
  });
});
