import { describe, expect, it } from 'vitest';
import {
  C6_COMPARED_ENDPOINTS,
  C6_REFERENCE_ENDPOINT,
  comparedReadings,
  compareSnapshots,
  referenceReading,
  runConsistencyCheck,
  type EndpointReading,
} from '../src/checks/c6-consistency.js';
import { loadChecksConfig, type ConsistencyConfig } from '../src/checks/config.js';
import { pricesOfAsset } from '../src/checks/prices.js';
import type { EndpointId } from '../src/cmc/endpoints.js';
import { priceObservations } from '../src/normalize/index.js';
import type { PriceObservation, SourceResponse } from '../src/normalize/model.js';
import { damaged, recordedSource } from './helpers/normalize.js';

const { C6 } = loadChecksConfig();

/** PAXG as the recorded answers name it: E02, E06 and the E14 wrapper all carry the same CMC identifier. */
const PAXG = { cmcId: 4705, symbol: 'PAXG' };

/** The prices one recorded answer carries for PAXG, in the common model. */
function paxgPrices(response: SourceResponse): PriceObservation[] {
  return pricesOfAsset(priceObservations(response).items, PAXG);
}

function recordedPrices(endpoint: EndpointId, label: string): PriceObservation[] {
  return paxgPrices(recordedSource(endpoint, label));
}

/** The E02 aggregate of PAXG, the side every other endpoint is read against (D7). */
function reference(): EndpointReading {
  const found = referenceReading(recordedPrices('E02', 'E02-quotes-latest-btc-paxg'));
  if (!found) throw new Error('the recorded E02 answer carries no PAXG price');
  return found;
}

/** The two endpoints `check` reads against it: the E06 simple price and the E14 wrapper of the same asset. */
function others(): EndpointReading[] {
  return comparedReadings([
    ...recordedPrices('E06', 'E06-simple-price-btc-paxg'),
    ...recordedPrices('E14', 'E14-rwa-quotes-gold'),
  ]);
}

/** The shipped limits, tightened so that the recorded gap falls on the other side of them. */
function tightened(warn: number, critical: number): ConsistencyConfig {
  return { ...C6, warnAbovePercent: warn, criticalAbovePercent: critical };
}

describe('which endpoints C6 reads against which', () => {
  it('reads every other endpoint against the E02 aggregate, and leaves the DEX price to C1 (D7)', () => {
    expect(C6_REFERENCE_ENDPOINT).toBe('E02');
    expect(C6_COMPARED_ENDPOINTS).toEqual(['E06', 'E14']);
    // E02 against E10 is C1's measurement: counting it here too would make one gap weigh twice.
    expect(comparedReadings(recordedPrices('E10', 'E10-dex-token-price-paxg'))).toEqual([]);
  });

  it('names each reading by the endpoint it came from, so a finding never shows a bare price', () => {
    expect(reference().label).toBe('E02 aggregated price of PAXG');
    expect(others().map((other) => other.label)).toEqual([
      'E06 aggregated price of PAXG',
      'E14 wrapper price of PAXG',
    ]);
  });

  it('carries the timestamp each answer dated its price with, and none where the answer gives none', () => {
    expect(reference().lastUpdated).toBe('2026-09-24T16:02:03.000Z');
    const [simple, wrapper] = others();
    expect(simple?.lastUpdated).toBe('2026-09-24T16:02:03.000Z');
    // E14 gives its tokens[] no timestamp of their own, so only the price limit applies to them (D7).
    expect(wrapper?.lastUpdated).toBeNull();
  });
});

