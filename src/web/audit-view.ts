/**
 * The audit page (specification F8, second page): the report of F9 as a browser shows it.
 *
 * It reads `docs/api_audit.json` — the structured half of what `npm run audit -- --write` produced — and
 * reshapes it, measuring nothing itself. That matters for one reason: the published report went through the
 * second read of T6.2, where every claim of every entry was checked against the recorded answer it cites. A page
 * that recomputed anything would be showing something that read has never seen.
 *
 * The rule of F9 travels with it: an entry that cites no recorded answer is not published. The counts of what
 * was withheld are shown rather than hidden, because how much a report left out is part of reading it.
 */
import { readFileSync } from 'node:fs';
import type { AuditFinding, AuditMeasurement, FindingKind } from '../audit/findings.js';
import { FINDING_KINDS } from '../audit/findings.js';
import { describeMeasurement } from '../audit/report.js';
import type { AuditRun } from '../audit/run.js';
import { CmcError } from '../cmc/errors.js';
import type { EndpointId } from '../cmc/endpoints.js';

/** How each kind reads on the page, and what a reader should take it for. */
export const KIND_LABEL: Record<FindingKind, string> = {
  observed: 'Observed',
  signal: 'Signal',
  suggestion: 'Suggestion',
};

export const KIND_NOTE: Record<FindingKind, string> = {
  observed: 'A measurement of what the recorded answers contain, stated without inference.',
  signal: 'A pattern across several answers that may be worth a look. It states no cause.',
  suggestion: 'Something this project would find useful, offered as a question rather than a defect.',
};

/** One entry of the report, as a page shows it. */
export interface AuditFindingView {
  id: string;
  kind: FindingKind;
  kindLabel: string;
  endpoints: EndpointId[];
  title: string;
  statement: string;
  /** The measurement written out in its unit; `null` when the entry carries none. */
  measurement: string | null;
  /** The recorded answers it cites, each with what that file shows. */
  evidence: { file: string; field: string | null; shows: string }[];
}

/** One figure of the summary table at the top of the page. */
export interface AuditStat {
  label: string;
  value: string;
  /** What the figure means, in one line. */
  note: string;
}

/** The whole page. */
export interface AuditView {
  /** When the report was generated; the answers it reads are dated by their own recordings, not by this. */
  generatedAt: string;
  /** Recorded answers read, endpoints covered, credits spent by the run itself. */
  stats: AuditStat[];
  /** The published entries, in the order the report prints them. */
  findings: AuditFindingView[];
  /** How many entries of each kind were published. */
  counts: Record<FindingKind, number>;
  /** Entries a generator produced that cited no recorded answer, so the report did not print them (F9). */
  withheld: number;
  /** Entries whose cited answer did not show what they stated, so the report did not print them either (T6.2). */
  unproven: number;
  /** What the second read of T6.2 covered, in one sentence. */
  reviewNote: string;
}

function number(value: number): string {
  return value.toLocaleString('en-US');
}

function measurementView(measurement: AuditMeasurement | null): string | null {
  return measurement === null ? null : describeMeasurement(measurement);
}

function findingView(finding: AuditFinding): AuditFindingView {
  return {
    id: finding.id,
    kind: finding.kind,
    kindLabel: KIND_LABEL[finding.kind],
    endpoints: [...finding.endpoints],
    title: finding.title,
    statement: finding.statement,
    measurement: measurementView(finding.measurement),
    evidence: finding.evidence.map((source) => ({ ...source })),
  };
}

/** The summary figures, in the order the page shows them. */
export function auditStats(run: AuditRun): AuditStat[] {
  const { totals } = run;
  return [
    {
      label: 'Recorded answers read',
      value: number(totals.answers),
      note: `${number(totals.accepted)} of them the API accepted.`,
    },
    {
      label: 'Endpoints covered',
      value: number(totals.endpoints),
      note: 'Of the verified inventory in docs/ENDPOINTS.md.',
    },
    {
      label: 'Credits this report spent',
      value: number(totals.creditsSpent),
      note: `It sends no request: it reads recordings that reported ${number(totals.creditsReported)} credits when they were made (D14).`,
    },
    {
      label: 'Claims checked against their evidence',
      value: number(run.review.claims),
      note: `Across ${number(run.review.entries)} published entries, in the second read of T6.2.`,
    },
  ];
}

/** The report, reshaped for the page. Measures nothing: every figure is one the published report already carries. */
export function auditView(run: AuditRun): AuditView {
  const findings = run.findings.map(findingView);
  const counts = Object.fromEntries(
    FINDING_KINDS.map((kind) => [kind, findings.filter((finding) => finding.kind === kind).length]),
  ) as Record<FindingKind, number>;
  return {
    generatedAt: run.finishedAt,
    stats: auditStats(run),
    findings,
    counts,
    withheld: run.withheld,
    unproven: run.unproven,
    reviewNote:
      `Every one of the ${number(run.review.claims)} claims these entries make was read back against the ` +
      `recorded answer it cites: ${number(run.review.unproven.length)} did not hold and ${number(run.review.tone.length)} ` +
      'broke the rule of tone, and those entries are not printed above.',
  };
}

/**
 * The published report, read from disk.
 *
 * A deployment that carries no report is not an error the page should crash on — `npm run audit -- --write` has
 * simply not been run — so the absence comes back as `null` and the page says so.
 */
export function loadAuditView(file: string): AuditView | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new CmcError('config', `${file}: the audit report is not readable JSON (${String(cause)}).`);
  }
  if (typeof parsed !== 'object' || parsed === null || !('findings' in parsed) || !('totals' in parsed)) {
    throw new CmcError(
      'config',
      `${file}: this is not an audit report — it carries no findings and no totals. Regenerate it with ` +
        '`npm run audit -- --write`.',
    );
  }
  return auditView(parsed as AuditRun);
}
