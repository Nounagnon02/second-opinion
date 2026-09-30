/**
 * The reliability score and the verdict (specification F5): the seven checks weighed into one number out of 100,
 * and the three words an agent or a trader acts on — `ACT`, `CAUTION`, `DO_NOT_ACT`.
 *
 * Three rules shape it, all of them written down in `docs/DECISIONS.md`:
 * - only the checks that ran are scored, their weights renormalised over themselves, so that a check this asset
 *   cannot have never costs it a point (D9). What the run could not measure is reported as coverage — "5 of 7
 *   checks evaluated" — beside the score, never folded into it;
 * - a check scores on its worst finding alone. Severity is already defined as the worst of the findings
 *   (`src/checks/model.ts`), and nothing recorded so far says what a second warning on the same check should cost;
 * - when no check at all could be evaluated, there is no score, and the verdict is `DO_NOT_ACT` (D11). That is not
 *   the low-coverage cap D9 leaves to T4.2: it is the difference between a thin verdict and no measurement to rest
 *   one on.
 *
 * One rule is not a weighting at all: a `critical` finding is defined as one the verdict cannot rest on that source
 * for (`src/checks/model.ts`), so it holds the verdict at or below the configured `capWithCritical`, whatever the
 * weighted mean says. A weighted mean alone can leave a run at `ACT` on the strength of the checks that found
 * nothing while one of them reports it could not read a price at all (D11).
 *
 * Weights, the points a severity scores and the two verdict boundaries all live in `config/checks.json`, so that
 * T4.2 calibrates them without touching this file.
 */
import type { ScoreConfig } from '../checks/config.js';
import {
  CHECK_IDS,
  worstSeverity,
  type CheckId,
  type CheckResult,
  type CheckStatus,
  type Severity,
} from '../checks/model.js';
import { CmcError } from '../cmc/errors.js';
import { worstVerdict, type Verdict } from './verdict.js';

/** One check, seen from the score. */
export interface ScoredCheck {
  id: CheckId;
  title: string;
  status: CheckStatus;
  /** Worst severity the check raised; `null` when it did not run. */
  severity: Severity | null;
  /** Why it did not run; `null` when it did. */
  reason: string | null;
  /** Its configured weight, before renormalisation. */
  weight: number;
  /** Points out of 100 it scored; `null` when it did not run and therefore weighed nothing. */
  points: number | null;
  /** The share of the score it actually carried, in percent, after renormalisation; 0 when it did not run. */
  share: number;
}

/** How much of the engine ran, shown beside every score (D9). */
export interface Coverage {
  evaluated: number;
  total: number;
  /** In the words the outputs use, for example `5 of 7 checks evaluated`. */
  label: string;
}

/** What the score hands to the CLI, to the MCP tools and to the web page. */
export interface AssetScore {
  /** 0 to 100, rounded to one decimal; `null` when no check could be evaluated. */
  score: number | null;
  verdict: Verdict;
  /** Worst severity across the checks that ran; `null` when none did. */
  severity: Severity | null;
  coverage: Coverage;
  /** The seven checks, in the order of `CHECK_IDS`. */
  checks: ScoredCheck[];
  /** The checks carrying the worst severity, in the order of `CHECK_IDS`; empty when nothing was raised. */
  worstChecks: CheckId[];
  /** One neutral sentence: the verdict, the score, the coverage and what the worst observation was. */
  summary: string;
}

/** One decimal, which is what the outputs print, so that the number judged is the number shown. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** A score as a report writes it: `100`, `86.4`, never `86.40`. */
export function formatScore(value: number): string {
  return String(round(value));
}

/**
 * The seven results, each exactly once. A missing result is refused rather than scored around: a check that cannot
 * run comes back as `not_applicable` or `unavailable` with its reason (D9), and one silently absent would shift
 * every renormalised weight without any output saying so.
 */
function byCheckId(results: readonly CheckResult[]): Record<CheckId, CheckResult> {
  const found = new Map<CheckId, CheckResult>();
  for (const result of results) {
    if (found.has(result.id)) {
      throw new CmcError('config', `the score was given ${result.id} twice; each check is scored once.`);
    }
    found.set(result.id, result);
  }
  const missing = CHECK_IDS.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new CmcError(
      'config',
      `the score was given no result for ${missing.join(', ')}; a check that cannot run is reported as ` +
        'not_applicable or unavailable, never left out (D9).',
    );
  }
  return Object.fromEntries(found) as Record<CheckId, CheckResult>;
}

