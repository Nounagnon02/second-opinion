/**
 * Reads one asset through the whole engine and prints the verdict: the command of acceptance criterion 2 of the
 * specification, "`npm run check -- <symbol>` gives a verdict in under 10 seconds with a real key".
 *
 * Usage: npm run check -- <symbol or CMC ID> [--record[=dir] | --replay[=dir]] [--json] [--details] [--index=<path>]
 *   symbol          PAXG, BTC, ...; resolved through E01, and a numeric CMC ID skips that call (D3);
 *   no mode flag    live calls, through the local cache (.cache/cmc); needs CMC_API_KEY;
 *   --record        live calls, each answer also written to fixtures/recorded (or dir), key masked;
 *   --replay        answers read from fixtures/ (or dir): no network, no key;
 *   --json          prints the whole assessment as JSON instead of the report;
 *   --details       also prints every measurement, not only the observations that were raised;
 *   --index=<path>  where the token to real-world-asset index is cached (D6).
 *
 * The exit status is 0 whenever a verdict was formed — the verdict is the output of this command, not its status —
 * and 1 when no check could be evaluated at all, which is the run that measured nothing to rest a verdict on (D11).
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assessAsset,
  describeSubject,
  parseSubject,
  type AssessOptions,
  type AssetAssessment,
  type Subject,
} from '../checks/assess.js';
import { CHECK_TITLES, type CheckResult, type Finding, type Measurement } from '../checks/model.js';
import { formatValue } from '../checks/units.js';
import { PROJECT_ROOT } from '../cmc/config.js';
import type { CmcClient } from '../cmc/client.js';
import { CmcError } from '../cmc/errors.js';
import { createClientForMode, parseRunMode, type ModeOverrides, type RunMode } from '../cmc/mode.js';
import type { AssetRef, SourceRef } from '../normalize/model.js';
import { formatScore, type ScoredCheck } from '../score/score.js';
import { describeCredits, wrap } from './args.js';

/** The time one `check` is meant to fit in (D1), which the last line of the report reads the run against. */
export const VERDICT_BUDGET_MS = 10_000;

/** How many of the other entries E01 returned are listed before the rest are only counted (D3). */
export const LISTED_CANDIDATES = 5;

/**
 * The wall clock of a run, to the precision the 10-second budget is read at: milliseconds under a second, so that a
 * replay does not report "0 s", and one decimal above it. `formatDuration` rounds to whole seconds, which is right
 * for the age of a price and too coarse for this line.
 */
export function formatElapsed(milliseconds: number): string {
  const ms = Math.round(milliseconds);
  return ms < 1_000 ? `${String(ms)} ms` : `${String(Math.round(ms / 100) / 10)} s`;
}

export interface CheckArgs {
  subject: Subject;
  mode: RunMode;
  json: boolean;
  details: boolean;
  /** Where the wrapper index is cached; `null` leaves the default of D6. */
  indexFile: string | null;
}

const INDEX_FLAG = /^--index=(.*)$/;

const USAGE =
  'Usage: check <symbol or CMC ID> [--record[=dir] | --replay[=dir]] [--json] [--details] [--index=<path>]';