describe('runConsistencyCheck on the recorded PAXG answers', () => {
  it('finds the three endpoints in agreement at the shipped limits', () => {
    const result = runConsistencyCheck(reference(), others(), C6);
    expect(result).toMatchObject({ id: 'C6', status: 'evaluated', severity: 'info', findings: [] });
    expect(result.title).toBe('Consistency between endpoints');
  });

  it('measures the gap each endpoint really showed on 2026-09-24', () => {
    const result = runConsistencyCheck(reference(), others(), C6);
    const gaps = result.measurements.filter((measurement) => measurement.unit === 'percent');
    // E06 republishes the E02 aggregate to the last digit; E14 prices the wrapper 0.0046 % above it.
    expect(gaps[0]?.value).toBe(0);
    expect(gaps[1]?.value).toBeCloseTo(0.0045619, 7);
    expect(gaps.map((measurement) => measurement.threshold)).toEqual([C6.warnAbovePercent, C6.warnAbovePercent]);
  });

  it('measures how far apart the two timestamps sit, and skips that measurement where there is none', () => {
    const result = runConsistencyCheck(reference(), others(), C6);
    const distances = result.measurements.filter((measurement) => measurement.unit === 'seconds');
    expect(distances).toHaveLength(1);
    expect(distances[0]?.label).toBe('E06 aggregated price of PAXG: time between its timestamp and the E02 one');
    expect(distances[0]?.value).toBe(0);
    expect(distances[0]?.threshold).toBe(C6.snapshotToleranceSeconds);
  });

  it('keeps every price in the measurements, so an output never shows a bare percentage', () => {
    const result = runConsistencyCheck(reference(), others(), C6);
    const prices = result.measurements.filter((measurement) => measurement.unit === 'usd');
    expect(prices.map((measurement) => [measurement.label, measurement.value])).toEqual([
      ['E02 aggregated price of PAXG', 4253.226063661451],
      ['E06 aggregated price of PAXG', 4253.226063661451],
      ['E14 wrapper price of PAXG', 4253.420091887455],
    ]);
  });

  it('cites the three recorded answers it read, each one once', () => {
    const result = runConsistencyCheck(reference(), others(), C6);
    expect(result.sources.map((source) => source.fixture?.file)).toEqual([
      'fixtures/discovery/E02-quotes-latest-btc-paxg.json',
      'fixtures/discovery/E06-simple-price-btc-paxg.json',
      'fixtures/discovery/E14-rwa-quotes-gold.json',
    ]);
  });

  it('reports the recorded wrapper gap once the limit is set below it', () => {
    const result = runConsistencyCheck(reference(), others(), tightened(0.001, 0.002));
    expect(result.severity).toBe('critical');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: 'endpoint_gap', severity: 'critical' });
    expect(result.findings[0]?.message).toBe(
      'E14 wrapper price of PAXG is 4253.4201 USD and E02 aggregated price of PAXG is 4253.2261 USD, ' +
        '0.0046 % above it for the same asset; limit: 0.002 %. E14 dates this price with no timestamp of its own, ' +
        'so the two prices are compared on their values alone.',
    );
  });

  it('cites both answers behind a gap, the one that raised it first', () => {
    const result = runConsistencyCheck(reference(), others(), tightened(0.001, 0.002));
    expect(result.findings[0]?.evidence.map((item) => item.source.endpoint)).toEqual(['E14', 'E02']);
  });

  it('says a gap between two answers of the same snapshot is one, and which snapshot that is', () => {
    const [simple] = others();
    const moved: EndpointReading = { ...simple!, priceUsd: 4300 };
    const result = runConsistencyCheck(reference(), [moved], C6);
    // Critical under the limits T4.2 settled: the 52 gaps of the calibration panel reach 0.0084 % at their widest,
    // so a whole percent between two publications of the same aggregate is far outside anything measured.
    expect(result.findings[0]).toMatchObject({ code: 'endpoint_gap', severity: 'critical' });
    expect(result.findings[0]?.message).toMatch(/1.1 % above it for the same asset; limit: 0.5 %\./);
    expect(result.findings[0]?.message).toMatch(
      /Both are dated 2026-09-24T16:02:03.000Z, so the two answers describe the same snapshot\.$/,
    );
  });
});

describe('two answers that do not describe the same moment (D7)', () => {
  /** The recorded E06 answer, re-dated an hour before the E02 one it is read against. */
  function reDated(price?: number): EndpointReading[] {
    const source = damaged('E06', 'E06-simple-price-btc-paxg', (data) => {
      const quote = (data as { quotes: { price: unknown; last_updated: unknown }[] }[])[1]!.quotes[0]!;
      quote.last_updated = '2026-09-24T15:00:00.000Z';
      if (price !== undefined) quote.price = price;
    });
    return comparedReadings(paxgPrices(source));
  }

  it('reports the distance as info, not the gap, when the two timestamps are further apart than the tolerance', () => {
    const result = runConsistencyCheck(reference(), reDated(), C6);
    expect(result.severity).toBe('info');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: 'different_snapshots', severity: 'info' });
    expect(result.findings[0]?.message).toBe(
      'E06 aggregated price of PAXG is dated 2026-09-24T15:00:00.000Z and E02 aggregated price of PAXG ' +
        '2026-09-24T16:02:03.000Z, 62 min apart (tolerance: 60 s); the two answers describe different snapshots, ' +
        'so the two prices are 0 % apart without that being reported as a disagreement.',
    );
  });

  it('leaves a wide gap unjudged when it may simply be a price that moved', () => {
    const result = runConsistencyCheck(reference(), reDated(3000), C6);
    expect(result.severity).toBe('info');
    expect(result.findings.map((found) => found.code)).toEqual(['different_snapshots']);
    expect(result.findings[0]?.message).toMatch(/the two prices are 29.47 % apart/);
    // The gap is still measured and shown; only the limit it would be judged against is withheld.
    const gap = result.measurements.find((measurement) => measurement.unit === 'percent');
    expect(gap?.value).toBeCloseTo(-29.4653, 4);
    expect(gap?.threshold).toBeNull();
  });

  it('reads two timestamps inside the tolerance as one snapshot, so the gap is judged again', () => {
    const result = runConsistencyCheck(reference(), reDated(3000), { ...C6, snapshotToleranceSeconds: 7200 });
    expect(result.findings.map((found) => found.code)).toEqual(['endpoint_gap']);
    expect(result.findings[0]?.severity).toBe('critical');
  });
});

