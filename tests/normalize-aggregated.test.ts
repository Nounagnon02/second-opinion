import { describe, expect, it } from 'vitest';
import {
  normalizeListings,
  normalizePriceConversion,
  normalizeQuotes,
  normalizeSimplePrice,
} from '../src/normalize/aggregated.js';
import { CmcError } from '../src/cmc/errors.js';
import { damaged, recordedSource } from './helpers/normalize.js';

describe('normalizeQuotes (E02)', () => {
  const normalized = normalizeQuotes(recordedSource('E02', 'E02-quotes-latest-btc-paxg'));

  it('names its source and the fixture that proves it', () => {
    expect(normalized.source).toEqual({
      endpoint: 'E02',
      path: '/v3/cryptocurrency/quotes/latest',
      observedAt: '2026-09-24T16:04:03.419Z',
      fixture: {
        file: 'fixtures/discovery/E02-quotes-latest-btc-paxg.json',
        recordedAt: '2026-09-24T16:04:03.700Z',
        latencyMs: 1184,
      },
    });
    expect(normalized.page).toBeNull();
  });

  it('reads the recorded answer without a single unusable field', () => {
    expect(normalized.issues).toEqual([]);
    expect(normalized.items.flatMap((item) => item.issues)).toEqual([]);
  });

  it('brings each asset back to the common model', () => {
    expect(normalized.items).toHaveLength(2);
    expect(normalized.items[1]).toMatchObject({
      kind: 'aggregate',
      asset: { cmcId: 4705, symbol: 'PAXG', name: 'PAX Gold', slug: 'pax-gold' },
      priceUsd: 4253.226063661451,
      volume24hUsd: 224109937.5151175,
      liquidityUsd: null,
      marketCapUsd: 1849743426.8168826,
      lastUpdated: '2026-09-24T16:02:03.000Z',
      venue: null,
    });
  });

  it('dates the price with the timestamp of the quote, and ages it against the answer clock', () => {
    // The item-level `last_updated` of PAXG reads 16:03:00, the quote one 16:02:03 (D7); the quote dates the price.
    expect(normalized.items[1]?.ageSeconds).toBeCloseTo(120.419, 3);
    expect(normalized.items[0]?.ageSeconds).toBeCloseTo(120.419, 3);
  });

  it('refuses an answer from another endpoint', () => {
    const wrong = recordedSource('E06', 'E06-simple-price-btc-paxg');
    expect(() => normalizeQuotes(wrong)).toThrow(CmcError);
    expect(() => normalizeQuotes(wrong)).toThrow(/received a E06 answer/);
  });

  it('writes down a price the answer sent as null, and keeps reading the other assets', () => {
    const broken = damaged('E02', 'E02-quotes-latest-btc-paxg', (data) => {
      const items = data as { quote: { price: number | null }[] }[];
      const quote = items[0]?.quote[0];
      if (quote) quote.price = null;
    });
    const result = normalizeQuotes(broken);

    expect(result.items[0]?.priceUsd).toBeNull();
    expect(result.items[0]?.issues).toEqual([
      { field: 'data[0].quote[0].price', problem: 'null', required: true, seen: 'null' },
    ]);
    expect(result.items[1]?.priceUsd).toBe(4253.226063661451);
    expect(result.items[1]?.issues).toEqual([]);
  });

  it('reports an answer that carries no USD quote, naming every field it should have held', () => {
    const converted = damaged('E02', 'E02-quotes-latest-btc-paxg', (data) => {
      const items = data as { quote: { id: number; symbol: string }[] }[];
      const quote = items[0]?.quote[0];
      if (quote) {
        quote.symbol = 'EUR';
        quote.id = 2790;
      }
    });
    const result = normalizeQuotes(converted);

    expect(result.items[0]?.priceUsd).toBeNull();
    expect(result.items[0]?.issues.map((issue) => issue.field)).toEqual([
      'data[0].quote[USD]',
      'data[0].quote[USD].last_updated',
      'data[0].quote[USD].price',
      'data[0].quote[USD].volume_24h',
    ]);
  });

  it('reports a data that is not the list of assets, and returns none', () => {
    const result = normalizeQuotes(damaged('E02', 'E02-quotes-latest-btc-paxg', () => undefined));
    expect(result.items).toHaveLength(2);

    const notAList = { ...recordedSource('E02', 'E02-quotes-latest-btc-paxg'), data: { id: 1 } };
    const broken = normalizeQuotes(notAList);
    expect(broken.items).toEqual([]);
    expect(broken.issues).toEqual([{ field: 'data', problem: 'not_an_array', required: true, seen: 'object' }]);
  });
});

