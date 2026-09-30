import { describe, expect, it } from 'vitest';
import { CmcError } from '../src/cmc/errors.js';
import { isPriceSource, priceObservations, PRICE_SOURCES } from '../src/normalize/index.js';
import { expectEndpoint, sourceFromBody, type PriceObservation } from '../src/normalize/model.js';
import { recordedSource } from './helpers/normalize.js';

/** One fixture per endpoint that carries a USD price, so every source of the model is exercised here. */
const PRICE_FIXTURES = {
  E02: 'E02-quotes-latest-btc-paxg',
  E03: 'E03-listings-latest-top5',
  E06: 'E06-simple-price-btc-paxg',
  E07: 'E07-price-conversion-paxg',
  E08: 'E08-dex-spot-pairs-paxg-uniswap',
  E09: 'E09-dex-pair-quotes-paxg-weth',
  E10: 'E10-dex-token-price-paxg',
  E14: 'E14-rwa-quotes-gold',
} as const;

describe('sourceFromBody', () => {
  it('refuses a body without a readable status block, rather than dating it from the local clock', () => {
    expect(() => sourceFromBody('E02', { data: [] })).toThrow(CmcError);
    expect(() => sourceFromBody('E02', { data: [] })).toThrow(/no readable status block/);
  });

  it('accepts both shapes of the status block (observation 1)', () => {
    // E02 sends error_code as a string, E07 as a number.
    expect(recordedSource('E02', 'E02-quotes-latest-btc-paxg').status.errorCode).toBe(0);
    expect(recordedSource('E07', 'E07-price-conversion-paxg').status.errorCode).toBe(0);
  });
});

describe('expectEndpoint', () => {
  it('refuses an answer a normaliser was not written for', () => {
    const response = recordedSource('E02', 'E02-quotes-latest-btc-paxg');
    expect(() => expectEndpoint(response, 'E06', 'E07')).toThrow(/Normaliser of E06 \/ E07 received a E02 answer/);
    expect(() => expectEndpoint(response, 'E02')).not.toThrow();
  });
});

describe('priceObservations', () => {
  it('covers every endpoint that carries a USD price, and no other', () => {
    expect(Object.keys(PRICE_FIXTURES).sort()).toEqual([...PRICE_SOURCES].sort());
    expect(isPriceSource('E02')).toBe(true);
    expect(isPriceSource('E11')).toBe(false);
  });

  it('refuses a source that carries no price', () => {
    expect(() => priceObservations(recordedSource('E11', 'E11-dex-token-pools-paxg'))).toThrow(
      /received a E11 answer/,
    );
  });

  it('returns the same fields, filled from the same evidence, whatever the source', () => {
    const common = [
      'ageSeconds',
      'asset',
      'issues',
      'kind',
      'lastUpdated',
      'liquidityUsd',
      'marketCapUsd',
      'priceUsd',
      'source',
      'venue',
      'volume24hUsd',
    ];
    for (const [endpoint, label] of Object.entries(PRICE_FIXTURES)) {
      const normalized = priceObservations(recordedSource(endpoint as keyof typeof PRICE_FIXTURES, label));

      expect(normalized.items.length, endpoint).toBeGreaterThan(0);
      for (const item of normalized.items) {
        // The RWA wrappers add their issuer to the common fields; no source leaves one of them out.
        const extra = endpoint === 'E14' ? ['issuerId', 'issuerName'] : [];
        expect(Object.keys(item).sort(), endpoint).toEqual([...common, ...extra].sort());
        expect(item.source.endpoint, endpoint).toBe(endpoint);
        expect(item.source.fixture?.file, endpoint).toBe(`fixtures/discovery/${label}.json`);
        expect(typeof item.priceUsd, endpoint).toBe('number');
      }
    }
  });

  it('reads the RWA answer as the prices of its wrapper tokens', () => {
    const wrappers = priceObservations(recordedSource('E14', 'E14-rwa-quotes-gold'));
    expect(wrappers.items).toHaveLength(7);
    expect(wrappers.items.every((item) => item.kind === 'rwa_wrapper')).toBe(true);
  });
});

describe('the common model across sources', () => {
  /** The PAXG observations of the T1.2 run, one per source that priced it (observation 10 of docs/ENDPOINTS.md). */
  function paxg(): Record<string, PriceObservation> {
    const byEndpoint: Record<string, PriceObservation> = {};
    for (const [endpoint, label] of Object.entries(PRICE_FIXTURES)) {
      const items = priceObservations(recordedSource(endpoint as keyof typeof PRICE_FIXTURES, label)).items;
      const match =
        items.find((item) => item.asset.symbol === 'PAXG' || item.asset.cmcId === 4705) ??
        // E10 names no asset: the answer was recorded for the PAXG contract address (D3).
        items.find((item) => item.venue?.address === '0x45804880de22913dafe09f4980848ece6ecbaf78');
      if (match) byEndpoint[endpoint] = match;
    }
    return byEndpoint;
  }

  it('makes the prices of one asset comparable across every source that priced it', () => {
    const observations = paxg();
    // Every source of the T1.2 run except E03, whose top-5 panel does not contain PAXG.
    expect(Object.keys(observations).sort()).toEqual(['E02', 'E06', 'E07', 'E08', 'E09', 'E10', 'E14']);

    // The three aggregated sources agreed to the last digit.
    expect(observations['E06']?.priceUsd).toBe(observations['E02']?.priceUsd);
    expect(observations['E07']?.priceUsd).toBe(observations['E02']?.priceUsd);
    // The DEX price stood 0.26 % above the aggregated one: the gap C1 measures (D3).
    const aggregated = observations['E02']?.priceUsd ?? 0;
    const dex = observations['E10']?.priceUsd ?? 0;
    expect((dex - aggregated) / aggregated).toBeCloseTo(0.00257, 5);
    expect(observations['E09']?.priceUsd).toBe(dex);
  });

  it('ages every price against the clock of its own answer', () => {
    for (const [endpoint, observation] of Object.entries(paxg())) {
      if (endpoint === 'E14') {
        // E14 dates its tokens with no timestamp of their own (D7).
        expect(observation.ageSeconds).toBeNull();
        continue;
      }
      expect(observation.ageSeconds, endpoint).toBeGreaterThan(0);
      expect(observation.ageSeconds, endpoint).toBeLessThan(10 * 60);
    }
  });

  it('carries a liquidity only where the source measures one', () => {
    const observations = paxg();
    expect(observations['E02']?.liquidityUsd).toBeNull();
    expect(observations['E06']?.liquidityUsd).toBeNull();
    expect(observations['E10']?.liquidityUsd).toBe(21006101.629415408);
    expect(observations['E09']?.liquidityUsd).toBeCloseTo(16257792.367634999, 6);
  });
});
