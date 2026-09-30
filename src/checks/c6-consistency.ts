/**
 * C6 - the same asset read from two endpoints, and whether the two answers say the same thing.
 *
 * What `check` compares (D7): the E02 aggregated price against the E06 simple price, which publish the same
 * aggregate, and, for a tokenised wrapper, the E14 `tokens[].price` of the same `crypto_id` against that aggregate.
 * The aggregate against a DEX price is C1's measurement and is not repeated here, so one gap never weighs twice.
 * The comparisons that cost extra credits per asset and describe the API rather than one asset - E07 or E03 against
 * E02, E14 against E16, E17 against E14, E18 against E19 - belong to the audit (T6.1).
 *
 * A gap is a contradiction only between values of the same snapshot. When both sides carry a timestamp, the two
 * must sit within the configured tolerance of each other; beyond it the answers describe different moments, the gap
 * is still measured but reported as `info` rather than judged, because a price that moved is not a price two
 * endpoints disagree on. E14 gives its `tokens[]` no timestamp of their own, so for them the price limit applies
 * alone, which the finding says in as many words.
 *
 * As everywhere in the engine, the gap is measured, not judged into a cause: C6 reports how far apart two answers
 * are and against which configured limit, never why.
 */
import type { EndpointId } from '../cmc/endpoints.js';
import type { PriceObservation, SourceRef } from '../normalize/model.js';
import { ageSeconds } from '../normalize/values.js';
import { relativeGapPercent } from './c1-dex-divergence.js';
import { formatDuration } from './c3-freshness.js';
import type { ConsistencyConfig } from './config.js';
import { evaluated, evidence, notApplicable, type CheckResult, type Finding, type Measurement } from './model.js';
import { formatPercent, formatUsd, priceLabel } from './prices.js';

/** The endpoint whose aggregated price every other one is read against (D7). */
export const C6_REFERENCE_ENDPOINT = 'E02' satisfies EndpointId;

/**
 * The endpoints C6 reads against E02 inside `check`. E10 is deliberately absent: it is C1's market side (D7).
 */
export const C6_COMPARED_ENDPOINTS = ['E06', 'E14'] as const satisfies readonly EndpointId[];

/** One value of one asset, as one endpoint published it. */
export interface EndpointReading {
  /** What the value is, in the words of the outputs, for example `E06 aggregated price of PAXG`. */
  label: string;
  source: SourceRef;
  /** `null` when the answer carried no usable price; C7 scores the field itself (D8). */
  priceUsd: number | null;
  /** The timestamp this answer dated the price with; `null` when the source dates it with nothing of its own. */
  lastUpdated: string | null;
}

/** One normalised observation, brought to the form the comparison needs. */
export function endpointReading(observation: PriceObservation): EndpointReading {
  return {
    label: priceLabel(observation),
    source: observation.source,
    priceUsd: observation.priceUsd,
    lastUpdated: observation.lastUpdated,
  };
}

/**
 * The E02 aggregate of a run, from observations already narrowed to one asset (`pricesOfAsset`); `null` when the
 * run read no E02 answer for it.
 */
export function referenceReading(observations: readonly PriceObservation[]): EndpointReading | null {
  const found = observations.find((observation) => observation.source.endpoint === C6_REFERENCE_ENDPOINT);
  return found === undefined ? null : endpointReading(found);
}

/** The readings C6 compares with the E02 aggregate, in the order the run read them. */
export function comparedReadings(observations: readonly PriceObservation[]): EndpointReading[] {
  const compared: readonly EndpointId[] = C6_COMPARED_ENDPOINTS;
  return observations
    .filter((observation) => compared.includes(observation.source.endpoint))
    .map(endpointReading);
}

/**
 * How two readings sit in time relative to each other.
 * - `same`: both are dated, within the configured tolerance of each other, so a gap between them is a contradiction;
 * - `different`: both are dated, further apart than that, so a gap between them may simply be a price that moved;
 * - `undated`: at least one side carries no timestamp, so only the price limit applies (D7).
 */
