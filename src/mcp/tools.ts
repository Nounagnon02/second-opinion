/**
 * The four tools of the MCP server (specification F6), as functions rather than as protocol handlers:
 * `check_asset`, `check_rwa_token`, `preflight_trade` and `explain`. `server.ts` registers them; this file is what
 * they do, so that every one of them is tested without a transport and without a network.
 *
 * Four rules shape them:
 * - **one run, one answer.** The three asset tools all come from a single `assessAsset` of D1 — the same call plan
 *   the `check` command runs — so an agent and a reviewer never read two different numbers for one asset. Nothing
 *   is measured here that a check does not already measure;
 * - **an answer carries its evidence.** Every result names the endpoints it was read from, and the fixture behind
 *   each one when the run was replayed, because an agent that reports `DO_NOT_ACT` to a user has to be able to say
 *   what it read;
 * - **a failure is an answer, not an exception.** A missing key, a fixture directory that is not there, an asset no
 *   endpoint knows: each comes back as a tool result marked as an error, with the reason. A thrown exception would
 *   reach the agent as a broken tool rather than as a finding about the data;
 * - **what was not measured is said.** A check that did not run keeps its reason (D9), a coverage line travels with
 *   every score, and `preflight_trade` states plainly which part of the order it did and did not weigh.
 */
import {
  assessAsset,
  describeSubject,
  parseSubject,
  type AssessOptions,
  type AssetAssessment,
} from '../checks/assess.js';
import { loadChecksConfig, type ChecksConfig } from '../checks/config.js';
import type { CheckId, CheckResult, CheckStatus, Measurement, Severity, Unit } from '../checks/model.js';
import type { CmcClient } from '../cmc/client.js';
import type { CreditUsage } from '../cmc/credits.js';
import type { EndpointId } from '../cmc/endpoints.js';
import { CmcError } from '../cmc/errors.js';
import type { SourceRef } from '../normalize/model.js';
import type { Verdict } from '../score/verdict.js';
import { describeExplanation, explainCheck, parseCheckId, type CheckExplanation } from './explain.js';

/** The four tools the specification names (F6). */
export const TOOL_NAMES = ['check_asset', 'check_rwa_token', 'preflight_trade', 'explain'] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Which side of the book an order sits on. Recorded and echoed; `ORDER_SIDE_NOTE` says what it does not change. */
export const ORDER_SIDES = ['buy', 'sell'] as const;

export type OrderSide = (typeof ORDER_SIDES)[number];

/**
 * What `preflight_trade` says about the side it was given, every time. The depth read is one total per venue — `l`
 * in E10, `liqUsd` in E11 — and no answer recorded so far splits it into bid and ask, so the share an order takes
 * of a pool is the same number whichever way it runs. Stating that beats implying a directional reading the data
 * does not support.
 */
export const ORDER_SIDE_NOTE =
  'The side is recorded and echoed back, and it changes no measurement: the depth read is one total per venue ' +
  '(E10 `l`, E11 `liqUsd`), and no recorded answer splits it into bid and ask depth, so the share of a pool an ' +
  'order would take is the same for a buy and for a sell of the same size.';

/**
 * What `preflight_trade` says about the two limits its answer turns on. T4.2 calibrated the four market limits of
 * C4 on the top 50 and left these two untouched, because no panel exercises them; this tool is the first caller
 * that reads them (see the `notes` of `C4` in `config/checks.json`).
 */
export const ORDER_LIMITS_NOTE =
  'The two order-size limits of C4 (warnOrderSharePercent, criticalOrderSharePercent) are placeholders: the ' +
  'calibration of T4.2 ran on assets rather than on orders, so no recorded measurement settles them yet. The share ' +
  'itself is measured; where the line between a large order and an oversized one belongs is not.';

/** One answer a statement rests on, named the way an agent can cite it. */
export interface SourceDigest {
  endpoint: EndpointId;
  path: string;
  /** The clock of the answer that carried the data, as the API wrote it. */
  observedAt: string;
  /** The recorded answer, when the run was replayed; `null` for a live call. */
  fixture: string | null;
}

/** One measurement, with the limit it was read against. Units travel with values so no bare number is handed over. */
export interface MeasurementDigest {
  label: string;
  value: number | null;
  unit: Unit;
  threshold: number | null;
}

/** One observation a check raised. */
export interface FindingDigest {
  code: string;
  severity: Severity;
  message: string;
}

