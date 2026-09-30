/**
 * Reads everything this project recorded and writes the audit of the API (specification F9, acceptance
 * criterion 6).
 *
 * Usage: npm run audit -- [--write] [--json] [--no-sample] [--size=N] [--fixtures=<dir>]
 *   no flag           prints the report;
 *   --write           writes docs/API_AUDIT.md and docs/api_audit.json;
 *   --json            prints the whole run as JSON;
 *   --no-sample       skips the engine pass over the sample of assets, which is the slow part;
 *   --size=N          assets of the recorded panel to assess (all of them by default);
 *   --fixtures=<dir>  where the captures live, for a run over another recording of them.
 *
 * The command makes no network call and needs no API key: every statement of the report has to rest on an answer
 * already recorded in the repository, so the recorded corpus is the only thing it reads (D14). That is also why it
 * costs nothing to reproduce.
 *
 * The exit status is 0 when the report was produced, and 1 when the corpus could not be read at all.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  auditReport,
  defaultCorpus,
  defaultSampleDir,
  runAudit,
  runSample,
  serializeAuditReport,
  serializeAuditRun,
  auditSummaryLine,
  type AuditRun,
  type SampleRun,
} from '../audit/index.js';
import type { CmcClient } from '../cmc/client.js';
import { DEFAULT_FIXTURE_DIR, PROJECT_ROOT } from '../cmc/config.js';
import { CmcError } from '../cmc/errors.js';
import { evidencePath } from '../cmc/fixtures.js';
import { createClientForMode } from '../cmc/mode.js';
import { buildWrapperIndex, type WrapperIndex } from '../rwa/wrapper-index.js';

/** The two files the report is written to. */
export const REPORT_FILE = join(PROJECT_ROOT, 'docs', 'API_AUDIT.md');
export const RUN_FILE = join(PROJECT_ROOT, 'docs', 'api_audit.json');

/**
 * A budget large enough for the whole corpus to be replayed.
 *
 * A replay charges what the recorded answers report, so the meter still counts; the ceiling exists to stop a live
 * run from overspending and has nothing to guard here.
 */
const REPLAY_BUDGET = '1000000';

export interface AuditArgs {
  write: boolean;
  json: boolean;
  /** Whether to run the engine over the sample of assets. */
  sample: boolean;
  /** Assets of the recorded panel to assess; `null` for all of them. */
  size: number | null;
  /** Where the captures live. */
  fixtures: string;
}

const SIZE_FLAG = /^--size=(.*)$/;
const FIXTURES_FLAG = /^--fixtures=(.*)$/;

const USAGE = 'Usage: audit [--write] [--json] [--no-sample] [--size=N] [--fixtures=<dir>]';

/** Validates the command line; throws a usage error otherwise. */
export function parseAuditArgs(argv: readonly string[], cwd = process.cwd()): AuditArgs {
  let write = false;
  let json = false;
  let sample = true;
  let size: number | null = null;
  let fixtures = DEFAULT_FIXTURE_DIR;

  for (const arg of argv) {
    if (arg === '--write') {
      write = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--no-sample') {
      sample = false;
      continue;
    }
    const panel = SIZE_FLAG.exec(arg);
    if (panel) {
      const value = Number(panel[1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${arg}: a whole number above 0 was expected. ${USAGE}`);
      }
      size = value;
      continue;
    }
    const where = FIXTURES_FLAG.exec(arg);
    if (where) {
      if (!where[1]) throw new Error(`${arg}: the fixture directory is empty. ${USAGE}`);
      fixtures = resolve(cwd, where[1]);
      continue;
    }
    throw new Error(
      arg.startsWith('--') ? `Unknown option "${arg}". ${USAGE}` : `Unexpected argument "${arg}". ${USAGE}`,
    );
  }
  return { write, json, sample, size, fixtures };
}

/** A client that answers only from the recorded answers of one directory. */
export function replayClient(dir: string): CmcClient {
  return createClientForMode({ kind: 'replay', dir }, { CMC_CREDIT_BUDGET: REPLAY_BUDGET });
}

/**
 * The token to real-world-asset index the sample is assessed against (D6).
 *
 * It is rebuilt from the recorded E18 / E19 walk rather than read from `.cache/`, which a clean clone does not
 * have: the audit has to produce the same numbers on a fresh checkout as it does here.
 */
export function sampleIndex(fixtures: string): Promise<WrapperIndex> {
  return buildWrapperIndex(replayClient(join(fixtures, 'rwa-index')));
}

/** Runs the engine over the recorded panel, offline. */
export async function auditSample(args: AuditArgs): Promise<SampleRun> {
  const dir = defaultSampleDir(args.fixtures);
  const wrapperIndex = await sampleIndex(args.fixtures);
  return runSample(replayClient(dir), evidencePath(dir), {
    wrapperIndex,
    ...(args.size === null ? {} : { size: args.size }),
  });
}

/** Writes a generated file, creating its directory. */
function write(file: string, text: string): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
  return file;
}

export interface AuditHooks {
  /** Where `--write` puts the two files; the two under `docs/` by default. */
  files?: { report: string; run: string };
}

/**
 * Reads the corpus, measures it, and reports.
 *
 * `ok` says whether the corpus could be read at all. A corpus that produced no entry is not a failure: a report
 * stating honestly that it measured a great deal and found nothing to raise is one of the two outcomes acceptance
 * criterion 6 allows.
 */
export async function runAuditCommand(
  args: AuditArgs,
  hooks: AuditHooks = {},
): Promise<{ ok: boolean; lines: string[]; run: AuditRun | null }> {
  let run: AuditRun;
  try {
    const sample = args.sample ? await auditSample(args) : null;
    run = runAudit({ parts: defaultCorpus(args.fixtures), sample });
  } catch (error) {
    if (!(error instanceof CmcError)) throw error;
    const lines = [`❌ ${error.message}`];
    if (error.fixture) lines.push(`Evidence: ${error.fixture.file}`);
    return { ok: false, lines, run: null };
  }

  if (args.json) return { ok: true, lines: [serializeAuditRun(run).trimEnd()], run };
  if (!args.write) return { ok: true, lines: auditReport(run), run };

  const files = hooks.files ?? { report: REPORT_FILE, run: RUN_FILE };
  const written = [write(files.report, serializeAuditReport(run)), write(files.run, serializeAuditRun(run))];
  return { ok: true, lines: [...written.map((file) => `Written: ${file}`), auditSummaryLine(run)], run };
}

async function main(): Promise<void> {
  const { ok, lines } = await runAuditCommand(parseAuditArgs(process.argv.slice(2)));
  for (const line of lines) (ok ? console.log : console.error)(line);
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