export type SnapshotRelation = 'same' | 'different' | 'undated';

export interface Snapshot {
  relation: SnapshotRelation;
  /** The reference timestamp minus the other one, in seconds; `null` when one of the two is missing. */
  distanceSeconds: number | null;
}

/** Whether two readings describe the same snapshot, at the tolerance the configuration sets (D7). */
export function compareSnapshots(
  reference: EndpointReading,
  other: EndpointReading,
  config: ConsistencyConfig,
): Snapshot {
  if (reference.lastUpdated === null || other.lastUpdated === null) {
    return { relation: 'undated', distanceSeconds: null };
  }
  const distance = ageSeconds(reference.lastUpdated, other.lastUpdated);
  if (distance === null) return { relation: 'undated', distanceSeconds: null };
  return {
    relation: Math.abs(distance) <= config.snapshotToleranceSeconds ? 'same' : 'different',
    distanceSeconds: distance,
  };
}

function priceMeasurement(reading: EndpointReading): Measurement {
  return {
    label: reading.label,
    value: reading.priceUsd,
    unit: 'usd',
    threshold: null,
    evidence: evidence(reading.source),
  };
}

/** The gap of one pair. It carries the limit only when the pair was comparable: a judged gap shows what it was judged against. */
function gapMeasurement(other: EndpointReading, gap: number | null, threshold: number | null): Measurement {
  return {
    label: `${other.label} against the ${C6_REFERENCE_ENDPOINT} aggregated price`,
    value: gap,
    unit: 'percent',
    threshold,
    evidence: evidence(other.source),
  };
}

function snapshotMeasurement(other: EndpointReading, snapshot: Snapshot, config: ConsistencyConfig): Measurement {
  return {
    label: `${other.label}: time between its timestamp and the ${C6_REFERENCE_ENDPOINT} one`,
    value: snapshot.distanceSeconds,
    unit: 'seconds',
    threshold: config.snapshotToleranceSeconds,
    evidence: evidence(other.source),
  };
}

function finding(
  reference: EndpointReading,
  other: EndpointReading,
  measurement: Measurement | null,
  part: Pick<Finding, 'code' | 'severity' | 'message'>,
): Finding {
  return { ...part, measurement, evidence: [evidence(other.source), evidence(reference.source)] };
}

/** A gap the answers could not produce: the price behind it is a required field, which C7 already scores (D8). */
function gapUnknown(reference: EndpointReading, other: EndpointReading, measurement: Measurement): Finding {
  const missing = other.priceUsd === null ? other.label : reference.label;
  return finding(reference, other, measurement, {
    code: 'gap_unknown',
    severity: 'info',
    message:
      `${other.label} could not be compared with ${reference.label}: ${missing} carries no usable price, so no ` +
      'gap was measured; C7 reports the field itself.',
  });
}

/** How wide the gap is, said the same way whether or not it is then judged. */
function gapSentence(gap: number | null): string {
  return gap === null ? 'the gap between the two prices could not be measured' : `${formatPercent(Math.abs(gap))} apart`;
}

/** Two answers that do not describe the same moment: the gap is measured and shown, never counted as a contradiction. */
function differentSnapshots(
  reference: EndpointReading,
  other: EndpointReading,
  gap: number | null,
  snapshot: Snapshot,
  measurement: Measurement,
  config: ConsistencyConfig,
): Finding {
  return finding(reference, other, measurement, {
    code: 'different_snapshots',
    severity: 'info',
    message:
      `${other.label} is dated ${other.lastUpdated ?? 'at an unreadable time'} and ${reference.label} ` +
      `${reference.lastUpdated ?? 'at an unreadable time'}, ` +
      `${formatDuration(snapshot.distanceSeconds ?? 0)} apart ` +
      `(tolerance: ${formatDuration(config.snapshotToleranceSeconds)}); the two answers describe different ` +
      `snapshots, so the two prices are ${gapSentence(gap)} without that being reported as a disagreement.`,
  });
}