describe('what C6 does when it cannot compare', () => {
  it('is not applicable when only one endpoint was read, rather than reporting agreement (D9)', () => {
    const result = runConsistencyCheck(reference(), [], C6);
    expect(result).toMatchObject({ id: 'C6', status: 'not_applicable', severity: null, findings: [] });
    expect(result.reason).toMatch(/No second endpoint carrying a value for this asset was read/);
    expect(result.sources[0]?.fixture?.file).toBe('fixtures/discovery/E02-quotes-latest-btc-paxg.json');
  });

  it('is not applicable when no E02 aggregate was read, and still cites the answers it did read', () => {
    const result = runConsistencyCheck(null, others(), C6);
    expect(result).toMatchObject({ status: 'not_applicable', severity: null });
    expect(result.reason).toMatch(/No E02 aggregated price was read/);
    expect(result.sources.map((source) => source.endpoint)).toEqual(['E06', 'E14']);
  });

  it('reports an unreadable price as info, leaving the field itself to C7 (D8)', () => {
    const source = damaged('E06', 'E06-simple-price-btc-paxg', (data) => {
      (data as { quotes: { price: unknown }[] }[])[1]!.quotes[0]!.price = 'not a price';
    });
    const result = runConsistencyCheck(reference(), comparedReadings(paxgPrices(source)), C6);
    expect(result.severity).toBe('info');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: 'gap_unknown', severity: 'info' });
    expect(result.findings[0]?.message).toMatch(/E06 aggregated price of PAXG carries no usable price/);
    expect(result.findings[0]?.message).toMatch(/C7 reports the field itself/);
    expect(result.findings[0]?.measurement?.value).toBeNull();
  });

  it('reports an unreadable aggregate once per endpoint it could not be compared with', () => {
    const source = damaged('E02', 'E02-quotes-latest-btc-paxg', (data) => {
      (data as { quote: { price: unknown }[] }[])[1]!.quote[0]!.price = null;
    });
    const result = runConsistencyCheck(referenceReading(paxgPrices(source)), others(), C6);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((found) => found.code === 'gap_unknown')).toBe(true);
    expect(result.findings[0]?.message).toMatch(/E02 aggregated price of PAXG carries no usable price/);
  });

  it('reports a reference price of zero once, instead of dividing by it', () => {
    const source = damaged('E02', 'E02-quotes-latest-btc-paxg', (data) => {
      (data as { quote: { price: unknown }[] }[])[1]!.quote[0]!.price = 0;
    });
    const result = runConsistencyCheck(referenceReading(paxgPrices(source)), others(), C6);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: 'reference_not_positive', severity: 'warning' });
    expect(result.findings[0]?.message).toMatch(/is 0 USD, so no relative gap can be measured/);
    // The other endpoints are still shown, with no gap invented for them.
    const gaps = result.measurements.filter((measurement) => measurement.unit === 'percent');
    expect(gaps).toHaveLength(2);
    expect(gaps.every((measurement) => measurement.value === null)).toBe(true);
  });
});

describe('compareSnapshots', () => {
  const dated = (lastUpdated: string | null): EndpointReading => ({
    label: 'a reading',
    source: reference().source,
    priceUsd: 1,
    lastUpdated,
  });

  it('reads two timestamps inside the tolerance as the same snapshot, in either order', () => {
    const at = dated('2026-09-24T16:02:03.000Z');
    expect(compareSnapshots(at, dated('2026-09-24T16:02:33.000Z'), C6)).toEqual({
      relation: 'same',
      distanceSeconds: -30,
    });
    expect(compareSnapshots(at, dated('2026-09-24T16:01:33.000Z'), C6)).toEqual({
      relation: 'same',
      distanceSeconds: 30,
    });
  });

  it('reads the tolerance itself as the same snapshot, and one second past it as another', () => {
    const at = dated('2026-09-24T16:02:03.000Z');
    expect(compareSnapshots(at, dated('2026-09-24T16:01:03.000Z'), C6).relation).toBe('same');
    expect(compareSnapshots(at, dated('2026-09-24T16:01:02.000Z'), C6).relation).toBe('different');
  });

  it('reads a missing or unusable timestamp as undated, so only the price limit applies', () => {
    const at = dated('2026-09-24T16:02:03.000Z');
    expect(compareSnapshots(at, dated(null), C6)).toEqual({ relation: 'undated', distanceSeconds: null });
    expect(compareSnapshots(dated(null), at, C6)).toEqual({ relation: 'undated', distanceSeconds: null });
    expect(compareSnapshots(at, dated('not a timestamp'), C6).relation).toBe('undated');
  });
});