/**
 * Where a score falls between the two configured boundaries, then held back to `capWithCritical` when a check
 * raised a critical finding. A run with no score at all is `DO_NOT_ACT` (D11).
 */
export function verdictOf(score: number | null, severity: Severity | null, config: ScoreConfig): Verdict {
  const fromScore = ((): Verdict => {
    if (score === null) return 'DO_NOT_ACT';
    if (score >= config.actAtOrAbove) return 'ACT';
    if (score >= config.cautionAtOrAbove) return 'CAUTION';
    return 'DO_NOT_ACT';
  })();
  if (severity !== 'critical' || config.capWithCritical === null) return fromScore;
  return worstVerdict(fromScore, config.capWithCritical);
}

/** `3 of 7 checks evaluated`, the phrase D9 asks every output to carry. */
export function coverageOf(evaluated: number, total: number): Coverage {
  return { evaluated, total, label: `${String(evaluated)} of ${String(total)} checks evaluated` };
}

/** The checks that did not run, with the reason each one gave, for the outputs that list them under the score. */
export function checksThatDidNotRun(score: AssetScore): ScoredCheck[] {
  return score.checks.filter((check) => check.points === null);
}

/** `C1 and C3`, `C1, C3 and C4`, the way a sentence lists them. */
function listIds(ids: readonly CheckId[]): string {
  if (ids.length <= 1) return ids.join('');
  return `${ids.slice(0, -1).join(', ')} and ${String(ids[ids.length - 1])}`;
}

/**
 * The one sentence the outputs lead with. It says what was found and how much of the engine found it, and names no
 * cause beyond the measurement: a warning is an observation about this reading, not a judgement on the source.
 */
function summarize(
  verdict: Verdict,
  score: number | null,
  coverage: Coverage,
  severity: Severity | null,
  worstChecks: readonly CheckId[],
): string {
  if (score === null) {
    return (
      `${verdict}: no check could be evaluated for this asset (${coverage.label}), so there is nothing measured ` +
      'to rest a verdict on. The reason each check gives is listed below.'
    );
  }
  const head = `${verdict}: ${formatScore(score)} out of 100, ${coverage.label}`;
  if (severity === null || severity === 'info') return `${head}, and none of them raised an observation.`;
  return `${head}, worst observation a ${severity} from ${listIds(worstChecks)}.`;
}

/**
 * Weighs the seven checks into a score and a verdict.
 *
 * Throws a `config` error when the results are not exactly the seven checks, once each.
 */
export function scoreChecks(results: readonly CheckResult[], config: ScoreConfig): AssetScore {
  const byId = byCheckId(results);

  const scored = CHECK_IDS.map((id) => {
    const result = byId[id];
    // `evaluated()` never leaves the severity null; a check that ran and found nothing is `info`, not silence.
    const severity = result.status === 'evaluated' ? (result.severity ?? 'info') : null;
    return {
      id,
      title: result.title,
      status: result.status,
      severity,
      reason: result.reason,
      weight: config.weights[id],
      points: severity === null ? null : config.severityPoints[severity],
      share: 0,
    } satisfies ScoredCheck;
  });

  const ran = scored.filter((check) => check.points !== null);
  const weight = ran.reduce((total, check) => total + check.weight, 0);
  for (const check of ran) check.share = round((check.weight / weight) * 100);

  const total = ran.reduce((sum, check) => sum + check.weight * (check.points ?? 0), 0);
  const score = ran.length === 0 ? null : round(total / weight);
  const severity = worstSeverity(ran.map((check) => check.severity ?? 'info'));
  const worstChecks =
    severity === null || severity === 'info'
      ? []
      : ran.filter((check) => check.severity === severity).map((check) => check.id);
  const coverage = coverageOf(ran.length, CHECK_IDS.length);
  // The verdict reads the rounded score, so that the number judged is the number every output prints.
  const verdict = verdictOf(score, severity, config);

  return {
    score,
    verdict,
    severity,
    coverage,
    checks: scored,
    worstChecks,
    summary: summarize(verdict, score, coverage, severity, worstChecks),
  };
}
