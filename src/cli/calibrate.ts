/**
 * Runs the whole engine over the first assets by market capitalisation and writes the calibration report
 * (specification F5, acceptance criterion 4).
 *
 * Usage: npm run calibrate -- [--size=N] [--record[=dir] | --replay[=dir]] [--write] [--json]
 *                            [--per-minute=N] [--index=<path>]
 *   no mode flag     live calls, through the local cache (.cache/cmc); needs CMC_API_KEY;
 *   --record         live calls, each answer also written to fixtures/calibration (or dir), key masked;
 *   --replay         answers read from fixtures/ (or dir): no network, no key;
 *   --size=N         assets to read from E03 (50 by default, the number the specification names);
 *   --write          writes docs/CALIBRATION.md and docs/calibration.json instead of printing the report;
 *   --json           prints the whole run as JSON;
 *   --per-minute=N   requests per minute the run is paced at; ignored in replay, which sends none;
 *   --index=<path>   where the token to real-world-asset index is cached (D6).
 *
 * The exit status is 0 when the panel was assessed and reached the share of `ACT` the specification requires, and 1
 * when it did not or when the run could not be made at all: this command is the gate acceptance criterion 4 states,
 * so a panel below the target has to fail it.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  calibrationReport,
  runCalibration,
  serializeReport,
  serializeRun,
  summaryLine,
  DEFAULT_PANEL_SIZE,
  MAX_PANEL_SIZE,
  type AssetOutcome,
  type CalibrationRun,
} from '../calibration/index.js';
import { DEFAULT_FIXTURE_DIR, DEFAULT_RECORD_DIR, PROJECT_ROOT } from '../cmc/config.js';
import { CmcError } from '../cmc/errors.js';
import { createClientForMode, parseRunMode, type ModeOverrides, type RunMode } from '../cmc/mode.js';
import { fetchTransport, type CmcClient } from '../cmc/client.js';
import { throttledTransport } from '../cmc/throttle.js';
import { formatScore } from '../score/score.js';
import { describeCredits } from './args.js';

/** Where `--record` writes the answers of this command, and `--replay` reads them from. */
export const CALIBRATION_FIXTURE_DIR = join(DEFAULT_FIXTURE_DIR, 'calibration');

/** The two files the report is written to. */
export const REPORT_FILE = join(PROJECT_ROOT, 'docs', 'CALIBRATION.md');
export const RUN_FILE = join(PROJECT_ROOT, 'docs', 'calibration.json');

/**
 * Requests per minute a live run is paced at by default. E20 reports `plan.rate_limit_minute` = 50 for this key; the
 * margin leaves room for the retries the client adds on its own after a timeout or a rate limit, which would
 * otherwise be the requests that cross the line.
 */
export const DEFAULT_REQUESTS_PER_MINUTE = 40;

export interface CalibrateArgs {
  size: number;
  mode: RunMode;
  write: boolean;
  json: boolean;
  /** Requests per minute for the live and record modes; replay sends none. */
  perMinute: number;
  /** Where the wrapper index is cached; `null` leaves the default of D6. */
  indexFile: string | null;
}

const SIZE_FLAG = /^--size=(.*)$/;
const PER_MINUTE_FLAG = /^--per-minute=(.*)$/;
const INDEX_FLAG = /^--index=(.*)$/;

const USAGE =
  'Usage: calibrate [--size=N] [--record[=dir] | --replay[=dir]] [--write] [--json] [--per-minute=N] ' +
  '[--index=<path>]';