/** One check, as a tool hands it back. */
export interface CheckDigest {
  id: CheckId;
  title: string;
  status: CheckStatus;
  severity: Severity | null;
  /** Why it did not run; `null` when it did (D9). */
  reason: string | null;
  /** Points out of 100 it scored; `null` when it did not run. */
  points: number | null;
  /** The share of the score it carried after renormalisation, in percent; 0 when it did not run. */
  sharePercent: number;
  findings: FindingDigest[];
  /**
   * Every measurement of the check, for the checks the calling tool details — C5 for `check_rwa_token`, C4 for
   * `preflight_trade`. `null` for the others, which would otherwise bury the answer in numbers no one asked for.
   */
  measurements: MeasurementDigest[] | null;
}

/** What the three asset tools answer with. */
export interface AssetAnswer {
  /** The asset as the caller named it. */
  asked: string;
  /** The asset as the answers named it; `null` when no endpoint settled on one. */
  resolved: { cmcId: number | null; symbol: string | null; name: string | null } | null;
  verdict: Verdict;
  /** 0 to 100; `null` when no check could be evaluated, which is `DO_NOT_ACT` by itself (D11). */
  score: number | null;
  /** Worst severity across the checks that ran; `null` when none did. */
  severity: Severity | null;
  coverage: { evaluated: number; total: number; label: string };
  /** One neutral sentence: the verdict, the score, the coverage and the worst observation. */
  summary: string;
  checks: CheckDigest[];
  /** The calls that brought nothing back, with the reason each gave. Never carries the API key. */
  failures: { endpoint: EndpointId; kind: string; message: string }[];
  evidence: SourceDigest[];
  credits: CreditUsage;
  elapsedMs: number;
  /** What this answer does not cover, in plain English. Empty only when there is nothing to add. */
  caveats: string[];
}

/** What `preflight_trade` adds to an asset answer: the order it weighed, and what it could say about it. */
export interface TradeAnswer extends AssetAnswer {
  order: {
    side: OrderSide;
    sizeUsd: number;
    /** What share of the deepest pool read the order would take; `null` when no pool stated a usable depth. */
    shareOfDeepestPoolPercent: number | null;
    warnAbovePercent: number;
    criticalAbovePercent: number;
  };
}

/** What every tool hands back: text for the agent to read, and the same answer structured for it to act on. */
export interface ToolAnswer<T> {
  /** Plain text, one array entry per line. */
  lines: string[];
  data: T;
  /** `true` when the tool could not do its job; the lines then say why. */
  isError: boolean;
}

/** What `explain` answers with. */
export type ExplainAnswer = CheckExplanation;

function sourceDigest(source: SourceRef): SourceDigest {
  return {
    endpoint: source.endpoint,
    path: source.path,
    observedAt: source.observedAt,
    fixture: source.fixture === null ? null : source.fixture.file,
  };
}

function measurementDigest(measurement: Measurement): MeasurementDigest {
  return {
    label: measurement.label,
    value: measurement.value,
    unit: measurement.unit,
    threshold: measurement.threshold,
  };
}

/** What the score said about one check: the points it carried, and the share of the score they were. */
interface ScoredShare {
  points: number | null;
  sharePercent: number;
}

/** One check, with its measurements kept only when the calling tool asked for that check in detail. */
function checkDigest(result: CheckResult, scored: ScoredShare | undefined, detailed: boolean): CheckDigest {
  return {
    id: result.id,
    title: result.title,
    status: result.status,
    severity: result.severity,
    reason: result.reason,
    points: scored?.points ?? null,
    sharePercent: scored?.sharePercent ?? 0,
    findings: result.findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
    })),
    measurements: detailed ? result.measurements.map(measurementDigest) : null,
  };
}

/**
 * The assessment as a tool hands it back. `detail` names the checks whose every measurement travels with the
 * answer: the subject of the tool, and nothing else.
 */
export function assetAnswer(
  assessment: AssetAssessment,
  detail: readonly CheckId[] = [],
  caveats: readonly string[] = [],
): AssetAnswer {
  const { score } = assessment;
  const scoredById = new Map<CheckId, ScoredShare>(
    score.checks.map((check) => [check.id, { points: check.points, sharePercent: check.share }]),
  );
  return {
    asked: describeSubject(assessment.subject),
    resolved:
      assessment.asset === null
        ? null
        : { cmcId: assessment.asset.cmcId, symbol: assessment.asset.symbol, name: assessment.asset.name },
    verdict: score.verdict,
    score: score.score,
    severity: score.severity,
    coverage: { evaluated: score.coverage.evaluated, total: score.coverage.total, label: score.coverage.label },
    summary: score.summary,
    checks: assessment.checks.map((result) =>
      checkDigest(result, scoredById.get(result.id), detail.includes(result.id)),
    ),
    failures: assessment.failures.map((failure) => ({ ...failure })),
    evidence: assessment.sources.map(sourceDigest),
    credits: assessment.credits,
    elapsedMs: assessment.elapsedMs,
    caveats: [...caveats],
  };
}

