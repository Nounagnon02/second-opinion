import { describe, expect, it } from 'vitest';
import {
  comparedPrices,
  PRICE_KIND_SIDE,
  relativeGapPercent,
  runDexDivergenceCheck,
  type ComparedPrice,
} from '../src/checks/c1-dex-divergence.js';
import { loadChecksConfig, type DivergenceConfig } from '../src/checks/config.js';
import { formatPercent, formatUsd, isAboutAsset, pricesOfAsset } from '../src/checks/prices.js';
import { priceObservations } from '../src/normalize/index.js';
import { damaged, recordedSource } from './helpers/normalize.js';

const { C1 } = loadChecksConfig();

/** PAXG as the recorded answers name it: CMC identifier, symbol, and the contract the DEX calls were made with. */
const PAXG = { cmcId: 4705, symbol: 'PAXG', contract: '0x45804880de22913dafe09f4980848ece6ecbaf78' };

/** The E02 aggregated price of PAXG, the reference side of every comparison below. */
function reference(): ComparedPrice {
  const observations = priceObservations(recordedSource('E02', 'E02-quotes-latest-btc-paxg')).items;
  const [price] = comparedPrices(pricesOfAsset(observations, PAXG), 'reference');
  if (!price) throw new Error('the recorded E02 answer carries no PAXG price');
  return price;
}

/** The E10 DEX token price of PAXG, the market side of the comparison `check` makes (D3). */
function dexTokenPrice(): ComparedPrice[] {
  const observations = priceObservations(recordedSource('E10', 'E10-dex-token-price-paxg')).items;
  return comparedPrices(pricesOfAsset(observations, PAXG), 'market');
}

/** The three PAXG pairs of the recorded Uniswap page, which the audit reads pair by pair. */
function dexPairPrices(): ComparedPrice[] {
  const observations = priceObservations(recordedSource('E08', 'E08-dex-spot-pairs-paxg-uniswap')).items;
  return comparedPrices(pricesOfAsset(observations, PAXG), 'market');
}

/** The shipped limits, tightened so that the recorded gaps fall on the other side of them. */
function tightened(warn: number, critical: number): DivergenceConfig {
  return { ...C1, warnAbovePercent: warn, criticalAbovePercent: critical };
}

describe('which prices C1 puts on each side', () => {
  it('reads the aggregates as the reference and the DEX prices as the market (D3)', () => {
    expect(PRICE_KIND_SIDE).toEqual({
      aggregate: 'reference',
      conversion: 'reference',
      dex_token: 'market',
      dex_pair: 'market',
      // The wrappers of an RWA are compared with the average tokenized price of their asset, which is C5 (D6).
      rwa_wrapper: null,
    });
  });

  it('narrows a multi-asset answer to the asset of the run', () => {
    const observations = priceObservations(recordedSource('E02', 'E02-quotes-latest-btc-paxg')).items;
    expect(observations).toHaveLength(2);
    expect(pricesOfAsset(observations, PAXG).map((price) => price.asset.symbol)).toEqual(['PAXG']);
    expect(pricesOfAsset(observations, { cmcId: 1 }).map((price) => price.asset.symbol)).toEqual(['BTC']);
  });

  it('matches the E10 answer by the contract it was queried with, since it names nothing else', () => {
    const [observation] = priceObservations(recordedSource('E10', 'E10-dex-token-price-paxg')).items;
    expect(observation?.asset).toEqual({ cmcId: null, symbol: null, name: null, slug: null });
    expect(isAboutAsset(observation!, PAXG)).toBe(true);
    // Written the way a user would type it: the comparison ignores case.
    expect(isAboutAsset(observation!, { contract: PAXG.contract.toUpperCase() })).toBe(true);
    expect(isAboutAsset(observation!, { contract: '0x0000000000000000000000000000000000000000' })).toBe(false);
  });

  it('leaves out a price that names nothing the run named, rather than assuming it belongs', () => {
    const [observation] = priceObservations(recordedSource('E10', 'E10-dex-token-price-paxg')).items;
    expect(isAboutAsset(observation!, { cmcId: 4705, symbol: 'PAXG' })).toBe(false);
  });

  it('keeps only the PAXG pairs of a page holding a hundred of them', () => {
    const all = priceObservations(recordedSource('E08', 'E08-dex-spot-pairs-paxg-uniswap')).items;
    expect(all).toHaveLength(100);
    expect(dexPairPrices().map((price) => price.label)).toEqual([
      'E08 DEX pair price of PAXG',
      'E08 DEX pair price of PAXG',
      'E08 DEX pair price of PAXG',
    ]);
  });
});

