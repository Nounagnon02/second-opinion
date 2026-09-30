import { describe, expect, it } from 'vitest';
import {
  deepestPool,
  formatMultiple,
  liquidityOfPools,
  liquidityOfPrices,
  poolLabel,
  PRICE_KIND_ROLE,
  runLiquidityCheck,
  turnoverRatio,
  type LiquidityPoint,
} from '../src/checks/c4-liquidity.js';
import { loadChecksConfig, type LiquidityConfig } from '../src/checks/config.js';
import type { CheckResult, Measurement } from '../src/checks/model.js';
import { pricesOfAsset } from '../src/checks/prices.js';
import { normalizeDexPools } from '../src/normalize/dex.js';
import { priceObservations } from '../src/normalize/index.js';
import { damaged, recordedSource } from './helpers/normalize.js';

const { C4 } = loadChecksConfig();

/** PAXG as the recorded answers name it: CMC identifier, symbol, and the contract the DEX calls were made with. */
const PAXG = { cmcId: 4705, symbol: 'PAXG', contract: '0x45804880de22913dafe09f4980848ece6ecbaf78' };

/** The E10 token venue of PAXG: 21006102 USD held against 1415750 USD of 24 h volume, as recorded. */
function tokenVenue(source = recordedSource('E10', 'E10-dex-token-price-paxg')): LiquidityPoint[] {
  return liquidityOfPrices(pricesOfAsset(priceObservations(source).items, PAXG));
}

/** The ten recorded pools of PAXG, which E11 returns in one answer. */
function poolVenues(source = recordedSource('E11', 'E11-dex-token-pools-paxg')): LiquidityPoint[] {
  return liquidityOfPools(normalizeDexPools(source).items);
}

/** What a `check` run on PAXG reads for C4: the token, then its pools (D5). */
function paxgVenues(): LiquidityPoint[] {
  return [...tokenVenue(), ...poolVenues()];
}

/** The BULL/WETH pair of the recorded Uniswap page: 39995193 USD traded against 171 USD held (observation 11). */
function phantomVenue(): LiquidityPoint[] {
  const observations = priceObservations(recordedSource('E08', 'E08-dex-spot-pairs-paxg-uniswap')).items;
  return liquidityOfPrices(pricesOfAsset(observations, { symbol: 'BULL' }));
}

function codes(result: CheckResult): string[] {
  return result.findings.map((finding) => finding.code);
}

function measurementOf(result: CheckResult, label: string): Measurement | undefined {
  return result.measurements.find((measurement) => measurement.label === label);
}

describe('which venues C4 reads', () => {
  it('reads the DEX sources only: the aggregates carry no depth, and a wrapper is read through its own token', () => {
    expect(PRICE_KIND_ROLE).toEqual({
      aggregate: null,
      conversion: null,
      dex_token: 'token',
      dex_pair: 'pool',
      rwa_wrapper: null,
    });
  });

  it('leaves out the aggregated answer, which states no liquidity to measure', () => {
    const observations = priceObservations(recordedSource('E02', 'E02-quotes-latest-btc-paxg')).items;
    expect(observations.length).toBeGreaterThan(0);
    expect(liquidityOfPrices(pricesOfAsset(observations, PAXG))).toEqual([]);
  });

  it('reads E10 as the token venue, with the two values D5 names', () => {
    const venues = tokenVenue();
    expect(venues).toHaveLength(1);
    const [venue] = venues;
    expect(venue?.label).toBe(`E10 DEX token liquidity of ${PAXG.contract}`);
    expect(venue?.role).toBe('token');
    expect(venue?.source.endpoint).toBe('E10');
    expect(venue?.liquidityUsd).toBe(21_006_101.629415408);
    expect(venue?.volume24hUsd).toBe(1_415_750.2817323464);
  });

  it('reads the ten pools of E11, naming each one by the sides it holds and the venue running it', () => {
    const pools = poolVenues();
    expect(pools).toHaveLength(10);
    expect(pools.every((pool) => pool.role === 'pool')).toBe(true);
    expect(pools[0]?.label).toBe('E11 pool liquidity of PAXG/WETH on Uniswap v2');
    expect(pools[0]?.source.endpoint).toBe('E11');
    // The answer sends these two as decimal strings; the normaliser parses them (D8).
    expect(pools[0]?.liquidityUsd).toBe(16_257_792.367634999);
    expect(pools[0]?.volume24hUsd).toBe(351_538.4385732713);
  });

  it('names a pool by its address when the answer gives no symbol on either side', () => {
    const source = damaged('E11', 'E11-dex-token-pools-paxg', (data) => {
      const [pool] = data as Record<string, unknown>[];
      delete (pool?.t0 as Record<string, unknown>).sym;
      delete (pool?.t1 as Record<string, unknown>).sym;
      delete pool?.exn;
    });
    const [pool] = normalizeDexPools(source).items;
    expect(poolLabel(pool!)).toBe('E11 pool liquidity of 0x9c4fe5ffd9a9fc5678cfbd93aa2d4fd684b67c4c');
  });

  it('reads an E08 pair as a pool, since a pair is a venue an order can reach', () => {
    const venues = phantomVenue();
    expect(venues).toHaveLength(1);
    const [venue] = venues;
    expect(venue?.label).toBe('E08 DEX pair liquidity of BULL');
    expect(venue?.role).toBe('pool');
    expect(venue?.source.endpoint).toBe('E08');
    expect(venue?.liquidityUsd).toBe(171.00653494046296);
    expect(venue?.volume24hUsd).toBe(39_995_193.45976359);
  });
});