/** The asset in the words of the answers, for the first line an agent reads. */
function namedAsset(answer: AssetAnswer): string {
  if (answer.resolved === null) return answer.asked;
  const id = answer.resolved.cmcId === null ? null : `CMC ${String(answer.resolved.cmcId)}`;
  const parts = [answer.resolved.symbol, answer.resolved.name, id].filter(
    (part): part is string => part !== null && part !== '',
  );
  return parts.length === 0 ? answer.asked : parts.join(' — ');
}

/** The lines an agent reads: the verdict first, then what was observed, what did not run, and the evidence. */
export function describeAssetAnswer(answer: AssetAnswer): string[] {
  const lines = [`${answer.verdict} — ${namedAsset(answer)}`, answer.summary];

  const raised = answer.checks.filter((check) => check.findings.length > 0);
  if (raised.length > 0) {
    lines.push('', 'Observations');
    for (const check of raised) {
      for (const finding of check.findings) {
        lines.push(`  ${check.id} ${finding.severity} ${finding.code}: ${finding.message}`);
      }
    }
  }

  const notRun = answer.checks.filter((check) => check.points === null);
  if (notRun.length > 0) {
    lines.push('', 'Checks that did not run');
    for (const check of notRun) {
      lines.push(`  ${check.id} ${check.status}: ${check.reason ?? 'No reason was given.'}`);
    }
  }

  if (answer.failures.length > 0) {
    lines.push('', 'Calls that brought nothing back');
    for (const failure of answer.failures) lines.push(`  ${failure.endpoint} ${failure.kind}: ${failure.message}`);
  }

  if (answer.evidence.length > 0) {
    lines.push('', 'Evidence');
    for (const source of answer.evidence) {
      lines.push(
        `  ${source.endpoint} ${source.path} observed ${source.observedAt} — ${source.fixture ?? 'live call'}`,
      );
    }
  }

  if (answer.caveats.length > 0) {
    lines.push('', 'What this answer does not cover');
    for (const caveat of answer.caveats) lines.push(`  ${caveat}`);
  }
  return lines;
}

/** What a tool run needs beyond its arguments: the client to read through, and how the engine is configured. */
export interface ToolContext {
  client: CmcClient;
  /** Thresholds and weights; `config/checks.json` by default. */
  config?: ChecksConfig;
  /** Passed through to `assessAsset`, which is how a test supplies an index without touching the cache (D6). */
  assess?: Omit<AssessOptions, 'config' | 'orderSizeUsd'>;
}

/** The options one assessment is run with, the engine configuration included. */
function assessOptions(context: ToolContext, config: ChecksConfig, orderSizeUsd: number | null): AssessOptions {
  return {
    ...context.assess,
    config,
    ...(orderSizeUsd === null ? {} : { orderSizeUsd }),
  };
}

/** A `CmcError` as a tool result: the reason, and the evidence behind it when the error carries one. */
function errorAnswer(error: CmcError): { lines: string[]; isError: true } {
  const lines = [`This tool could not answer: ${error.kind}: ${error.message}`];
  if (error.fixture) lines.push(`Evidence: ${error.fixture.file}`);
  return { lines, isError: true };
}

/** `check_asset(symbol_or_id)` — the score, the verdict, the seven checks and the evidence for one asset. */
export async function checkAsset(context: ToolContext, asset: string): Promise<ToolAnswer<AssetAnswer | null>> {
  try {
    const config = context.config ?? loadChecksConfig();
    const assessment = await assessAsset(context.client, parseSubject(asset), assessOptions(context, config, null));
    const answer = assetAnswer(assessment);
    return { lines: describeAssetAnswer(answer), data: answer, isError: false };
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    return { ...errorAnswer(error), data: null };
  }
}

/**
 * `check_rwa_token(symbol_or_id)` — the same run, with C5 in detail: every premium, discount and spread it measured
 * against the average tokenized price of the real-world asset behind this token.
 *
 * A token the index links to no real-world asset is not an error: C5 comes back `not_applicable` with its reason,
 * and the caveats say the answer is a general one. Guessing at a link is what D6 forbids.
 */
