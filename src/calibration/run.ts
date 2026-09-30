/**
 * Runs the whole engine over the calibration panel and counts what came out (specification F5, T4.1).
 *
 * The specification asks for one number — at least 90 % of the first fifty assets by capitalisation must reach
 * `ACT` — but a bare share says nothing about what to change when it is missed. So the run keeps, beside the
 * verdicts, what produced them: which checks ran on how many assets, which findings they raised and how often, and
 * which calls brought nothing back. Those counts are what T4.2 moves the thresholds against.
 *
 * Three rules shape it:
 * - **every asset goes through the same plan a user gets** (`assessAsset`, D1), by CMC ID, which skips the E01
 *   resolution a `check` on a symbol would make. Nothing about the panel path is special-cased, or the calibration
 *   would measure something other than the product;
 * - **assets are assessed one after another.** Each one already sends its own calls in parallel (D1); running
 *   assets in parallel too would make the per-asset credit and wall-clock figures unattributable, and the panel
 *   still finishes inside the per-minute request limit of the key;
 * - **a failure is an outcome, not an interruption.** An asset whose calls failed is recorded with the verdict it
 *   got and the reasons its checks gave, exactly as a user would see it. Only a panel that could not be read at all
 *   stops the run.
 */
import { assessAsset, type AssetAssessment } from '../checks/assess.js';
import { loadChecksConfig, type ChecksConfig } from '../checks/config.js';
import { CHECK_IDS, type CheckId, type CheckStatus, type Severity } from '../checks/model.js';
import type { CmcClient } from '../cmc/client.js';
import type { EndpointId } from '../cmc/endpoints.js';
import { CmcError } from '../cmc/errors.js';
import type { KeyInfo } from '../cmc/key-info.js';
import type { SourceRef } from '../normalize/model.js';
import { DEFAULT_INDEX_FILE, loadWrapperIndex, type WrapperIndex } from '../rwa/wrapper-index.js';
import { VERDICTS, type Verdict } from '../score/verdict.js';
import { describeMember, readPanel, type CalibrationPanel, type PanelMember } from './panel.js';

/** The share of the panel that must reach `ACT` for the calibration to hold (specification F5). */
export const TARGET_ACT_SHARE = 90;

/** The time one assessment is meant to fit in (D1); outcomes past it are counted, never dropped. */
export const VERDICT_BUDGET_MS = 10_000;

/** One check of one asset, as the counting reads it. */
export interface CheckOutcome {
  id: CheckId;
  status: CheckStatus;
  /** Worst severity it raised; `null` when it did not run. */
  severity: Severity | null;
  /** Codes of the findings it raised, worst first; empty when it raised none. */
  codes: string[];
  /** Why it did not run; `null` when it did. */
  reason: string | null;
}

/** One asset of the panel, end to end. */
export interface AssetOutcome {
  member: PanelMember;
  score: number | null;
  verdict: Verdict;
  severity: Severity | null;
  /** Checks that ran, out of `CHECK_IDS.length`. */
  evaluated: number;
  checks: CheckOutcome[];
  /** Whether E05 gave a token contract, which is what opens the DEX calls (D3). */
  hasContract: boolean;
  /** The real-world asset the index linked this token to; `null` when it linked none (D6). */
  wrapsRwaId: number | null;
  failures: { endpoint: EndpointId; kind: string; message: string }[];
  /** Credits the answers of this asset reported, and those of attempts that came back without one. */
  credits: number;
  creditsUnconfirmed: number;
  requests: number;
  elapsedMs: number;
  /** Every answer this asset was assessed on: the evidence behind its line in the report. */
  sources: SourceRef[];
}

/** How one check behaved across the panel. */
export interface CheckStats {
  id: CheckId;
  evaluated: number;
  notApplicable: number;
  unavailable: number;
  /** Among the assets where it ran. */
  bySeverity: Record<Severity, number>;
  /** The distinct reasons it gave when it did not run, most frequent first. */
  reasons: { status: CheckStatus; reason: string; assets: number }[];
}

/** How often one kind of finding was raised, and on which assets. */
export interface FindingStats {
  checkId: CheckId;
  code: string;
  severity: Severity;
  assets: number;
  /** The panel members that raised it, in rank order. */
  members: string[];
}

