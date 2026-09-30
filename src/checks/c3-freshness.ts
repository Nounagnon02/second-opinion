/**
 * C3 - freshness. Every value a source dates is read against the clock of the answer that carried it, never against
 * the local one: a replayed fixture always gives the same age, and network time is not counted as staleness (D4).
 *
 * Two threshold families, because the sources do not age at the same pace: the aggregated quotes, which CMC
 * documents as refreshing every 60 s, and the DEX prices, which follow trading activity and can be old for a quiet
 * token without being wrong. Both live in `config/checks.json`.
 *
 * A value whose timestamp could not be read is reported here as `info` only: the field itself is a required field
 * that C7 already scores, and one defect must not be counted twice (D8).
 */
import type { PriceKind, PriceObservation, SourceRef } from '../normalize/model.js';
import type { RwaQuote } from '../normalize/rwa.js';
import type { FreshnessConfig, FreshnessFamily } from './config.js';
import { evaluated, evidence, notApplicable, type CheckResult, type Finding, type Measurement } from './model.js';
import { priceLabel } from './prices.js';

/**
 * Which family dates a price of each kind, and which kinds the source does not date at all.
 * E14 gives its wrapper tokens no timestamp of their own; the asset-level timestamp of the same answer dates them,
 * and `datedRwaQuotes` reads that one (D7).
 */
export const PRICE_KIND_FAMILY: Record<PriceKind, FreshnessFamily | null> = {
  aggregate: 'aggregate',
  conversion: 'aggregate',
  dex_token: 'dex',
  dex_pair: 'dex',
  rwa_wrapper: null,
};

const FAMILY_LABEL: Record<FreshnessFamily, string> = {
  aggregate: 'aggregated data',
  dex: 'DEX data',
};

/** One value an answer dates, brought to the form C3 reads. */
export interface DatedValue {
  /** What is dated, in the words of the outputs, for example `E02 aggregated price of BTC`. */
  label: string;
  family: FreshnessFamily;
  source: SourceRef;
  /** The timestamp the answer carried, ISO 8601 UTC; `null` when it could not be read. */
  lastUpdated: string | null;
  /** `source.observedAt` minus `lastUpdated`, in seconds; negative means dated after the answer. */
  ageSeconds: number | null;
}

/** The prices C3 can date. Kinds whose source carries no timestamp of their own are left out, not reported. */
export function datedPrices(observations: readonly PriceObservation[]): DatedValue[] {
  const dated: DatedValue[] = [];
  for (const observation of observations) {
    const family = PRICE_KIND_FAMILY[observation.kind];
    if (family === null) continue;
    dated.push({
      label: priceLabel(observation),
      family,
      source: observation.source,
      lastUpdated: observation.lastUpdated,
      ageSeconds: observation.ageSeconds,
    });
  }
  return dated;
}

/** The asset-level timestamp of E14, which dates the average tokenized price and the wrappers under it (D7). */
export function datedRwaQuotes(quotes: readonly RwaQuote[]): DatedValue[] {
  return quotes.map((quote) => ({
    label: `${quote.source.endpoint} average tokenized price of ${quote.asset.symbol ?? 'the requested asset'}`,
    family: 'aggregate' as const,
    source: quote.source,
    lastUpdated: quote.lastUpdated,
    ageSeconds: quote.ageSeconds,
  }));
}

/** A duration in the words a report uses, rounded to the unit that reads best. */
export function formatDuration(seconds: number): string {
  const total = Math.round(Math.abs(seconds));
  if (total < 90) return `${total} s`;
  if (total < 5_400) return `${Math.round(total / 60)} min`;
  if (total < 172_800) return `${Math.round(total / 3_600)} h`;
  return `${Math.round(total / 86_400)} d`;
}

function measure(value: DatedValue, limits: { warnAfterSeconds: number }): Measurement {
  return {
    label: value.label,
    value: value.ageSeconds,
    unit: 'seconds',
    threshold: limits.warnAfterSeconds,
    evidence: evidence(value.source),
  };
}

function finding(value: DatedValue, measurement: Measurement, part: Pick<Finding, 'code' | 'severity' | 'message'>): Finding {
  return { ...part, measurement, evidence: [evidence(value.source)] };
}

function assess(value: DatedValue, config: FreshnessConfig, measurement: Measurement): Finding | null {
  const limits = config.families[value.family];
  const age = value.ageSeconds;
  if (age === null) {
    return {
      code: 'age_unknown',
      severity: 'info',
      message: `${value.label} carries no usable timestamp, so its age could not be measured; C7 reports the field itself.`,
      measurement,
      evidence: [evidence(value.source)],
    };
  }
  if (age < -config.futureToleranceSeconds) {
    return finding(value, measurement, {
      code: 'timestamp_ahead_of_response',
      severity: 'warning',
      message:
        `${value.label} is dated ${value.lastUpdated ?? 'at an unreadable time'}, ` +
        `${formatDuration(age)} after the answer that carried it ` +
        `(tolerance: ${formatDuration(config.futureToleranceSeconds)}).`,
    });
  }
  if (age > limits.warnAfterSeconds) {
    const critical = age > limits.criticalAfterSeconds;
    const limit = critical ? limits.criticalAfterSeconds : limits.warnAfterSeconds;
    return finding(value, measurement, {
      code: 'stale',
      severity: critical ? 'critical' : 'warning',
      message:
        `${value.label} is dated ${value.lastUpdated ?? 'at an unreadable time'}, ` +
        `${formatDuration(age)} before the answer that carried it ` +
        `(limit for ${FAMILY_LABEL[value.family]}: ${formatDuration(limit)}).`,
    });
  }
  return null;
}

/**
 * Runs C3 on every dated value of a run. With no dated value at all the check is `not_applicable`: nothing was read
 * that could be aged, which is not the same as reading a fresh one (D9).
 */
export function runFreshnessCheck(values: readonly DatedValue[], config: FreshnessConfig): CheckResult {
  if (values.length === 0) {
    return notApplicable('C3', 'No answer carrying a dated value was read for this asset.');
  }
  const measurements: Measurement[] = [];
  const findings: Finding[] = [];
  for (const value of values) {
    const measurement = measure(value, config.families[value.family]);
    measurements.push(measurement);
    const found = assess(value, config, measurement);
    if (found) findings.push(found);
  }
  return evaluated('C3', { findings, measurements, sources: values.map((value) => value.source) });
}