describe('runDexDivergenceCheck on the recorded PAXG answers', () => {
  it('measures the gap observation 10 recorded, and reports nothing at the shipped limits', () => {
    const result = runDexDivergenceCheck(reference(), dexTokenPrice(), C1);
    expect(result).toMatchObject({ id: 'C1', status: 'evaluated', severity: 'info', findings: [] });
    // E02 4253.226063661451 against E10 4264.153800061066: +0.26 %, the first C1 case of T1.2.
    const gap = result.measurements.find((measurement) => measurement.unit === 'percent');
    expect(gap?.value).toBeCloseTo(0.2569, 4);
    expect(gap?.threshold).toBe(C1.warnAbovePercent);
  });

  it('keeps both prices in the measurements, so an output never shows a bare percentage', () => {
    const result = runDexDivergenceCheck(reference(), dexTokenPrice(), C1);
    const shown = result.measurements.map((measurement) => [measurement.label, measurement.unit, measurement.value]);
    expect(shown[0]).toEqual(['E02 aggregated price of PAXG', 'usd', 4253.226063661451]);
    expect(shown[1]).toEqual([
      'E10 DEX token price of 0x45804880de22913dafe09f4980848ece6ecbaf78',
      'usd',
      4264.153800061066,
    ]);
    expect(shown[2]?.[0]).toBe(
      'E10 DEX token price of 0x45804880de22913dafe09f4980848ece6ecbaf78 against the aggregated price',
    );
    expect(shown[2]?.[1]).toBe('percent');
  });

  it('cites the two recorded answers a gap was read from', () => {
    const result = runDexDivergenceCheck(reference(), dexTokenPrice(), C1);
    expect(result.sources.map((source) => source.fixture?.file)).toEqual([
      'fixtures/discovery/E02-quotes-latest-btc-paxg.json',
      'fixtures/discovery/E10-dex-token-price-paxg.json',
    ]);
  });

  it('reports the recorded venue spread once the limit is set below it', () => {
    // The three pairs really sit at -0.20 %, +0.01 % and +0.26 % of the E02 aggregate: with a 0.1 % limit two of
    // them are reported, and with a 0.25 % critical limit only the widest is critical.
    const result = runDexDivergenceCheck(reference(), dexPairPrices(), tightened(0.1, 0.25));
    expect(result.severity).toBe('critical');
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((found) => found.code)).toEqual(['price_gap', 'price_gap']);
    expect(result.findings[0]?.severity).toBe('critical');
    expect(result.findings[1]?.severity).toBe('warning');
  });

  it('says which way the gap goes, and against which limit', () => {
    const result = runDexDivergenceCheck(reference(), dexPairPrices(), tightened(0.1, 0.25));
    const [widest, narrower] = result.findings;
    expect(widest?.message).toBe(
      'E08 DEX pair price of PAXG is 4264.1538 USD, 0.26 % above E02 aggregated price of PAXG ' +
        '(4253.2261 USD); limit: 0.25 %.',
    );
    expect(narrower?.message).toMatch(/is 4244.6334 USD, 0.2 % below E02 aggregated price of PAXG/);
    expect(narrower?.message).toMatch(/limit: 0.1 %\.$/);
  });

  it('measures every pair, including the ones that raised no finding', () => {
    const result = runDexDivergenceCheck(reference(), dexPairPrices(), tightened(0.1, 0.25));
    const gaps = result.measurements.filter((measurement) => measurement.unit === 'percent');
    expect(gaps.map((measurement) => Number(measurement.value?.toFixed(4)))).toEqual([-0.202, 0.0077, 0.2569]);
  });
});