export async function checkRwaToken(context: ToolContext, asset: string): Promise<ToolAnswer<AssetAnswer | null>> {
  try {
    const config = context.config ?? loadChecksConfig();
    const assessment = await assessAsset(context.client, parseSubject(asset), assessOptions(context, config, null));
    const c5 = assessment.checks.find((check) => check.id === 'C5');
    const caveats =
      c5 === undefined || c5.status === 'evaluated'
        ? []
        : [
            `C5, the real-world-asset check this tool is about, did not run (${c5.status}): ` +
              `${c5.reason ?? 'no reason was given.'} Everything else in this answer is the general assessment of ` +
              'this asset, not a reading of a wrapper against its underlying asset.',
          ];
    const answer = assetAnswer(assessment, ['C5'], caveats);
    const lines = describeAssetAnswer(answer);
    if (assessment.wrapper !== null) {
      const issuer = assessment.wrapper.issuerName === null ? '' : `, issued by ${assessment.wrapper.issuerName}`;
      lines.splice(2, 0, '', `Wraps rwa_id ${String(assessment.wrapper.rwaId)}${issuer} (cached index, D6).`);
    }
    return { lines, data: answer, isError: false };
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    return { ...errorAnswer(error), data: null };
  }
}

/**
 * The share of the deepest pool C4 measured for this order; `null` when it measured none. Read off the measurement
 * C4 itself produced rather than divided again here, so the number the agent reads is the number C4 judged.
 */
export function orderShareOf(assessment: AssetAssessment): number | null {
  const c4 = assessment.checks.find((check) => check.id === 'C4');
  const measured = c4?.measurements.find((measurement) => measurement.label.includes('the deepest pool read'));
  return measured?.value ?? null;
}

/** A share of a pool as the order line prints it: three decimals at most, and no trailing zeros. */
function formatShare(share: number): string {
  return String(Math.round(share * 1000) / 1000);
}

/**
 * `preflight_trade(symbol_or_id, side, size_usd)` — the verdict for an order of this size, which is the asset
 * verdict with C4 reading the order against the depth of the deepest pool it found (D5).
 *
 * The size is validated here rather than in the engine: a caller asking about an order of zero has made a mistake
 * worth reporting as one, where an asset whose pools hold nothing is a measurement.
 */
export async function preflightTrade(
  context: ToolContext,
  asset: string,
  side: OrderSide,
  sizeUsd: number,
): Promise<ToolAnswer<TradeAnswer | null>> {
  try {
    if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
      throw new CmcError(
        'config',
        `the order size is ${String(sizeUsd)}, which is not an amount of USD above 0, so there is no order to weigh.`,
      );
    }
    const config = context.config ?? loadChecksConfig();
    const assessment = await assessAsset(context.client, parseSubject(asset), assessOptions(context, config, sizeUsd));
    const share = orderShareOf(assessment);
    const answer: TradeAnswer = {
      ...assetAnswer(assessment, ['C4'], [ORDER_SIDE_NOTE, ORDER_LIMITS_NOTE]),
      order: {
        side,
        sizeUsd,
        shareOfDeepestPoolPercent: share,
        warnAbovePercent: config.C4.warnOrderSharePercent,
        criticalAbovePercent: config.C4.criticalOrderSharePercent,
      },
    };
    const lines = describeAssetAnswer(answer);
    lines.splice(
      2,
      0,
      '',
      `Order weighed: ${side} ${String(sizeUsd)} USD. ` +
        (share === null
          ? 'No pool stating a usable depth was read for this asset, so the order itself could not be weighed; C4 ' +
            'says so in its own words below.'
          : `That is ${formatShare(share)} % of the deepest pool read (warning above ` +
            `${String(answer.order.warnAbovePercent)} %, critical above ` +
            `${String(answer.order.criticalAbovePercent)} %).`),
    );
    return { lines, data: answer, isError: false };
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    return { ...errorAnswer(error), data: null };
  }
}

/** `explain(check_id)` — what one check measures, the limits it reads, and where those limits were settled. */
export function explain(checkId: string, config?: ChecksConfig): ToolAnswer<ExplainAnswer | null> {
  try {
    const explanation = explainCheck(parseCheckId(checkId), config ?? loadChecksConfig());
    return { lines: describeExplanation(explanation), data: explanation, isError: false };
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    return { ...errorAnswer(error), data: null };
  }
}