/** The spread of the scores, over the assets that got one. */
export interface ScoreStats {
  min: number | null;
  median: number | null;
  max: number | null;
  mean: number | null;
  /** Assets where no check could be evaluated, so there is no score at all (D11). */
  unscored: number;
}

/** What the panel produced, in the numbers T4.2 reads. */
export interface CalibrationSummary {
  assets: number;
  verdicts: Record<Verdict, number>;
  /** Share of the panel at `ACT`, in percent, to one decimal. */
  actShare: number;
  targetShare: number;
  meetsTarget: boolean;
  score: ScoreStats;
  /** Checks evaluated per asset: the spread, and how many assets sat at each count. */
  coverage: { min: number; max: number; median: number; byCount: { evaluated: number; assets: number }[] };
  checks: CheckStats[];
  /** Every finding raised on the panel, worst and most frequent first. */
  findings: FindingStats[];
  /** The distinct calls that brought nothing back, most frequent first. */
  failures: { endpoint: EndpointId; kind: string; message: string; assets: number }[];
  credits: { charged: number; unconfirmed: number; requests: number; byEndpoint: Record<string, number> };
  elapsed: { totalMs: number; medianMs: number; slowestMs: number; pastBudget: number };
}

/** The numbers that were in effect when the panel was measured: the "before" state T4.2 changes. */
export interface ThresholdSnapshot {
  score: ChecksConfig['score'];
  C1: ChecksConfig['C1'];
  C3: ChecksConfig['C3'];
  C4: ChecksConfig['C4'];
  C6: ChecksConfig['C6'];
}

/** One whole calibration run: the panel, every asset, the counts, and the configuration that produced them. */
export interface CalibrationRun {
  /** `status.timestamp` of the E03 answer the panel was read from, never the local clock (D4). */
  panelObservedAt: string;
  /** Wall clock of the run, epoch milliseconds, for the duration only. */
  startedAt: string;
  finishedAt: string;
  panel: CalibrationPanel;
  outcomes: AssetOutcome[];
  summary: CalibrationSummary;
  thresholds: ThresholdSnapshot;
  /** The token to real-world-asset index C5 was read with; `null` when the run had none (D6). */
  index: { builtAt: string; entries: number } | null;
  /** Account-wide usage read from E20 (0 credit) before and after the run; `null` when it was not read. */
  keyBefore: KeyInfo | null;
  keyAfter: KeyInfo | null;
  /**
   * Requests per minute the caller paced this run at, as it stated; `null` when nothing paced it, which is the case
   * of a replay. Recorded because the per-asset times below include the waiting it caused.
   */
  pacedPerMinute: number | null;
}

export interface CalibrationOptions {
  /** Assets to read from E03; the specification's 50 by default. */
  size?: number;
  config?: ChecksConfig;
  /**
   * The cached token to real-world-asset index (D6). Read from `indexFile` when left out; pass `null` for a run
   * that has none, which reports C5 as unavailable on every asset rather than guessing at the link.
   */
  wrapperIndex?: WrapperIndex | null;
  indexFile?: string;
  /** Called after each asset, so a command can show progress on a run that takes minutes. */
  onAsset?: (outcome: AssetOutcome, done: number, total: number) => void;
  /** Whether to read E20 before and after the run (0 credit): what settles the account-wide cost. */
  readKeyInfo?: boolean;
  /** Requests per minute the caller is pacing the network at, recorded as stated; `null` when nothing paces it. */
  pacedPerMinute?: number | null;
  /** Wall clock, epoch milliseconds. */
  now?: () => number;
}

/** One decimal, the precision every number in the report is printed at. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The middle value of a list, the mean of the two middle ones for an even count; `null` for an empty list. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const low = sorted[middle - 1];
  const high = sorted[middle];
  if (high === undefined) return null;
  return sorted.length % 2 === 1 || low === undefined ? high : (low + high) / 2;
}

/** The seven checks of one assessment, condensed to what the counting reads. */
function outcomeChecks(assessment: AssetAssessment): CheckOutcome[] {
  return assessment.checks.map((result) => ({
    id: result.id,
    status: result.status,
    severity: result.severity,
    codes: result.findings.map((finding) => finding.code),
    reason: result.reason,
  }));
}