/** Two endpoints that carry the same asset at the same moment and do not publish the same price. */
function gapFinding(
  reference: EndpointReading,
  other: EndpointReading,
  gap: number,
  snapshot: Snapshot,
  measurement: Measurement,
  config: ConsistencyConfig,
): Finding {
  const critical = Math.abs(gap) > config.criticalAbovePercent;
  const limit = critical ? config.criticalAbovePercent : config.warnAbovePercent;
  const timing =
    snapshot.relation === 'same'
      ? ` Both are dated ${reference.lastUpdated ?? 'at an unreadable time'}, so the two answers describe the same snapshot.`
      : ` ${other.source.endpoint} dates this price with no timestamp of its own, so the two prices are compared on their values alone.`;
  return finding(reference, other, measurement, {
    code: 'endpoint_gap',
    severity: critical ? 'critical' : 'warning',
    message:
      `${other.label} is ${formatUsd(other.priceUsd ?? 0)} and ${reference.label} is ` +
      `${formatUsd(reference.priceUsd ?? 0)}, ${formatPercent(Math.abs(gap))} ` +
      `${gap >= 0 ? 'above' : 'below'} it for the same asset; limit: ${formatPercent(limit)}.${timing}`,
  });
}

/**
 * Runs C6 for one asset: every other endpoint the run read against the one E02 aggregate.
 *
 * The check is `not_applicable` when the run read no second endpoint for this asset, and when it read no E02
 * aggregate to compare them with: in both cases nothing was read that could be compared, which is not the same as
 * reading two answers that agree (D9). The caller may replace the reason when it knows more about why.
 */
export function runConsistencyCheck(
  reference: EndpointReading | null,
  others: readonly EndpointReading[],
  config: ConsistencyConfig,
): CheckResult {
  const otherSources = others.map((other) => other.source);
  if (others.length === 0) {
    return notApplicable(
      'C6',
      'No second endpoint carrying a value for this asset was read, so there is nothing to compare.',
      reference === null ? [] : [reference.source],
    );
  }
  if (reference === null) {
    return notApplicable(
      'C6',
      `No ${C6_REFERENCE_ENDPOINT} aggregated price was read for this asset, so there is nothing to read the ` +
        'other endpoints against.',
      otherSources,
    );
  }

  const theReference = priceMeasurement(reference);
  const measurements: Measurement[] = [theReference];
  const findings: Finding[] = [];
  const base = reference.priceUsd;

  if (base !== null && base <= 0) {
    findings.push({
      code: 'reference_not_positive',
      severity: 'warning',
      message:
        `${reference.label} is ${formatUsd(base)}, so no relative gap can be measured against it; the other ` +
        'endpoints are reported as they were read.',
      measurement: theReference,
      evidence: [evidence(reference.source)],
    });
  }

  for (const other of others) {
    measurements.push(priceMeasurement(other));
    const snapshot = compareSnapshots(reference, other, config);
    if (snapshot.relation !== 'undated') measurements.push(snapshotMeasurement(other, snapshot, config));

    const gap = base !== null && base > 0 && other.priceUsd !== null ? relativeGapPercent(base, other.priceUsd) : null;
    // A gap measured between two different snapshots carries no limit: it is shown, not judged (D7).
    const judged = snapshot.relation !== 'different';
    const measurement = gapMeasurement(other, gap, judged ? config.warnAbovePercent : null);
    measurements.push(measurement);

    if (gap === null && (base === null || other.priceUsd === null)) {
      // A reference price of zero is already reported once above; repeating it per endpoint would say no more.
      findings.push(gapUnknown(reference, other, measurement));
      continue;
    }
    if (!judged) {
      findings.push(differentSnapshots(reference, other, gap, snapshot, measurement, config));
      continue;
    }
    if (gap !== null && Math.abs(gap) > config.warnAbovePercent) {
      findings.push(gapFinding(reference, other, gap, snapshot, measurement, config));
    }
  }

  return evaluated('C6', { findings, measurements, sources: [reference.source, ...otherSources] });
}
