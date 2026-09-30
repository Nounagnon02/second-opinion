/**
 * What a page renders (specification F8): one assessment, turned into the words and the shape a browser shows.
 *
 * It sits in this package rather than in the Next.js application for one reason — everything decided here is
 * testable without a browser, a bundler or a React renderer, and it is decided here so that the components in
 * `web/app` hold markup and nothing else. What a reader sees is settled by code the offline suite runs.
 *
 * Three rules it keeps, the same three every other output of this project keeps:
 * - **no bare number.** Every measured value is printed through the unit it was measured in;
 * - **a check that did not run is shown, with its reason** (D9). The page never quietly lists five checks;
 * - **every statement carries the answer it came from.** The evidence list is part of the view, not a footnote.
 */
import type { EndpointId } from '../cmc/endpoints.js';
import type { CreditUsage } from '../cmc/credits.js';
import type { ChecksConfig } from '../checks/config.js';
import type { CheckId, CheckStatus, Severity, Unit } from '../checks/model.js';
import { formatValue } from '../checks/units.js';
import { describeThreshold, explainCheck } from '../mcp/explain.js';
import type { AssetAnswer, CheckDigest } from '../mcp/tools.js';
import { formatScore } from '../score/score.js';
import { VERDICT_LABEL, type Verdict } from '../score/verdict.js';

/**
 * The four states a page colours. `verdict` and `severity` both map onto them, so that the badge at the top and
 * the dot beside a check are read the same way. `idle` is the check that did not run: it is neither good news
 * nor bad, and colouring it green would say the opposite of what D9 asks the page to say.
 */
export const TONES = ['good', 'caution', 'stop', 'idle'] as const;

export type Tone = (typeof TONES)[number];

export const VERDICT_TONE: Record<Verdict, Tone> = { ACT: 'good', CAUTION: 'caution', DO_NOT_ACT: 'stop' };

export const SEVERITY_TONE: Record<Severity, Tone> = { info: 'good', warning: 'caution', critical: 'stop' };

/** How each status reads on the page, for the checks that did not run. */
export const STATUS_LABEL: Record<CheckStatus, string> = {
  evaluated: 'evaluated',
  not_applicable: 'not applicable to this asset',
  unavailable: 'data not reachable',
};

/** One measurement, already written in its unit. */
export interface MeasurementView {
  label: string;
  value: string;
  /** The configured limit it was read against, in the same unit; `null` when it has none. */
  threshold: string | null;
}

/** One observation a check raised. */
export interface FindingView {
  code: string;
  severity: Severity;
  tone: Tone;
  message: string;
}

/** One check, as a page shows it. */
export interface CheckView {
  id: CheckId;
  title: string;
  status: CheckStatus;
  statusLabel: string;
  severity: Severity | null;
  tone: Tone;
  /** Why it did not run; `null` when it did (D9). */
  reason: string | null;
  /** Points out of 100 it scored; `null` when it did not run. */
  points: number | null;
  sharePercent: number;
  /** Whether it counted towards the score at all. */
  scored: boolean;
  /** Plain English, from `explain`: what it measures, and why that matters before acting. */
  what: string;
  why: string;
  endpoints: EndpointId[];
  /** The configured limits it reads, already written out; empty when it reads none. */
  thresholds: string[];
  /** Why the check may not run at all, when that is known in advance; `null` otherwise. */
  caveat: string | null;
  findings: FindingView[];
  measurements: MeasurementView[];
}

/** One recorded or live answer a statement rests on. */
export interface EvidenceView {
  endpoint: EndpointId;
  path: string;
  observedAt: string;
  /** The recorded answer, when it was replayed; `null` for a live call. */
  fixture: string | null;
  /** `E02 /v3/cryptocurrency/quotes/latest`, the way the page labels a row. */
  label: string;
  /** `recorded` or `live`, the way the page tags it. */
  origin: 'recorded' | 'live';
}

