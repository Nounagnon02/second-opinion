/**
 * C4 - the depth behind a price. A venue can report a large 24 h volume while holding far too little liquidity for
 * an agent to leave a position at the price it just read; the specification calls that phantom liquidity (F4).
 *
 * Read on the latest snapshot only: E12, the liquidity history, is refused with the documented parameters, so no
 * trend over time is claimed (D5). What is read is E10 `l` and `v24h` for the token as a whole, E11 `liqUsd` and
 * `v24` for each pool, and the same two values per pair in E08 and E09.
 *
 * Findings are raised on the two venues D5 names - the token, and the deepest pool read - while every other pool is
 * measured and its answer cited. One asset therefore leaves the evidence of all its pools behind it without
 * producing ten near-identical findings.
 *
 * C4 measures depth, not price: how far the price of a venue sits from the aggregate is C1's measurement, and the
 * score (T3.6) is what puts the two together. Like C1, an asset with no token contract reaches no DEX venue at all,
 * and the check comes back `not_applicable` rather than silently passing (D9).
 */
import type { PoolObservation } from '../normalize/dex.js';
import type { PriceKind, PriceObservation, SourceRef } from '../normalize/model.js';
import type { LiquidityConfig } from './config.js';
import { evaluated, evidence, notApplicable, type CheckResult, type Finding, type Measurement } from './model.js';
import { formatPercent, formatUsd, observationName } from './prices.js';

/**
 * What a venue is, for this check: the token seen across every venue at once (E10), or one pool or pair (E08, E09,
 * E11). Only a pool can take an order, so the order size of `preflight_trade` is weighed against a pool (D5).
 */
export type LiquidityRole = 'token' | 'pool';

/**
 * Which role each kind of price source plays. The aggregated sources are on neither: CMC publishes no depth behind
 * them, and an RWA wrapper is measured through the DEX venues of its own token, not through E14.
 */
export const PRICE_KIND_ROLE: Record<PriceKind, LiquidityRole | null> = {
  aggregate: null,
  conversion: null,
  dex_token: 'token',
  dex_pair: 'pool',
  rwa_wrapper: null,
};

/** One venue C4 reads, brought to the form the measurements need. */
export interface LiquidityPoint {
  /** What the venue is, in the words of the outputs, for example `E11 pool liquidity of PAXG/WETH on Uniswap v2`. */
  label: string;
  role: LiquidityRole;
  source: SourceRef;
  /** `null` when the answer carried no usable liquidity; C7 scores the field itself (D8). */
  liquidityUsd: number | null;
  /** `null` when the answer carried no usable 24 h volume. */
  volume24hUsd: number | null;
}

const ROLE_LABEL: Record<LiquidityRole, string> = {
  token: 'DEX token liquidity',
  pool: 'DEX pair liquidity',
};

/** The venues carried by price observations already narrowed to one asset (`pricesOfAsset`): E08, E09 and E10. */
export function liquidityOfPrices(observations: readonly PriceObservation[]): LiquidityPoint[] {
  return observations.flatMap((observation): LiquidityPoint[] => {
    const role = PRICE_KIND_ROLE[observation.kind];
    if (role === null) return [];
    const name = observationName(observation);
    return [
      {
        label:
          name === null
            ? `${observation.source.endpoint} ${ROLE_LABEL[role]}`
            : `${observation.source.endpoint} ${ROLE_LABEL[role]} of ${name}`,
        role,
        source: observation.source,
        liquidityUsd: observation.liquidityUsd,
        volume24hUsd: observation.volume24hUsd,
      },
    ];
  });
}

/** Names a pool the way the outputs do: the two sides it holds, and the venue running it when the answer says so. */
export function poolLabel(pool: PoolObservation): string {
  const symbols = pool.tokens.map((token) => token.symbol).filter((symbol): symbol is string => symbol !== null);
  const name = symbols.length > 0 ? symbols.join('/') : pool.address;
  const head =
    name === null ? `${pool.source.endpoint} pool liquidity` : `${pool.source.endpoint} pool liquidity of ${name}`;
  return pool.exchange === null ? head : `${head} on ${pool.exchange}`;
}

/** The venues carried by an E11 answer: one per pool of the token. */
export function liquidityOfPools(pools: readonly PoolObservation[]): LiquidityPoint[] {
  return pools.map((pool) => ({
    label: poolLabel(pool),
    role: 'pool' as const,
    source: pool.source,
    liquidityUsd: pool.liquidityUsd,
    volume24hUsd: pool.volume24hUsd,
  }));
}

/**
 * The pool holding the most, among those whose liquidity could be read; `null` when no pool was read or none of
 * them stated a depth. The token itself is never returned: it is not a venue an order can be sent to.
 */
export function deepestPool(points: readonly LiquidityPoint[]): LiquidityPoint | null {
  return points.reduce<LiquidityPoint | null>((deepest, point) => {
    const held = point.liquidityUsd;
    if (point.role !== 'pool' || held === null) return deepest;
    if (deepest === null || held > (deepest.liquidityUsd ?? 0)) return point;
    return deepest;
  }, null);
}