/** Reads a whole number above 0 from a flag. */
function count(arg: string, raw: string | undefined, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${arg}: a whole number between 1 and ${String(max)} was expected. ${USAGE}`);
  }
  return value;
}

/** Validates the command line; throws a usage error otherwise. */
export function parseCalibrateArgs(argv: readonly string[], cwd = process.cwd()): CalibrateArgs {
  const { mode, args } = parseRunMode(argv, cwd);
  let size = DEFAULT_PANEL_SIZE;
  let write = false;
  let json = false;
  let perMinute = DEFAULT_REQUESTS_PER_MINUTE;
  let indexFile: string | null = null;

  for (const arg of args) {
    if (arg === '--write') {
      write = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    const panel = SIZE_FLAG.exec(arg);
    if (panel) {
      size = count(arg, panel[1], MAX_PANEL_SIZE);
      continue;
    }
    const paced = PER_MINUTE_FLAG.exec(arg);
    if (paced) {
      // A minute holds 60_000 milliseconds; anything above that is no pacing at all, and is refused as a typo.
      perMinute = count(arg, paced[1], 60_000);
      continue;
    }
    const where = INDEX_FLAG.exec(arg);
    if (where) {
      if (!where[1]) throw new Error(`${arg}: the index file path is empty. ${USAGE}`);
      indexFile = resolve(cwd, where[1]);
      continue;
    }
    throw new Error(arg.startsWith('--') ? `Unknown option "${arg}". ${USAGE}` : `Unexpected argument "${arg}". ${USAGE}`);
  }

  // This command records into its own directory, so that its panel stays apart from the answers of other tasks.
  const recorded: RunMode =
    mode.kind === 'record' && mode.dir === DEFAULT_RECORD_DIR ? { kind: 'record', dir: CALIBRATION_FIXTURE_DIR } : mode;
  return { size, mode: recorded, write, json, perMinute, indexFile };
}

/** One line per asset while the run goes on: a panel of fifty takes minutes, and silence reads as a hang. */
export function progressLine(outcome: AssetOutcome, done: number, total: number): string {
  const name = outcome.member.symbol ?? `CMC ${String(outcome.member.cmcId)}`;
  const score = outcome.score === null ? 'no score' : `${formatScore(outcome.score)}/100`;
  return (
    `[${String(done)}/${String(total)}] ${name}: ${outcome.verdict}, ${score}, ` +
    `${String(outcome.evaluated)} of 7 checks, ${String(outcome.credits)} credit(s), ${String(outcome.elapsedMs)} ms`
  );
}

/** Writes a generated file, creating its directory. */
function write(file: string, text: string): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
  return file;
}

/**
 * Runs the calibration and reports it.
 *
 * `ok` says whether the panel could be assessed at all; `meetsTarget` says whether it reached the share of `ACT`
 * the specification requires. The two are separate because a run that measured the panel and found it below the
 * target did its job, and the report it produced is the point of the exercise.
 */
export interface CalibrateHooks {
  /** Called with each progress line as the run goes on. */
  onProgress?: (line: string) => void;
  /** Where `--write` puts the two files; the two under `docs/` by default. */
  files?: { report: string; run: string };
}

export async function runCalibrate(
  args: CalibrateArgs,
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: ModeOverrides = {},
  hooks: CalibrateHooks = {},
): Promise<{ ok: boolean; meetsTarget: boolean; lines: string[]; run: CalibrationRun | null }> {
  const live = args.mode.kind !== 'replay';
  const network = overrides.network ?? fetchTransport;
  const paced = live ? throttledTransport(network, { perMinute: args.perMinute }) : network;

  let client: CmcClient;
  try {
    client = createClientForMode(args.mode, env, { ...overrides, network: paced });
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    return { ok: false, meetsTarget: false, lines: [`❌ ${error.message}`], run: null };
  }

  let run: CalibrationRun;
  try {
    run = await runCalibration(client, {
      size: args.size,
      readKeyInfo: live,
      pacedPerMinute: live ? args.perMinute : null,
      ...(args.indexFile === null ? {} : { indexFile: args.indexFile }),
      onAsset: (outcome, done, total) => hooks.onProgress?.(progressLine(outcome, done, total)),
    });
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    const lines = [`❌ ${error.message}`];
    if (error.fixture) lines.push(`Evidence: ${error.fixture.file}`);
    return { ok: false, meetsTarget: false, lines: [...lines, describeCredits(client.credits())], run: null };
  }

  const { meetsTarget } = run.summary;
  if (args.json) return { ok: true, meetsTarget, lines: [serializeRun(run).trimEnd()], run };
  if (!args.write) return { ok: true, meetsTarget, lines: calibrationReport(run), run };

  const files = hooks.files ?? { report: REPORT_FILE, run: RUN_FILE };
  const written = [write(files.report, serializeReport(run)), write(files.run, serializeRun(run))];
  return {
    ok: true,
    meetsTarget,
    lines: [
      ...written.map((file) => `Written: ${file}`),
      summaryLine(run),
      describeCredits(client.credits()),
    ],
    run,
  };
}

async function main(): Promise<void> {
  const envFile = join(PROJECT_ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const args = parseCalibrateArgs(process.argv.slice(2));
  const { ok, meetsTarget, lines } = await runCalibrate(args, process.env, {}, {
    onProgress: (line) => {
      console.error(line);
    },
  });
  for (const line of lines) (ok ? console.log : console.error)(line);
  if (!ok || !meetsTarget) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