/** What the counting keeps of one asset. */
function outcomeOf(
  member: PanelMember,
  assessment: AssetAssessment,
  spent: { credits: number; creditsUnconfirmed: number; requests: number },
): AssetOutcome {
  return {
    member,
    score: assessment.score.score,
    verdict: assessment.score.verdict,
    severity: assessment.score.severity,
    evaluated: assessment.score.coverage.evaluated,
    checks: outcomeChecks(assessment),
    hasContract: assessment.contract !== null,
    wrapsRwaId: assessment.wrapper?.rwaId ?? null,
    failures: assessment.failures,
    ...spent,
    elapsedMs: assessment.elapsedMs,
    sources: assessment.sources,
  };
}

/** How each check behaved across the panel, in the order of `CHECK_IDS`. */
function checkStats(outcomes: readonly AssetOutcome[]): CheckStats[] {
  return CHECK_IDS.map((id) => {
    const stats: CheckStats = {
      id,
      evaluated: 0,
      notApplicable: 0,
      unavailable: 0,
      bySeverity: { info: 0, warning: 0, critical: 0 },
      reasons: [],
    };
    const reasons = new Map<string, { status: CheckStatus; reason: string; assets: number }>();
    for (const outcome of outcomes) {
      const check = outcome.checks.find((one) => one.id === id);
      if (check === undefined) continue;
      if (check.status === 'evaluated') {
        stats.evaluated += 1;
        stats.bySeverity[check.severity ?? 'info'] += 1;
        continue;
      }
      if (check.status === 'not_applicable') stats.notApplicable += 1;
      else stats.unavailable += 1;
      const reason = check.reason ?? 'No reason was given.';
      const key = `${check.status}|${reason}`;
      const seen = reasons.get(key);
      if (seen) seen.assets += 1;
      else reasons.set(key, { status: check.status, reason, assets: 1 });
    }
    stats.reasons = [...reasons.values()].sort((a, b) => b.assets - a.assets);
    return stats;
  });
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Every finding raised on the panel, worst first, then most frequent, then by check. */
function findingStats(outcomes: readonly AssetOutcome[]): FindingStats[] {
  const found = new Map<string, FindingStats>();
  for (const outcome of outcomes) {
    for (const check of outcome.checks) {
      // A check's severity is the worst of its findings; each code is attributed that same severity only when it is
      // the one that produced it, so codes are counted per asset without claiming a severity they did not carry.
      for (const code of new Set(check.codes)) {
        const key = `${check.id}|${code}`;
        const stats = found.get(key) ?? {
          checkId: check.id,
          code,
          severity: check.severity ?? 'info',
          assets: 0,
          members: [],
        };
        stats.assets += 1;
        stats.members.push(describeMember(outcome.member));
        if (SEVERITY_ORDER[check.severity ?? 'info'] < SEVERITY_ORDER[stats.severity]) {
          stats.severity = check.severity ?? 'info';
        }
        found.set(key, stats);
      }
    }
  }
  return [...found.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.assets - a.assets ||
      (a.checkId < b.checkId ? -1 : a.checkId > b.checkId ? 1 : 0),
  );
}

/** The distinct calls that brought nothing back, most frequent first. */
function failureStats(outcomes: readonly AssetOutcome[]): CalibrationSummary['failures'] {
  const found = new Map<string, CalibrationSummary['failures'][number]>();
  for (const outcome of outcomes) {
    for (const failure of outcome.failures) {
      const key = `${failure.endpoint}|${failure.kind}|${failure.message}`;
      const seen = found.get(key);
      if (seen) seen.assets += 1;
      else found.set(key, { ...failure, assets: 1 });
    }
  }
  return [...found.values()].sort((a, b) => b.assets - a.assets);
}

/** Counts one panel of outcomes into the numbers the report prints. */
export function summarize(outcomes: readonly AssetOutcome[], credits: CalibrationSummary['credits']): CalibrationSummary {
  const verdicts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0])) as Record<Verdict, number>;
  for (const outcome of outcomes) verdicts[outcome.verdict] += 1;

  const scores = outcomes.flatMap((outcome) => (outcome.score === null ? [] : [outcome.score]));
  const coverage = outcomes.map((outcome) => outcome.evaluated);
  const times = outcomes.map((outcome) => outcome.elapsedMs);
  const byCount = [...new Set(coverage)]
    .sort((a, b) => b - a)
    .map((evaluated) => ({ evaluated, assets: coverage.filter((count) => count === evaluated).length }));
  const actShare = outcomes.length === 0 ? 0 : round((verdicts.ACT / outcomes.length) * 100);

  return {
    assets: outcomes.length,
    verdicts,
    actShare,
    targetShare: TARGET_ACT_SHARE,
    meetsTarget: outcomes.length > 0 && actShare >= TARGET_ACT_SHARE,
    score: {
      min: scores.length === 0 ? null : round(Math.min(...scores)),
      median: scores.length === 0 ? null : round(median(scores) ?? 0),
      max: scores.length === 0 ? null : round(Math.max(...scores)),
      mean: scores.length === 0 ? null : round(scores.reduce((sum, one) => sum + one, 0) / scores.length),
      unscored: outcomes.length - scores.length,
    },
    coverage: {
      min: coverage.length === 0 ? 0 : Math.min(...coverage),
      max: coverage.length === 0 ? 0 : Math.max(...coverage),
      median: median(coverage) ?? 0,
      byCount,
    },
    checks: checkStats(outcomes),
    findings: findingStats(outcomes),
    failures: failureStats(outcomes),
    credits,
    elapsed: {
      totalMs: times.reduce((sum, one) => sum + one, 0),
      medianMs: Math.round(median(times) ?? 0),
      slowestMs: times.length === 0 ? 0 : Math.max(...times),
      pastBudget: times.filter((one) => one > VERDICT_BUDGET_MS).length,
    },
  };
}

