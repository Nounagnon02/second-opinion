import { describe, expect, it } from 'vitest';
import {
  datedPrices,
  datedRwaQuotes,
  formatDuration,
  PRICE_KIND_FAMILY,
  runFreshnessCheck,
  type DatedValue,
} from '../src/checks/c3-freshness.js';
import { loadChecksConfig } from '../src/checks/config.js';
import { priceObservations } from '../src/normalize/index.js';
import { normalizeRwaQuotes } from '../src/normalize/rwa.js';
import { damaged, recordedSource } from './helpers/normalize.js';

const { C3 } = loadChecksConfig();

/** One recorded answer per dated source, read into the prices C3 ages. */
const DATED_FIXTURES = {
  E02: 'E02-quotes-latest-btc-paxg',
  E03: 'E03-listings-latest-top5',
  E06: 'E06-simple-price-btc-paxg',
  E07: 'E07-price-conversion-paxg',
  E08: 'E08-dex-spot-pairs-paxg-uniswap',
  E09: 'E09-dex-pair-quotes-paxg-weth',
  E10: 'E10-dex-token-price-paxg',
} as const;

function pricesOf(endpoint: keyof typeof DATED_FIXTURES): DatedValue[] {
  return datedPrices(priceObservations(recordedSource(endpoint, DATED_FIXTURES[endpoint])).items);
}

describe('which values C3 ages', () => {
  it('puts each kind of price in the family that matches how it refreshes (D4)', () => {
    expect(PRICE_KIND_FAMILY).toEqual({
      aggregate: 'aggregate',
      conversion: 'aggregate',
      dex_token: 'dex',
      dex_pair: 'dex',
      // E14 dates no token of its own; the asset-level timestamp of the same answer does (D7).
      rwa_wrapper: null,
    });
  });

  it('leaves out the wrappers E14 does not date, instead of reporting them as undated', () => {
    const wrappers = priceObservations(recordedSource('E14', 'E14-rwa-quotes-gold')).items;
    expect(wrappers).toHaveLength(7);
    expect(datedPrices(wrappers)).toEqual([]);
    const result = runFreshnessCheck(datedPrices(wrappers), C3);
    expect(result).toMatchObject({ status: 'not_applicable', severity: null, findings: [] });
    expect(result.reason).toMatch(/dated value/);
  });

  it('ages the E14 answer on the timestamp it does carry, next to the average tokenized price', () => {
    const quotes = normalizeRwaQuotes(recordedSource('E14', 'E14-rwa-quotes-gold'));
    const values = datedRwaQuotes(quotes.items);
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({
      label: 'E14 average tokenized price of GOLD',
      family: 'aggregate',
      lastUpdated: '2026-09-24T16:02:03.000Z',
    });
    expect(values[0]?.ageSeconds).toBeCloseTo(124.977, 3);
  });

  it('names what it measured the way the outputs do', () => {
    expect(pricesOf('E02').map((value) => value.label)).toEqual([
      'E02 aggregated price of BTC',
      'E02 aggregated price of PAXG',
    ]);
    expect(pricesOf('E09').map((value) => value.label)).toEqual(['E09 DEX pair price of PAXG']);
    // E10 names neither a CMC identifier nor a symbol: the contract it was queried with identifies it.
    expect(pricesOf('E10').map((value) => value.label)).toEqual([
      'E10 DEX token price of 0x45804880de22913dafe09f4980848ece6ecbaf78',
    ]);
  });
});

