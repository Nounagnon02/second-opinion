/**
 * C1 - the aggregated price against the DEX price of the same token. The aggregate is what CMC publishes for the
 * asset (E02 `quote[].price`); the market price is what a decentralised venue traded it at (E10 `p`, or an E09 pair
 * for the audit). How far apart the two sit is the first thing an agent should know before acting on the aggregate.
 *
 * E10 rather than E08: E08 cannot be narrowed to one asset, and the E10 price for PAXG matched the deepest Uniswap
 * pool to the last digit in the recorded sample (D3). A run with no token contract has no DEX price at all, and the
 * check comes back `not_applicable` rather than silently passing (D9).
 *
 * The gap is measured, not judged: C1 says how far apart the two prices are and against which configured limit.
 * Whether the venue behind the market price is deep enough for that gap to matter is C4's measurement (D5), and the
 * score (T3.6) is what puts the two together.
 */
import type { PriceKind, PriceObservation, SourceRef } from '../normalize/model.js';
import type { DivergenceConfig } from './config.js';
import { evaluated, evidence, notApplicable, type CheckResult, type Finding, type Measurement } from './model.js';
import { formatPercent, formatUsd, priceLabel } from './prices.js';

/** Which side of the comparison a price sits on. */
export type PriceSide = 'reference' | 'market';

/**
 * Which side each kind of price belongs to. The RWA wrappers are on neither: they are compared with the average
 * tokenized price of their own asset, which is C5's measurement, not a market gap (D6).
 */
export const PRICE_KIND_SIDE: Record<PriceKind, PriceSide | null> = {
  aggregate: 'reference',
  conversion: 'reference',
  dex_token: 'market',
  dex_pair: 'market',
  rwa_wrapper: null,
};

/** One price C1 reads, brought to the form the comparison needs. */
export interface ComparedPrice {
  /** What the price is, in the words of the outputs, for example `E02 aggregated price of PAXG`. */
  label: string;
  source: SourceRef;
  /** `null` when the answer carried no usable price; C7 scores the field itself (D8). */
  priceUsd: number | null;
}

/** The prices of one side, from observations already narrowed to one asset (`pricesOfAsset`). */
export function comparedPrices(observations: readonly PriceObservation[], side: PriceSide): ComparedPrice[] {
  return observations
    .filter((observation) => PRICE_KIND_SIDE[observation.kind] === side)
    .map((observation) => ({
      label: priceLabel(observation),
      source: observation.source,
      priceUsd: observation.priceUsd,
    }));
}

/** How far the market price sits from the reference, as a percentage of the reference. Positive means above. */
export function relativeGapPercent(reference: number, market: number): number {
  return ((market - reference) / reference) * 100;
}

function priceMeasurement(price: ComparedPrice): Measurement {
  return {
    label: price.label,
    value: price.priceUsd,
    unit: 'usd',
    threshold: null,
    evidence: evidence(price.source),
  };
}

function gapMeasurement(market: ComparedPrice, gap: number | null, config: DivergenceConfig): Measurement {
  return {
    label: `${market.label} against the aggregated price`,
    value: gap,
    unit: 'percent',
    threshold: config.warnAbovePercent,
    evidence: evidence(market.source),
  };
}

/** A gap the answers could not produce: the price behind it is a required field, which C7 already scores (D8). */
function gapUnknown(reference: ComparedPrice, market: ComparedPrice, measurement: Measurement): Finding {
  const missing = market.priceUsd === null ? market.label : reference.label;
  return {
    code: 'gap_unknown',
    severity: 'info',
    message:
      `${market.label} could not be compared with ${reference.label}: ${missing} carries no usable price, ` +
      'so no gap was measured; C7 reports the field itself.',
    measurement,
    evidence: [evidence(market.source), evidence(reference.source)],
  };
}

function gapFinding(
  reference: ComparedPrice,
  market: ComparedPrice,
  gap: number,
  measurement: Measurement,
  config: DivergenceConfig,
): Finding {
  const critical = Math.abs(gap) > config.criticalAbovePercent;
  const limit = critical ? config.criticalAbovePercent : config.warnAbovePercent;
  return {
    code: 'price_gap',
    severity: critical ? 'critical' : 'warning',
    message:
      `${market.label} is ${formatUsd(market.priceUsd ?? 0)}, ` +
      `${formatPercent(Math.abs(gap))} ${gap >= 0 ? 'above' : 'below'} ${reference.label} ` +
      `(${formatUsd(reference.priceUsd ?? 0)}); limit: ${formatPercent(limit)}.`,
    measurement,
    evidence: [evidence(market.source), evidence(reference.source)],
  };
}

/**
 * Runs C1 for one asset: every market price against the one aggregated price the run read.
 *
 * With no market price the check is `not_applicable`: nothing was read that could be compared, which is not the
 * same as reading a price that agrees (D9). The caller replaces the reason when it knows the cause, for example an
 * asset that has no token contract to query a DEX with.
 */
export function runDexDivergenceCheck(
  reference: ComparedPrice | null,
  markets: readonly ComparedPrice[],
  config: DivergenceConfig,
): CheckResult {
  const marketSources = markets.map((market) => market.source);
  if (markets.length === 0) {
    return notApplicable('C1', 'No DEX price was read for this asset, so there is nothing to compare.');
  }
  if (reference === null) {
    return notApplicable(
      'C1',
      'No aggregated price was read for this asset, so there is nothing to compare the DEX prices with.',
      marketSources,
    );
  }

  const referenceMeasurement = priceMeasurement(reference);
  const measurements: Measurement[] = [referenceMeasurement];
  const findings: Finding[] = [];
  const base = reference.priceUsd;

  if (base !== null && base <= 0) {
    findings.push({
      code: 'reference_not_positive',
      severity: 'warning',
      message:
        `${reference.label} is ${formatUsd(base)}, so no relative gap can be measured against it; ` +
        'the DEX prices are reported as they were read.',
      measurement: referenceMeasurement,
      evidence: [evidence(reference.source)],
    });
  }

  for (const market of markets) {
    measurements.push(priceMeasurement(market));
    const gap =
      base !== null && base > 0 && market.priceUsd !== null ? relativeGapPercent(base, market.priceUsd) : null;
    const measurement = gapMeasurement(market, gap, config);
    measurements.push(measurement);
    if (gap === null) {
      // A reference price of zero is already reported once above; repeating it per market would say no more.
      if (base === null || market.priceUsd === null) findings.push(gapUnknown(reference, market, measurement));
      continue;
    }
    if (Math.abs(gap) > config.warnAbovePercent) {
      findings.push(gapFinding(reference, market, gap, measurement, config));
    }
  }

  return evaluated('C1', { findings, measurements, sources: [reference.source, ...marketSources] });
}