/** How many times a venue traded the depth it holds, over 24 h. The caller checks that `liquidityUsd` is above 0. */
export function turnoverRatio(liquidityUsd: number, volume24hUsd: number): number {
  return volume24hUsd / liquidityUsd;
}

/** A multiple as a report writes it: three significant digits, and no trailing zeros. */
export function formatMultiple(value: number): string {
  if (!Number.isFinite(value)) return 'an unreadable multiple';
  return `${Number.parseFloat(value.toPrecision(3))} times`;
}

function liquidityMeasurement(point: LiquidityPoint, threshold: number | null): Measurement {
  return {
    label: `${point.label}, held`,
    value: point.liquidityUsd,
    unit: 'usd',
    threshold,
    evidence: evidence(point.source),
  };
}

function volumeMeasurement(point: LiquidityPoint): Measurement {
  return {
    label: `${point.label}, 24 h volume`,
    value: point.volume24hUsd,
    unit: 'usd',
    threshold: null,
    evidence: evidence(point.source),
  };
}

function turnoverMeasurement(point: LiquidityPoint, value: number | null, threshold: number | null): Measurement {
  return {
    label: `${point.label}, 24 h volume against the depth held`,
    value,
    unit: 'ratio',
    threshold,
    evidence: evidence(point.source),
  };
}

function finding(
  point: LiquidityPoint,
  measurement: Measurement,
  part: Pick<Finding, 'code' | 'severity' | 'message'>,
): Finding {
  return { ...part, measurement, evidence: [evidence(point.source)] };
}

/** How thin the venue is, against the configured floor. A venue holding nothing at all falls under it too. */
function thinVenue(
  point: LiquidityPoint,
  held: number,
  measurement: Measurement,
  config: LiquidityConfig,
): Finding | null {
  if (held >= config.warnLiquidityBelowUsd) return null;
  const critical = held < config.criticalLiquidityBelowUsd;
  const limit = critical ? config.criticalLiquidityBelowUsd : config.warnLiquidityBelowUsd;
  return finding(point, measurement, {
    code: 'thin_venue',
    severity: critical ? 'critical' : 'warning',
    message:
      `${point.label} holds ${formatUsd(held)}, which is what a position would have to be closed against; ` +
      `limit: at least ${formatUsd(limit)}.`,
  });
}

/** How far the reported 24 h volume runs past the depth held, which is the phantom-liquidity signal itself. */
function volumeAboveDepth(
  point: LiquidityPoint,
  held: number,
  traded: number,
  measurement: Measurement,
  config: LiquidityConfig,
): Finding | null {
  const ratio = turnoverRatio(held, traded);
  if (ratio <= config.warnTurnoverRatio) return null;
  const critical = ratio > config.criticalTurnoverRatio;
  const limit = critical ? config.criticalTurnoverRatio : config.warnTurnoverRatio;
  return finding(point, measurement, {
    code: 'volume_above_liquidity',
    severity: critical ? 'critical' : 'warning',
    message:
      `${point.label} reports ${formatUsd(traded)} of 24 h volume against ${formatUsd(held)} held, ` +
      `${formatMultiple(ratio)} the depth of the venue; limit: ${formatMultiple(limit)}.`,
  });
}

/** Everything C4 says about one venue: three measurements, and the findings they raised when it is a reported one. */
function assess(
  point: LiquidityPoint,
  config: LiquidityConfig,
  reported: boolean,
): { measurements: Measurement[]; findings: Finding[] } {
  const held = point.liquidityUsd;
  const traded = point.volume24hUsd;
  const ratio = held !== null && held > 0 && traded !== null ? turnoverRatio(held, traded) : null;
  const liquidity = liquidityMeasurement(point, reported ? config.warnLiquidityBelowUsd : null);
  const turnover = turnoverMeasurement(point, ratio, reported ? config.warnTurnoverRatio : null);
  const measurements = [liquidity, volumeMeasurement(point), turnover];
  if (!reported) return { measurements, findings: [] };

  if (held === null) {
    return {
      measurements,
      findings: [
        finding(point, liquidity, {
          code: 'liquidity_unknown',
          severity: 'info',
          message:
            `${point.label} carries no usable liquidity, so the depth behind its price could not be measured; ` +
            'C7 reports the field itself.',
        }),
      ],
    };
  }

  const findings: Finding[] = [];
  const thin = thinVenue(point, held, liquidity, config);
  if (thin) findings.push(thin);

  if (traded === null) {
    findings.push(
      finding(point, turnover, {
        code: 'volume_unknown',
        severity: 'info',
        message:
          `${point.label} carries no usable 24 h volume, so it could not be read against the ${formatUsd(held)} ` +
          'held; C7 reports the field itself.',
      }),
    );
    return { measurements, findings };
  }
  // A venue holding nothing has no depth to divide by, and `thin_venue` above has already reported it as critical.
  if (held > 0) {
    const above = volumeAboveDepth(point, held, traded, turnover, config);
    if (above) findings.push(above);
  }
  return { measurements, findings };
}