describe('runFreshnessCheck on the recorded answers', () => {
  it('finds nothing to report on the sources that answered fresh in T1.2', () => {
    for (const endpoint of ['E02', 'E03', 'E06', 'E07', 'E09', 'E10'] as const) {
      const result = runFreshnessCheck(pricesOf(endpoint), C3);
      expect(result, endpoint).toMatchObject({ id: 'C3', status: 'evaluated', severity: 'info', findings: [] });
      expect(result.measurements.length, endpoint).toBeGreaterThan(0);
    }
  });

  it('measures the age against the clock of the answer, never against the local one (D4)', () => {
    const result = runFreshnessCheck(pricesOf('E02'), C3);
    // status.timestamp 16:04:03.419 minus quote.last_updated 16:02:03: the same number at any time of day.
    expect(result.measurements.map((measurement) => measurement.value?.toFixed(3))).toEqual(['120.419', '120.419']);
    expect(result.measurements[0]).toMatchObject({
      unit: 'seconds',
      threshold: C3.families.aggregate.warnAfterSeconds,
      evidence: { field: null, source: { endpoint: 'E02' } },
    });
  });

  it('cites the recorded answer behind every measurement', () => {
    const result = runFreshnessCheck(pricesOf('E10'), C3);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.fixture?.file).toBe('fixtures/discovery/E10-dex-token-price-paxg.json');
    expect(result.measurements[0]?.evidence.source.fixture?.file).toBe(
      'fixtures/discovery/E10-dex-token-price-paxg.json',
    );
  });

  it('reports the pairs of the E08 sample that had not traded in a day, and only those', () => {
    const values = pricesOf('E08');
    expect(values).toHaveLength(100);
    const stale = values.filter((value) => (value.ageSeconds ?? 0) > C3.families.dex.warnAfterSeconds);
    const veryStale = values.filter((value) => (value.ageSeconds ?? 0) > C3.families.dex.criticalAfterSeconds);
    // The recorded sample really does hold them: quiet pairs of a Uniswap page, up to 485 days old.
    expect(veryStale.length).toBeGreaterThan(0);
    expect(stale.length).toBeGreaterThan(veryStale.length);

    const result = runFreshnessCheck(values, C3);
    expect(result.severity).toBe('critical');
    expect(result.findings).toHaveLength(stale.length);
    expect(result.findings.filter((found) => found.severity === 'critical')).toHaveLength(veryStale.length);
    expect(result.findings.every((found) => found.code === 'stale')).toBe(true);
    // Worst first, and each one says what was measured and against which limit.
    expect(result.findings[0]?.severity).toBe('critical');
    expect(result.findings[0]?.message).toMatch(/is dated .+ before the answer that carried it \(limit for DEX data/);
    for (const found of result.findings) {
      const age = found.measurement?.value ?? 0;
      expect(age).toBeGreaterThan(C3.families.dex.warnAfterSeconds);
      if (found.severity === 'critical') expect(age).toBeGreaterThan(C3.families.dex.criticalAfterSeconds);
      else expect(age).toBeLessThanOrEqual(C3.families.dex.criticalAfterSeconds);
    }
  });

  it('keeps the fresh pairs of the same answer out of the findings but in the measurements', () => {
    const result = runFreshnessCheck(pricesOf('E08'), C3);
    expect(result.measurements).toHaveLength(100);
    expect(result.findings.length).toBeLessThan(100);
  });
});

describe('what C3 does with a timestamp it cannot use', () => {
  it('reports an unreadable timestamp as info, leaving the field itself to C7 (D8)', () => {
    const source = damaged('E02', 'E02-quotes-latest-btc-paxg', (data) => {
      (data as { quote: { last_updated: string }[] }[])[0]!.quote[0]!.last_updated = 'not a date';
    });
    const result = runFreshnessCheck(datedPrices(priceObservations(source).items), C3);
    expect(result.severity).toBe('info');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: 'age_unknown', severity: 'info' });
    expect(result.findings[0]?.message).toMatch(/C7 reports the field itself/);
    expect(result.findings[0]?.measurement?.value).toBeNull();
  });

  it('reports a price dated after the answer that carried it', () => {
    const source = damaged('E02', 'E02-quotes-latest-btc-paxg', (data) => {
      (data as { quote: { last_updated: string }[] }[])[0]!.quote[0]!.last_updated = '2026-09-24T16:10:00.000Z';
    });
    const result = runFreshnessCheck(datedPrices(priceObservations(source).items), C3);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: 'timestamp_ahead_of_response', severity: 'warning' });
    expect(result.findings[0]?.message).toMatch(/6 min after the answer that carried it \(tolerance: 60 s\)/);
  });

  it('accepts a timestamp within the tolerance, because the two clocks need not agree to the second', () => {
    const ahead = new Date(Date.parse('2026-09-24T16:04:03.419Z') + 30_000).toISOString();
    const source = damaged('E02', 'E02-quotes-latest-btc-paxg', (data) => {
      (data as { quote: { last_updated: string }[] }[])[0]!.quote[0]!.last_updated = ahead;
    });
    const result = runFreshnessCheck(datedPrices(priceObservations(source).items), C3);
    expect(result.findings).toEqual([]);
  });
});

describe('formatDuration', () => {
  it('rounds to the unit a report reads best in', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(89)).toBe('89 s');
    expect(formatDuration(120.419)).toBe('2 min');
    expect(formatDuration(3_600)).toBe('60 min');
    expect(formatDuration(5_400)).toBe('2 h');
    expect(formatDuration(86_400)).toBe('24 h');
    expect(formatDuration(41_973_294)).toBe('486 d');
    // A negative age is a duration too: the sign is carried by the sentence, not by the number.
    expect(formatDuration(-360)).toBe('6 min');
  });
});