describe('deepestPool', () => {
  it('picks the pool holding the most, and never the token total, which no order can be sent to', () => {
    const deepest = deepestPool(paxgVenues());
    expect(deepest?.label).toBe('E11 pool liquidity of PAXG/WETH on Uniswap v2');
    // The E10 token total, 21006102 USD, is larger than every pool and is still not returned.
    expect(deepest?.liquidityUsd).toBeLessThan(tokenVenue()[0]?.liquidityUsd ?? 0);
  });

  it('skips a pool whose depth could not be read, rather than treating it as zero', () => {
    const source = damaged('E11', 'E11-dex-token-pools-paxg', (data) => {
      const [pool] = data as Record<string, unknown>[];
      delete pool?.liqUsd;
    });
    const deepest = deepestPool(poolVenues(source));
    expect(deepest?.label).toBe('E11 pool liquidity of PAXG/USDC on Uniswap v3 (Ethereum)');
  });

  it('has no pool to return when only the token venue was read', () => {
    expect(deepestPool(tokenVenue())).toBeNull();
  });
});

describe('turnoverRatio and formatMultiple', () => {
  it('measures the 24 h volume as a multiple of the depth held', () => {
    expect(turnoverRatio(21_006_101.629415408, 1_415_750.2817323464)).toBeCloseTo(0.0674, 4);
    expect(turnoverRatio(171.00653494046296, 39_995_193.45976359)).toBeCloseTo(233_881.08, 2);
  });

  it('writes a multiple with three significant digits and no trailing zeros', () => {
    expect(formatMultiple(0.06739709760091007)).toBe('0.0674 times');
    expect(formatMultiple(50)).toBe('50 times');
    expect(formatMultiple(233_881.0822269931)).toBe('234000 times');
    expect(formatMultiple(Number.NaN)).toBe('an unreadable multiple');
  });
});