/** What an order of this size would take from the deepest pool read, which is what `preflight_trade` weighs (D5). */
function assessOrder(
  orderSizeUsd: number,
  deepest: LiquidityPoint | null,
  fallback: SourceRef,
  config: LiquidityConfig,
): { measurement: Measurement; finding: Finding | null } {
  const depth = deepest?.liquidityUsd ?? null;
  const share = depth !== null && depth > 0 ? (orderSizeUsd / depth) * 100 : null;
  const source = deepest?.source ?? fallback;
  const measurement: Measurement = {
    label: `An order of ${formatUsd(orderSizeUsd)} against the deepest pool read`,
    value: share,
    unit: 'percent',
    threshold: config.warnOrderSharePercent,
    evidence: evidence(source),
  };
  if (share === null || depth === null) {
    return {
      measurement,
      finding: {
        code: 'order_share_unknown',
        severity: 'info',
        message:
          `An order of ${formatUsd(orderSizeUsd)} could not be weighed: no pool stating a depth above 0 was read ` +
          'for this asset, and C4 weighs an order against a pool, not against a token total.',
        measurement,
        evidence: [evidence(source)],
      },
    };
  }
  if (share <= config.warnOrderSharePercent) return { measurement, finding: null };
  const critical = share > config.criticalOrderSharePercent;
  const limit = critical ? config.criticalOrderSharePercent : config.warnOrderSharePercent;
  return {
    measurement,
    finding: {
      code: 'order_above_liquidity_share',
      severity: critical ? 'critical' : 'warning',
      message:
        `An order of ${formatUsd(orderSizeUsd)} is ${formatPercent(share)} of the ${formatUsd(depth)} held by ` +
        `${deepest?.label ?? 'the deepest pool read'}; limit: ${formatPercent(limit)}.`,
      measurement,
      evidence: [evidence(source)],
    },
  };
}

/** An order size the caller asked to weigh but that is not an amount of USD above 0: said, never dropped. */
function unreadableOrder(orderSizeUsd: number, source: SourceRef, config: LiquidityConfig): Finding {
  const measurement: Measurement = {
    label: 'An order against the deepest pool read',
    value: null,
    unit: 'percent',
    threshold: config.warnOrderSharePercent,
    evidence: evidence(source),
  };
  return {
    code: 'order_size_unreadable',
    severity: 'info',
    message:
      `The order size to weigh is ${String(orderSizeUsd)}, which is not an amount of USD above 0, ` +
      'so no share of a pool was measured.',
    measurement,
    evidence: [evidence(source)],
  };
}

/**
 * Runs C4 on every venue a run read for one asset.
 *
 * `orderSizeUsd` is the amount `preflight_trade` is about to weigh, in USD, or `null` when the caller is asking
 * about the asset rather than about an order. An amount that is not a positive number is reported as unreadable
 * rather than dropped: the caller asked for the order to be weighed, and the answer says it was not.
 *
 * With no venue at all the check is `not_applicable`: nothing was read that could be measured, which is not the
 * same as reading a deep venue (D9). The caller replaces the reason when it knows the cause, for example an asset
 * that has no token contract to query a DEX with.
 */
export function runLiquidityCheck(
  points: readonly LiquidityPoint[],
  config: LiquidityConfig,
  orderSizeUsd: number | null = null,
): CheckResult {
  const [first] = points;
  if (first === undefined) {
    return notApplicable('C4', 'No DEX venue was read for this asset, so there is no depth to measure.');
  }

  const deepest = deepestPool(points);
  // The two venues D5 names. Every other pool is measured, and its answer cited, without raising a finding.
  const reported = new Set<LiquidityPoint>(points.filter((point) => point.role === 'token'));
  if (deepest) reported.add(deepest);

  const measurements: Measurement[] = [];
  const findings: Finding[] = [];
  for (const point of points) {
    const assessed = assess(point, config, reported.has(point));
    measurements.push(...assessed.measurements);
    findings.push(...assessed.findings);
  }

  if (orderSizeUsd !== null) {
    const fallback = deepest?.source ?? first.source;
    if (Number.isFinite(orderSizeUsd) && orderSizeUsd > 0) {
      const order = assessOrder(orderSizeUsd, deepest, fallback, config);
      measurements.push(order.measurement);
      if (order.finding) findings.push(order.finding);
    } else {
      const unreadable = unreadableOrder(orderSizeUsd, fallback, config);
      if (unreadable.measurement) measurements.push(unreadable.measurement);
      findings.push(unreadable);
    }
  }

  return evaluated('C4', { findings, measurements, sources: points.map((point) => point.source) });
}
