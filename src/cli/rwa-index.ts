/**
 * Builds and inspects the token to real-world-asset index C5 answers a wrapper symbol with (D6).
 *
 * The index is a whole-catalogue walk over E18 and E19, so it is built once, cached under `.cache/`, and reused.
 * What the walk costs is read from the client's own meter and printed, never estimated: this command is how the
 * cost recorded in `docs/DECISIONS.md` was measured.
 *
 * Usage: npm run rwa:index -- [symbol] [--build] [--page-size=N] [--file=<path>] [--record[=dir] | --replay[=dir]]
 *   symbol         a wrapper to look up once the index is there, for example PAXG;
 *   --build        walks the API again even when a cached index exists;
 *   --page-size=N  tokens asked for per page, 1 to 250 (250 by default);
 *   --file=<path>  where the index is cached (.cache/rwa/wrapper-index.json by default);
 *   --record       the walk is also written to fixtures, so it can be replayed offline;
 *   --replay       the walk reads recorded fixtures only: no network, no key.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT } from '../cmc/config.js';
import { CmcError } from '../cmc/errors.js';
import { createClientForMode, parseRunMode, type ModeOverrides, type RunMode } from '../cmc/mode.js';
import {
  buildWrapperIndex,
  DEFAULT_INDEX_FILE,
  describeWrapperIndex,
  loadWrapperIndex,
  lookupWrapper,
  saveWrapperIndex,
  type WrapperIndex,
} from '../rwa/wrapper-index.js';

export interface RwaIndexArgs {
  /** A wrapper to look up once the index is available; `null` when the run only builds or describes it. */
  symbol: string | null;
  build: boolean;
  /** Tokens asked for per page; `null` leaves the walk its own default. */
  pageSize: number | null;
  file: string;
  mode: RunMode;
}

const PAGE_SIZE_FLAG = /^--page-size=(.*)$/;
const FILE_FLAG = /^--file=(.*)$/;

const USAGE =
  'Usage: rwa-index [symbol] [--build] [--page-size=N] [--file=<path>] [--record[=dir] | --replay[=dir]]';

/** Validates the command line; throws a usage error otherwise. */
export function parseRwaIndexArgs(argv: readonly string[], cwd = process.cwd()): RwaIndexArgs {
  const { mode, args } = parseRunMode(argv, cwd);
  let build = false;
  let pageSize: number | null = null;
  let file = DEFAULT_INDEX_FILE;
  const rest: string[] = [];

  for (const arg of args) {
    if (arg === '--build') {
      build = true;
      continue;
    }
    const size = PAGE_SIZE_FLAG.exec(arg);
    if (size) {
      pageSize = Number(size[1]);
      if (!Number.isInteger(pageSize)) throw new Error(`${arg}: the page size must be a whole number. ${USAGE}`);
      continue;
    }
    const where = FILE_FLAG.exec(arg);
    if (where) {
      if (!where[1]) throw new Error(`${arg}: the file path is empty. ${USAGE}`);
      file = resolve(cwd, where[1]);
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option "${arg}". ${USAGE}`);
    rest.push(arg);
  }

  if (rest.length > 1) throw new Error(`One symbol at a time, got ${rest.join(', ')}. ${USAGE}`);
  return { symbol: rest[0] ?? null, build, pageSize, file, mode };
}

/** Where the index came from, so a reader knows whether the numbers above cost anything on this run. */
function origin(built: boolean, file: string): string {
  return built ? `Built and cached in ${file}.` : `Read from ${file}; run with --build to walk the API again.`;
}

/** What the index says about one wrapper: which real-world asset C5 would read for it, and through which issuer. */
function lookupLines(index: WrapperIndex, symbol: string): string[] {
  const found = lookupWrapper(index, { symbol });
  if (found.length === 0) {
    return [
      `${symbol}: not in the index, so C5 has no real-world asset to compare it with. It may be a coin rather ` +
        'than a tokenised wrapper, or a wrapper its issuer listed without an rwa_id.',
    ];
  }
  return found.map(
    (entry) =>
      `${symbol}: CMC ${String(entry.cmcId)} wraps rwa_id ${String(entry.rwaId)}` +
      `${entry.issuerName === null ? '' : `, issued by ${entry.issuerName}`}` +
      `${found.length > 1 ? ' (one of several wrappers under this symbol)' : ''}.`,
  );
}

/** Builds or reads the index and reports it. A CMC failure comes back as lines, with the fixture that proves it. */
export async function runRwaIndex(
  args: RwaIndexArgs,
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: ModeOverrides = {},
): Promise<{ ok: boolean; lines: string[] }> {
  let index = args.build ? null : loadWrapperIndex(args.file);
  let built = false;
  if (index === null) {
    const client = createClientForMode(args.mode, env, overrides);
    try {
      index = await buildWrapperIndex(client, args.pageSize === null ? {} : { pageSize: args.pageSize });
    } catch (error) {
      if (!(error instanceof CmcError)) throw error;
      const lines = [`❌ ${error.message}`];
      if (error.fixture) lines.push(`Evidence: ${error.fixture.file}`);
      return { ok: false, lines };
    }
    saveWrapperIndex(index, args.file);
    built = true;
  }

  const lines = [...describeWrapperIndex(index), origin(built, args.file)];
  return { ok: true, lines: args.symbol === null ? lines : [...lines, ...lookupLines(index, args.symbol)] };
}

async function main(): Promise<void> {
  const envFile = join(PROJECT_ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { ok, lines } = await runRwaIndex(parseRwaIndexArgs(process.argv.slice(2)));
  for (const line of lines) (ok ? console.log : console.error)(line);
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