describe('runLiquidityCheck on the recorded PAXG answers', () => {
  it('reports nothing at the shipped limits: a liquid token turns over a small part of its depth', () => {
    const result = runLiquidityCheck(paxgVenues(), C4);
    expect(result.id).toBe('C4');
    expect(result.status).toBe('evaluated');
    expect(result.severity).toBe('info');
    expect(result.findings).toEqual([]);
  });

  it('measures every venue it read, three values each, and cites both answers behind them', () => {
    const result = runLiquidityCheck(paxgVenues(), C4);
    expect(result.measurements).toHaveLength(33);
    expect(result.sources.map((source) => source.endpoint)).toEqual(['E10', 'E11']);
    expect(result.sources.every((source) => source.fixture !== null)).toBe(true);
    const held = measurementOf(result, `E10 DEX token liquidity of ${PAXG.contract}, held`);
    expect(held?.value).toBe(21_006_101.629415408);
    expect(held?.unit).toBe('usd');
    expect(held?.threshold).toBe(C4.warnLiquidityBelowUsd);
    expect(held?.evidence.field).toBeNull();
    expect(held?.evidence.source.endpoint).toBe('E10');
    expect(held?.evidence.source.fixture?.file).toBe('fixtures/discovery/E10-dex-token-price-paxg.json');
  });

  it('carries no limit on a pool it did not weigh, so an output never shows a comparison that was not made', () => {
    const result = runLiquidityCheck(paxgVenues(), C4);
    const weighed = measurementOf(result, 'E11 pool liquidity of PAXG/WETH on Uniswap v2, held');
    const other = measurementOf(result, 'E11 pool liquidity of PAXG/USDT on Uniswap v3 (Ethereum), held');
    expect(weighed?.threshold).toBe(C4.warnLiquidityBelowUsd);
    expect(other?.threshold).toBeNull();
  });

  it('measures a pool that is not the deepest without raising a finding on it (D5)', () => {
    // The thinnest recorded pool, brought under the floor: it is measured, and stays silent because C4 reports the
    // token and the deepest pool. Reporting all ten would say the same thing ten times.
    const source = damaged('E11', 'E11-dex-token-pools-paxg', (data) => {
      const pools = data as Record<string, unknown>[];
      const last = pools[pools.length - 1];
      if (last) last.liqUsd = '1';
    });
    const result = runLiquidityCheck([...tokenVenue(), ...poolVenues(source)], C4);
    expect(result.findings).toEqual([]);
    expect(measurementOf(result, 'E11 pool liquidity of PAXG/USDT on Uniswap v3 (Ethereum), held')?.value).toBe(1);
  });

  it('reports the token venue when the floor is raised above the depth it holds', () => {
    const raised: LiquidityConfig = { ...C4, warnLiquidityBelowUsd: 30_000_000, criticalLiquidityBelowUsd: 1_000 };
    const result = runLiquidityCheck(tokenVenue(), raised);
    expect(codes(result)).toEqual(['thin_venue']);
    expect(result.severity).toBe('warning');
    expect(result.findings[0]?.message).toContain('holds 21006102 USD');
    expect(result.findings[0]?.message).toContain('limit: at least 30000000 USD');
  });
});

describe('runLiquidityCheck on the phantom pair the sample recorded', () => {
  it('reports the pair of observation 11 as critical on both signals', () => {
    const result = runLiquidityCheck(phantomVenue(), C4);
    expect(result.status).toBe('evaluated');
    expect(result.severity).toBe('critical');
    expect([...codes(result)].sort()).toEqual(['thin_venue', 'volume_above_liquidity']);
    expect(result.findings.every((finding) => finding.severity === 'critical')).toBe(true);
  });

  it('says what was observed and against which limit, in the numbers the answer carried', () => {
    const result = runLiquidityCheck(phantomVenue(), C4);
    const thin = result.findings.find((finding) => finding.code === 'thin_venue');
    const above = result.findings.find((finding) => finding.code === 'volume_above_liquidity');
    expect(thin?.message).toBe(
      'E08 DEX pair liquidity of BULL holds 171.00653 USD, which is what a position would have to be closed ' +
        `against; limit: at least ${C4.criticalLiquidityBelowUsd} USD.`,
    );
    expect(above?.message).toBe(
      'E08 DEX pair liquidity of BULL reports 39995193 USD of 24 h volume against 171.00653 USD held, ' +
        `234000 times the depth of the venue; limit: ${C4.criticalTurnoverRatio} times.`,
    );
    expect(above?.evidence).toHaveLength(1);
    expect(above?.evidence[0]?.field).toBeNull();
    expect(above?.evidence[0]?.source.fixture?.file).toBe(
      'fixtures/discovery/E08-dex-spot-pairs-paxg-uniswap.json',
    );
  });

  it('warns rather than alarms when the turnover sits between the two limits', () => {
    const wide: LiquidityConfig = { ...C4, warnTurnoverRatio: 1_000, criticalTurnoverRatio: 1_000_000 };
    const result = runLiquidityCheck(phantomVenue(), wide);
    const above = result.findings.find((finding) => finding.code === 'volume_above_liquidity');
    expect(above?.severity).toBe('warning');
    expect(above?.message).toContain('limit: 1000 times');
  });
});