/** E20 when the caller asked for it, `null` otherwise; a refused reading never stops a run that costs credits. */
async function keyInfo(client: CmcClient, wanted: boolean): Promise<KeyInfo | null> {
  if (!wanted) return null;
  try {
    return await client.keyInfo();
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    return null;
  }
}

/**
 * Reads the panel, assesses every asset on it, and counts the result.
 *
 * `client` should be one this run has to itself: the credit and request figures are read from its meter, which is
 * what makes them measurements rather than estimates.
 */
export async function runCalibration(client: CmcClient, options: CalibrationOptions = {}): Promise<CalibrationRun> {
  const config = options.config ?? loadChecksConfig();
  const now = options.now ?? Date.now;
  const startedAt = new Date(now()).toISOString();

  const index =
    options.wrapperIndex !== undefined ? options.wrapperIndex : loadWrapperIndex(options.indexFile ?? DEFAULT_INDEX_FILE);
  const keyBefore = await keyInfo(client, options.readKeyInfo ?? false);
  const panel = await readPanel(client, options.size);

  const outcomes: AssetOutcome[] = [];
  let spent = client.credits();
  for (const member of panel.members) {
    const assessment = await assessAsset(client, { kind: 'cmcId', cmcId: member.cmcId }, {
      config,
      wrapperIndex: index,
      now,
    });
    const after = client.credits();
    const outcome = outcomeOf(member, assessment, {
      credits: after.charged - spent.charged,
      creditsUnconfirmed: after.unconfirmed - spent.unconfirmed,
      requests: after.requests - spent.requests,
    });
    spent = after;
    outcomes.push(outcome);
    options.onAsset?.(outcome, outcomes.length, panel.members.length);
  }

  const total = client.credits();
  const keyAfter = await keyInfo(client, options.readKeyInfo ?? false);
  return {
    panelObservedAt: panel.source.observedAt,
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    panel,
    outcomes,
    summary: summarize(outcomes, {
      charged: total.charged,
      unconfirmed: total.unconfirmed,
      requests: total.requests,
      byEndpoint: total.byEndpoint,
    }),
    thresholds: { score: config.score, C1: config.C1, C3: config.C3, C4: config.C4, C6: config.C6 },
    index: index === null ? null : { builtAt: index.builtAt, entries: index.entries.length },
    keyBefore,
    keyAfter,
    pacedPerMinute: options.pacedPerMinute ?? null,
  };
}
