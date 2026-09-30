/**
 * What every check returns (specification F4): identifier, severity, measured value, threshold, a plain-English
 * explanation, and references to the raw answers that prove it.
 *
 * Two rules shape it:
 * - a check that cannot run is never silently dropped: it comes back with the status `not_applicable` or
 *   `unavailable` and the reason why, and the score leaves it out (D9);
 * - every finding carries the answer it was read from, so that no statement of an output stands without the
 *   recorded exchange behind it.
 *
 * Wording is neutral throughout: a finding reports what was observed and against which configured limit, never a
 * judgement on the API.
 */
import type { CmcError } from '../cmc/errors.js';
import type { SourceRef } from '../normalize/model.js';

export const CHECK_IDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] as const;

export type CheckId = (typeof CHECK_IDS)[number];

/** One line per check, in the words the outputs use. */
export const CHECK_TITLES: Record<CheckId, string> = {
  C1: 'Aggregated price against the DEX token price',
  C2: 'Aggregated price against centralised exchange pairs',
  C3: 'Freshness of the timestamps',
  C4: 'Liquidity against reported volume',
  C5: 'RWA wrapper against the average tokenized price',
  C6: 'Consistency between endpoints',
  C7: 'Fields the verdict reads that could not be read',
};

/** The three severities, mildest first. A list rather than a union alone: a reader of a tool answer has to
 * narrow a string back to one of them (`src/demo/answers.ts`). */
export const SEVERITIES = ['info', 'warning', 'critical'] as const;

export type Severity = (typeof SEVERITIES)[number];

/** How severities rank; `info` states a measurement, `critical` says the verdict cannot rest on this source. */
export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

/** The worst of a list of severities, or `null` for an empty list. */
export function worstSeverity(severities: readonly Severity[]): Severity | null {
  return severities.reduce<Severity | null>(
    (worst, severity) => (worst === null || SEVERITY_RANK[severity] > SEVERITY_RANK[worst] ? severity : worst),
    null,
  );
}

/**
 * Whether a check ran (D9).
 * - `evaluated`: it read what it needed and reports what it found;
 * - `not_applicable`: this asset cannot have this check (C1 and C4 without a token contract, C5 outside an RWA);
 * - `unavailable`: the data could not be reached (C2 with this key, a call that failed or timed out).
 */
export const CHECK_STATUSES = ['evaluated', 'not_applicable', 'unavailable'] as const;

export type CheckStatus = (typeof CHECK_STATUSES)[number];

/** The unit a measured value is expressed in, so that outputs never print a bare number. */
export type Unit = 'seconds' | 'percent' | 'usd' | 'count' | 'ratio';

/** The recorded answer a statement rests on, and where inside it the statement sits. */
export interface Evidence {
  source: SourceRef;
  /** Field path inside the response body, for example `data[0].quote[0].price`; `null` for the answer as a whole. */
  field: string | null;
}

export function evidence(source: SourceRef, field: string | null = null): Evidence {
  return { source, field };
}

/** One quantity a check measured, with the configured limit it was read against. */
export interface Measurement {
  /** What was measured, in the words of the outputs, for example `E02 aggregated price of BTC`. */
  label: string;
  /** `null` when the value could not be computed; the finding beside it says why. */
  value: number | null;
  unit: Unit;
  /** The configured limit this value was compared with; `null` when the measurement has no limit. */
  threshold: number | null;
  evidence: Evidence;
}

/** One thing a check observed about one asset. */
export interface Finding {
  /** Stable key of the kind of finding, for example `stale` or `unreadable_field`. */
  code: string;
  severity: Severity;
  /** One neutral sentence in plain English: what was observed, and against which limit. */
  message: string;
  /** The value behind the finding; `null` when the finding is about a value that could not be measured at all. */
  measurement: Measurement | null;
  evidence: Evidence[];
}

/** What a check hands to the score (T3.6), to the MCP tools and to the audit. */
export interface CheckResult {
  id: CheckId;
  title: string;
  status: CheckStatus;
  /** Worst severity found; `info` when the check ran and found nothing, `null` when it did not run. */
  severity: Severity | null;
  /** Why the check did not run; `null` when it did. */
  reason: string | null;
  /** Worst first. */
  findings: Finding[];
  /** Everything measured, including the values that raised no finding. */
  measurements: Measurement[];
  /** Every answer read, once each. */
  sources: SourceRef[];
}

function sourceKey(source: SourceRef): string {
  return `${source.endpoint}|${source.observedAt}|${source.fixture?.file ?? ''}`;
}

/** The answers of a list of measurements and findings, each one once, in the order they were first read. */
export function distinctSources(sources: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = sourceKey(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A check that ran. Findings come back worst first; the severity is the worst of them, `info` when there is none. */
export function evaluated(
  id: CheckId,
  parts: { findings: readonly Finding[]; measurements: readonly Measurement[]; sources: readonly SourceRef[] },
): CheckResult {
  const findings = [...parts.findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return {
    id,
    title: CHECK_TITLES[id],
    status: 'evaluated',
    severity: worstSeverity(findings.map((finding) => finding.severity)) ?? 'info',
    reason: null,
    findings,
    measurements: [...parts.measurements],
    sources: distinctSources(parts.sources),
  };
}

function skipped(id: CheckId, status: CheckStatus, reason: string, sources: readonly SourceRef[]): CheckResult {
  return {
    id,
    title: CHECK_TITLES[id],
    status,
    severity: null,
    reason,
    findings: [],
    measurements: [],
    sources: distinctSources(sources),
  };
}

/** A check this asset cannot have: the reason is shown in every output and the score ignores it (D9). */
export function notApplicable(id: CheckId, reason: string, sources: readonly SourceRef[] = []): CheckResult {
  return skipped(id, 'not_applicable', reason, sources);
}

/** A check whose data could not be reached. */
export function unavailable(id: CheckId, reason: string, sources: readonly SourceRef[] = []): CheckResult {
  return skipped(id, 'unavailable', reason, sources);
}

/** A check whose call failed: the client error becomes the reason, as it carries no API key (D9). */
export function unavailableFromError(id: CheckId, error: CmcError): CheckResult {
  return unavailable(id, `${error.kind}: ${error.message}`);
}