describe('what runLiquidityCheck does with what it could not read', () => {
  it('is not applicable when no DEX venue was read, rather than passing silently (D9)', () => {
    const result = runLiquidityCheck([], C4);
    expect(result.status).toBe('not_applicable');
    expect(result.severity).toBeNull();
    expect(result.reason).toBe('No DEX venue was read for this asset, so there is no depth to measure.');
    expect(result.measurements).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it('reports a missing liquidity as info, leaving the field itself to C7 (D8)', () => {
    const source = damaged('E10', 'E10-dex-token-price-paxg', (data) => {
      delete (data as Record<string, unknown>).l;
    });
    const result = runLiquidityCheck(tokenVenue(source), C4);
    expect(codes(result)).toEqual(['liquidity_unknown']);
    expect(result.severity).toBe('info');
    expect(result.findings[0]?.message).toContain('C7 reports the field itself');
    expect(result.findings[0]?.measurement?.value).toBeNull();
  });

  it('reports a missing volume as info, and still weighs the depth that was read', () => {
    const source = damaged('E10', 'E10-dex-token-price-paxg', (data) => {
      delete (data as Record<string, unknown>).v24h;
    });
    const result = runLiquidityCheck(tokenVenue(source), C4);
    expect(codes(result)).toEqual(['volume_unknown']);
    expect(result.findings[0]?.message).toContain('against the 21006102 USD held');
    const label = `E10 DEX token liquidity of ${PAXG.contract}, 24 h volume against the depth held`;
    expect(measurementOf(result, label)?.value).toBeNull();
  });

  it('reports a venue holding nothing once, and divides no volume by that zero', () => {
    const source = damaged('E10', 'E10-dex-token-price-paxg', (data) => {
      (data as Record<string, unknown>).l = 0;
    });
    const result = runLiquidityCheck(tokenVenue(source), C4);
    expect(codes(result)).toEqual(['thin_venue']);
    expect(result.severity).toBe('critical');
    expect(result.findings[0]?.message).toContain('holds 0 USD');
    const label = `E10 DEX token liquidity of ${PAXG.contract}, 24 h volume against the depth held`;
    expect(measurementOf(result, label)?.value).toBeNull();
  });
});

describe('the order size preflight_trade weighs (D5)', () => {
  it('measures an order as a share of the deepest pool, and reports nothing at the shipped limits', () => {
    const result = runLiquidityCheck(paxgVenues(), C4, 100_000);
    expect(codes(result)).toEqual([]);
    const share = measurementOf(result, 'An order of 100000 USD against the deepest pool read');
    expect(share?.value).toBeCloseTo(0.615, 3);
    expect(share?.unit).toBe('percent');
    expect(share?.threshold).toBe(C4.warnOrderSharePercent);
  });

  it('warns on an order taking more of the pool than the warning limit allows', () => {
    const result = runLiquidityCheck(paxgVenues(), C4, 2_000_000);
    expect(codes(result)).toEqual(['order_above_liquidity_share']);
    expect(result.severity).toBe('warning');
    expect(result.findings[0]?.message).toBe(
      'An order of 2000000 USD is 12.3 % of the 16257792 USD held by E11 pool liquidity of PAXG/WETH on ' +
        `Uniswap v2; limit: ${C4.warnOrderSharePercent} %.`,
    );
  });

  it('turns critical on an order past the critical limit', () => {
    const result = runLiquidityCheck(paxgVenues(), C4, 5_000_000);
    expect(result.severity).toBe('critical');
    expect(result.findings[0]?.message).toContain(`limit: ${C4.criticalOrderSharePercent} %`);
  });

  it('weighs nothing at all when the caller asks about the asset rather than about an order', () => {
    const result = runLiquidityCheck(paxgVenues(), C4);
    expect(result.measurements.some((measurement) => measurement.label.startsWith('An order'))).toBe(false);
  });

  it('says so when no pool was read, rather than falling back on the token total', () => {
    const result = runLiquidityCheck(tokenVenue(), C4, 100_000);
    expect(codes(result)).toEqual(['order_share_unknown']);
    expect(result.severity).toBe('info');
    expect(result.findings[0]?.message).toContain('weighs an order against a pool, not against a token total');
    expect(measurementOf(result, 'An order of 100000 USD against the deepest pool read')?.value).toBeNull();
  });

  it('says so when the order size is not an amount of USD above 0, rather than dropping the question', () => {
    for (const size of [0, -1, Number.NaN]) {
      const result = runLiquidityCheck(paxgVenues(), C4, size);
      expect(codes(result), String(size)).toEqual(['order_size_unreadable']);
      expect(result.severity).toBe('info');
      expect(measurementOf(result, 'An order against the deepest pool read')?.value).toBeNull();
    }
  });
});