/** Validates the command line; throws a usage error otherwise. */
export function parseCheckArgs(argv: readonly string[], cwd = process.cwd()): CheckArgs {
  const { mode, args } = parseRunMode(argv, cwd);
  let json = false;
  let details = false;
  let indexFile: string | null = null;
  const rest: string[] = [];

  for (const arg of args) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--details') {
      details = true;
      continue;
    }
    const where = INDEX_FLAG.exec(arg);
    if (where) {
      if (!where[1]) throw new Error(`${arg}: the index file path is empty. ${USAGE}`);
      indexFile = resolve(cwd, where[1]);
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option "${arg}". ${USAGE}`);
    rest.push(arg);
  }

  const [named, ...extra] = rest;
  if (named === undefined) throw new Error(`No asset was named. ${USAGE}`);
  if (extra.length > 0) throw new Error(`One asset at a time, got ${rest.join(', ')}. ${USAGE}`);
  return { subject: parseSubject(named), mode, json, details, indexFile };
}

/** Re-exported where it has always been read from; it now lives with the other unit writers. */
export { formatValue };

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** One measurement: what was measured, and the configured limit it was read against. */
export function describeMeasurement(measurement: Measurement): string {
  const head = `${measurement.label}: ${formatValue(measurement.value, measurement.unit)}`;
  if (measurement.threshold === null) return head;
  return `${head} (limit ${formatValue(measurement.threshold, measurement.unit)})`;
}

/** One observation a check raised, with its severity and its stable code. */
function findingLines(finding: Finding): string[] {
  return wrap(`${finding.severity} ${finding.code}: ${finding.message}`, '      ');
}

/** The asset the run was about, as the answers named it. */
function describeAsset(asset: AssetRef | null, subject: Subject): string {
  const symbol = asset?.symbol ?? (subject.kind === 'symbol' ? subject.symbol : null);
  const id = asset === null || asset.cmcId === null ? null : `CMC ${String(asset.cmcId)}`;
  const parts = [asset?.name ?? null, id].filter((part): part is string => part !== null).join(', ');
  if (symbol === null) return parts === '' ? describeSubject(subject) : parts;
  return parts === '' ? symbol : `${symbol} — ${parts}`;
}

/** Where the run looked past the aggregated endpoints: the DEX contract, and the asset behind a wrapper. */
function contextLine(assessment: AssetAssessment): string | null {
  const parts: string[] = [];
  if (assessment.contract) {
    parts.push(`Token ${assessment.contract.address} on ${assessment.contract.platform}.`);
  }
  if (assessment.wrapper) {
    const issuer = assessment.wrapper.issuerName === null ? '' : `, issued by ${assessment.wrapper.issuerName}`;
    parts.push(`Wraps rwa_id ${String(assessment.wrapper.rwaId)}${issuer}.`);
  }
  return parts.length === 0 ? null : parts.join(' ');
}

/** The checks that ran, with what each scored and the share of the score it carried. */
function evaluatedLines(score: ScoredCheck, result: CheckResult, details: boolean): string[] {
  const head =
    `  ${score.id}  ${padRight(score.severity ?? 'info', 9)}${CHECK_TITLES[score.id]} ` +
    `(${formatScore(score.points ?? 0)} points, ${formatScore(score.share)} % of the score)`;
  const lines = [head];
  for (const finding of result.findings) lines.push(...findingLines(finding));
  if (details) {
    for (const measurement of result.measurements) lines.push(...wrap(describeMeasurement(measurement), '      '));
  }
  return lines;
}

/** The checks that did not run, each with the reason it gave and the weight the score renormalised away (D9). */
function skippedLines(score: ScoredCheck, result: CheckResult): string[] {
  const head =
    `  ${score.id}  ${padRight(score.status, 15)}${CHECK_TITLES[score.id]} ` +
    `(weight ${formatScore(score.weight)}, not scored)`;
  return [head, ...wrap(result.reason ?? 'No reason was given.', '      ')];
}

/** Every answer the run read, once each: the evidence behind every line above. */
function evidenceLines(sources: readonly SourceRef[]): string[] {
  return sources.map(
    (source) =>
      `  ${source.endpoint}  ${padRight(source.path, 40)}observed ${source.observedAt}  ` +
      `${source.fixture === null ? 'live call' : source.fixture.file}`,
  );
}

/** The other entries E01 returned for a symbol: listed, never merged into the answer (D3). */
function candidateLines(assessment: AssetAssessment): string[] {
  const { others } = assessment.resolution;
  if (others.length === 0) return [];
  const symbol = assessment.subject.kind === 'symbol' ? assessment.subject.symbol : 'this asset';
  const lines = [`Other entries E01 returned for ${symbol}`];
  for (const other of others.slice(0, LISTED_CANDIDATES)) {
    const id = other.asset.cmcId === null ? 'no CMC ID' : `CMC ${String(other.asset.cmcId)}`;
    const name = other.asset.name ?? other.asset.symbol ?? 'not named';
    const rank = other.rank === null ? 'unranked' : `rank ${String(other.rank)}`;
    lines.push(`  ${padRight(id, 12)}${padRight(name, 30)}${rank}${other.isActive === false ? ', inactive' : ''}`);
  }
  const rest = others.length - LISTED_CANDIDATES;
  if (rest > 0) lines.push(`  and ${String(rest)} more, none of them used.`);
  return lines;
}

/** The report, one array entry per printed line. */
export function describeAssessment(assessment: AssetAssessment, details = false): string[] {
  const { score } = assessment;
  const lines = [describeAsset(assessment.asset, assessment.subject)];
  const context = contextLine(assessment);
  if (context !== null) lines.push(context);
  lines.push(...wrap(score.summary, ''));

  const byId = new Map(assessment.checks.map((result) => [result.id, result]));
  const ran = score.checks.filter((check) => check.points !== null);
  const skipped = score.checks.filter((check) => check.points === null);

  if (ran.length > 0) {
    lines.push('Evaluated');
    for (const check of ran) {
      const result = byId.get(check.id);
      if (result) lines.push(...evaluatedLines(check, result, details));
    }
  }
  if (skipped.length > 0) {
    lines.push('Not evaluated');
    for (const check of skipped) {
      const result = byId.get(check.id);
      if (result) lines.push(...skippedLines(check, result));
    }
  }
  if (assessment.failures.length > 0) {
    lines.push('Calls that brought nothing back');
    for (const failure of assessment.failures) {
      lines.push(...wrap(`${failure.endpoint} ${failure.kind}: ${failure.message}`, '  '));
    }
  }
  lines.push(...candidateLines(assessment));
  if (assessment.sources.length > 0) {
    lines.push('Evidence', ...evidenceLines(assessment.sources));
  }
  lines.push(describeCredits(assessment.credits));
  // The attempts beside the answers: they are what tells a slow plan from a call the client had to make twice.
  lines.push(
    `Read in ${formatElapsed(assessment.elapsedMs)}, ` +
      `${assessment.elapsedMs <= VERDICT_BUDGET_MS ? 'within' : 'past'} the ` +
      `${formatElapsed(VERDICT_BUDGET_MS)} budget of D1; ` +
      `${String(assessment.credits.requests)} attempt(s) for ${String(assessment.sources.length)} answer(s).`,
  );
  return lines;
}

/**
 * Runs the command. A run that measured nothing at all comes back as `ok: false` with its report all the same: the
 * lines say which check gave which reason, and the exit status says the command could not do its job (D11).
 */
export async function runCheck(
  args: CheckArgs,
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: ModeOverrides = {},
  options: AssessOptions = {},
): Promise<{ ok: boolean; lines: string[] }> {
  let client: CmcClient;
  try {
    client = createClientForMode(args.mode, env, overrides);
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    // A directory that is not there, or a live run without a key: no client, so no meter to report either.
    return { ok: false, lines: [`❌ ${error.message}`] };
  }
  let assessment: AssetAssessment;
  try {
    assessment = await assessAsset(client, args.subject, {
      ...options,
      ...(args.indexFile === null ? {} : { indexFile: args.indexFile }),
    });
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    const lines = [`❌ ${error.message}`];
    if (error.fixture) lines.push(`Evidence: ${error.fixture.file}`);
    return { ok: false, lines: [...lines, describeCredits(client.credits())] };
  }
  const lines = args.json ? [JSON.stringify(assessment, null, 2)] : describeAssessment(assessment, args.details);
  return { ok: assessment.score.score !== null, lines };
}

async function main(): Promise<void> {
  const envFile = join(PROJECT_ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { ok, lines } = await runCheck(parseCheckArgs(process.argv.slice(2)));
  for (const line of lines) (ok ? console.log : console.error)(line);
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