/** One whole page. */
export interface AssetView {
  /** The asset as the visitor typed it. */
  asked: string;
  /** The asset as the answers named it, or the query when none did. */
  title: string;
  verdict: Verdict;
  /** `act on this data`, spelt out beside the word. */
  verdictLabel: string;
  tone: Tone;
  score: number | null;
  /** `94.2`, or the sentence that stands in for a score there is none of (D11). */
  scoreLabel: string;
  /** One neutral sentence: the verdict, the score, the coverage and the worst observation. */
  summary: string;
  coverage: string;
  /** The seven checks, in the order of `CHECK_IDS`. */
  checks: CheckView[];
  /** The checks that raised something, worst first: what a visitor reads before anything else. */
  raised: CheckView[];
  /** The checks that did not run, with their reasons (D9). */
  notRun: CheckView[];
  /** The calls that brought nothing back. Never carries the API key. */
  failures: { endpoint: EndpointId; kind: string; message: string }[];
  evidence: EvidenceView[];
  /** How many of the answers were replayed from a recording, for the line under the evidence table. */
  recordedCount: number;
  credits: CreditUsage;
  elapsedMs: number;
  /** What this answer does not cover, in plain English. */
  caveats: string[];
}

/** The asset in the words of the answers: `PAXG — PAX Gold — CMC 4705`. */
export function viewTitle(answer: AssetAnswer): string {
  if (answer.resolved === null) return answer.asked;
  const id = answer.resolved.cmcId === null ? null : `CMC ${String(answer.resolved.cmcId)}`;
  const parts = [answer.resolved.symbol, answer.resolved.name, id].filter(
    (part): part is string => part !== null && part !== '',
  );
  return parts.length === 0 ? answer.asked : parts.join(' — ');
}

/** The tone of a check: its severity when it ran, `idle` when it did not. */
export function checkTone(check: Pick<CheckDigest, 'status' | 'severity'>): Tone {
  if (check.status !== 'evaluated' || check.severity === null) return 'idle';
  return SEVERITY_TONE[check.severity];
}

function measurementView(measurement: {
  label: string;
  value: number | null;
  unit: Unit;
  threshold: number | null;
}): MeasurementView {
  return {
    label: measurement.label,
    value: formatValue(measurement.value, measurement.unit),
    threshold: measurement.threshold === null ? null : formatValue(measurement.threshold, measurement.unit),
  };
}

/** One check, joined to the plain-English account of what it measures and the limits it reads. */
export function checkView(check: CheckDigest, config: ChecksConfig): CheckView {
  const explanation = explainCheck(check.id, config);
  return {
    id: check.id,
    title: check.title,
    status: check.status,
    statusLabel: STATUS_LABEL[check.status],
    severity: check.severity,
    tone: checkTone(check),
    reason: check.reason,
    points: check.points,
    sharePercent: check.sharePercent,
    scored: check.points !== null,
    what: explanation.what,
    why: explanation.why,
    endpoints: [...explanation.endpoints],
    thresholds: explanation.thresholds.map(describeThreshold),
    caveat: explanation.caveat,
    findings: check.findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      tone: SEVERITY_TONE[finding.severity],
      message: finding.message,
    })),
    measurements: (check.measurements ?? []).map(measurementView),
  };
}

/** The whole page, from the answer the MCP tools would have handed an agent. */
export function assetView(answer: AssetAnswer, config: ChecksConfig): AssetView {
  const checks = answer.checks.map((check) => checkView(check, config));
  const evidence = answer.evidence.map(
    (source): EvidenceView => ({
      endpoint: source.endpoint,
      path: source.path,
      observedAt: source.observedAt,
      fixture: source.fixture,
      label: `${source.endpoint} ${source.path}`,
      origin: source.fixture === null ? 'live' : 'recorded',
    }),
  );
  return {
    asked: answer.asked,
    title: viewTitle(answer),
    verdict: answer.verdict,
    verdictLabel: VERDICT_LABEL[answer.verdict],
    tone: VERDICT_TONE[answer.verdict],
    score: answer.score,
    scoreLabel:
      answer.score === null ? 'no score — no check could be evaluated' : `${formatScore(answer.score)} / 100`,
    summary: answer.summary,
    coverage: answer.coverage.label,
    checks,
    raised: checks.filter((check) => check.findings.length > 0),
    notRun: checks.filter((check) => !check.scored),
    failures: answer.failures.map((failure) => ({ ...failure })),
    evidence,
    recordedCount: evidence.filter((source) => source.origin === 'recorded').length,
    credits: answer.credits,
    elapsedMs: answer.elapsedMs,
    caveats: [...answer.caveats],
  };
}