describe('what C1 does when it cannot compare', () => {
  it('is not applicable when no DEX price was read, rather than reporting agreement (D9)', () => {
    const result = runDexDivergenceCheck(reference(), [], C1);
    expect(result).toMatchObject({ id: 'C1', status: 'not_applicable', severity: null, findings: [] });
    expect(result.reason).toMatch(/No DEX price was read/);
  });

  it('is not applicable when no aggregated price was read, and still cites the DEX answer', () => {
    const result = runDexDivergenceCheck(null, dexTokenPrice(), C1);
    expect(result).toMatchObject({ status: 'not_applicable', severity: null });
    expect(result.reason).toMatch(/No aggregated price was read/);
    expect(result.sources[0]?.fixture?.file).toBe('fixtures/discovery/E10-dex-token-price-paxg.json');
  });

  it('reports an unreadable DEX price as info, leaving the field itself to C7 (D8)', () => {
    const source = damaged('E10', 'E10-dex-token-price-paxg', (data) => {
      (data as { p: unknown }).p = 'not a price';
    });
    const markets = comparedPrices(pricesOfAsset(priceObservations(source).items, PAXG), 'market');
    expect(markets[0]?.priceUsd).toBeNull();
    const result = runDexDivergenceCheck(reference(), markets, C1);
    expect(result.severity).toBe('info');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: 'gap_unknown', severity: 'info' });
    expect(result.findings[0]?.message).toMatch(/C7 reports the field itself/);
    expect(result.findings[0]?.measurement?.value).toBeNull();
  });

  it('reports an unreadable aggregated price once per DEX price it could not be compared with', () => {
    const source = damaged('E02', 'E02-quotes-latest-btc-paxg', (data) => {
      (data as { quote: { price: unknown }[] }[])[1]!.quote[0]!.price = null;
    });
    const [aggregate] = comparedPrices(pricesOfAsset(priceObservations(source).items, PAXG), 'reference');
    const result = runDexDivergenceCheck(aggregate!, dexPairPrices(), C1);
    expect(result.findings).toHaveLength(3);
    expect(result.findings.every((found) => found.code === 'gap_unknown')).toBe(true);
    expect(result.findings[0]?.message).toMatch(/E02 aggregated price of PAXG carries no usable price/);
  });

  it('reports a reference price of zero once, instead of dividing by it', () => {
    const source = damaged('E02', 'E02-quotes-latest-btc-paxg', (data) => {
      (data as { quote: { price: unknown }[] }[])[1]!.quote[0]!.price = 0;
    });
    const [aggregate] = comparedPrices(pricesOfAsset(priceObservations(source).items, PAXG), 'reference');
    const result = runDexDivergenceCheck(aggregate!, dexPairPrices(), C1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: 'reference_not_positive', severity: 'warning' });
    expect(result.findings[0]?.message).toMatch(/is 0 USD, so no relative gap can be measured/);
    // The DEX prices are still shown, with no gap invented for them.
    const gaps = result.measurements.filter((measurement) => measurement.unit === 'percent');
    expect(gaps).toHaveLength(3);
    expect(gaps.every((measurement) => measurement.value === null)).toBe(true);
  });
});

describe('relativeGapPercent', () => {
  it('signs the gap by where the market price sits', () => {
    expect(relativeGapPercent(100, 102)).toBeCloseTo(2, 12);
    expect(relativeGapPercent(100, 98)).toBeCloseTo(-2, 12);
    expect(relativeGapPercent(100, 100)).toBe(0);
    // A market price of zero is a full gap, not a missing measurement.
    expect(relativeGapPercent(100, 0)).toBe(-100);
  });
});

describe('how numbers are written in a finding', () => {
  it('keeps enough digits of a price to see the gap the sources showed', () => {
    expect(formatUsd(4253.226063661451)).toBe('4253.2261 USD');
    expect(formatUsd(4264.153800061066)).toBe('4264.1538 USD');
    expect(formatUsd(0)).toBe('0 USD');
    expect(formatUsd(Number.NaN)).toBe('an unreadable amount');
  });

  it('rounds a percentage to two decimals, or to two digits when it is smaller than that', () => {
    expect(formatPercent(0.2569267)).toBe('0.26 %');
    expect(formatPercent(2)).toBe('2 %');
    expect(formatPercent(-0.202)).toBe('-0.2 %');
    expect(formatPercent(0.0077)).toBe('0.0077 %');
    expect(formatPercent(0)).toBe('0 %');
  });
});