describe('normalizeListings (E03)', () => {
  const normalized = normalizeListings(recordedSource('E03', 'E03-listings-latest-top5'));

  it('reads the calibration panel with the same model as E02, although the items carry fewer fields', () => {
    expect(normalized.issues).toEqual([]);
    expect(normalized.items.flatMap((item) => item.issues)).toEqual([]);
    expect(normalized.items).toHaveLength(5);
    expect(normalized.items.map((item) => item.asset.symbol)).toEqual(['BTC', 'ETH', 'USDT', 'BNB', 'XRP']);
    expect(normalized.items[1]).toMatchObject({
      kind: 'aggregate',
      asset: { cmcId: 1027, symbol: 'ETH' },
      priceUsd: 2674.813963168203,
      lastUpdated: '2026-09-24T16:04:00.000Z',
    });
  });
});

describe('normalizeSimplePrice (E06)', () => {
  const normalized = normalizeSimplePrice(recordedSource('E06', 'E06-simple-price-btc-paxg'));

  it('reads price and timestamp, and reports no volume, liquidity or market cap', () => {
    expect(normalized.issues).toEqual([]);
    expect(normalized.items.flatMap((item) => item.issues)).toEqual([]);
    expect(normalized.items[1]).toMatchObject({
      kind: 'aggregate',
      asset: { cmcId: 4705, symbol: 'PAXG' },
      priceUsd: 4253.226063661451,
      volume24hUsd: null,
      liquidityUsd: null,
      marketCapUsd: null,
      lastUpdated: '2026-09-24T16:02:03.000Z',
    });
    expect(normalized.items[1]?.ageSeconds).toBeCloseTo(123.255, 3);
  });
});

describe('normalizePriceConversion (E07)', () => {
  const normalized = normalizePriceConversion(recordedSource('E07', 'E07-price-conversion-paxg'));

  it('reads the single converted asset', () => {
    expect(normalized.issues).toEqual([]);
    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0]).toMatchObject({
      kind: 'conversion',
      asset: { cmcId: 4705, symbol: 'PAXG' },
      priceUsd: 4253.226063661451,
      lastUpdated: '2026-09-24T16:02:03.000Z',
      issues: [],
    });
    expect(normalized.items[0]?.ageSeconds).toBeCloseTo(124.168, 3);
  });

  it('brings the price back to one unit when several were converted', () => {
    const tenUnits = damaged('E07', 'E07-price-conversion-paxg', (data) => {
      const item = data as { amount: number; quote: { USD: { price: number } } };
      item.amount = 10;
      item.quote.USD.price *= 10;
    });
    expect(normalizePriceConversion(tenUnits).items[0]?.priceUsd).toBeCloseTo(4253.226063661451, 9);
  });

  it('leaves the price unset when the amount it covers cannot be read, and says so', () => {
    const noAmount = damaged('E07', 'E07-price-conversion-paxg', (data) => {
      delete (data as { amount?: number }).amount;
    });
    const result = normalizePriceConversion(noAmount);

    expect(result.items[0]?.priceUsd).toBeNull();
    expect(result.items[0]?.issues).toEqual([
      { field: 'data.amount', problem: 'missing', required: true, seen: 'absent' },
    ]);
  });
});
