/**
 * Run modes of the commands (specification F2), chosen by a flag:
 * - live (no flag): the API, through the local cache (.cache/cmc);
 * - `--record[=dir]`: the API, without the cache of earlier runs, and every answer also written to a fixture
 *   (fixtures/recorded by default), so that the run can be replayed and its results cited;
 * - `--replay[=dir]`: recorded fixtures only (fixtures/ and its subdirectories by default). No network and no API
 *   key. No retries either: a recorded answer would only repeat itself. Credits are counted as the recorded
 *   `status.credit_count` reports them, so a replay shows what the live run cost.
 */
import { resolve } from 'node:path';
import { MemoryCache } from './cache.js';
import { CmcClient, createClientFromEnv, fetchTransport, type CmcClientOptions, type Transport } from './client.js';
import { DEFAULT_FIXTURE_DIR, DEFAULT_RECORD_DIR, loadClientConfig, loadClientSettings } from './config.js';
import { CmcError } from './errors.js';
import { MASK } from './fixtures.js';
import { recordingTransport } from './recorder.js';
import { FixtureIndex, replayTransport } from './replay.js';

export type RunMode = { kind: 'live' } | { kind: 'record'; dir: string } | { kind: 'replay'; dir: string };

const MODE_FLAG = /^--(record|replay)(?:=(.*))?$/;

/**
 * Takes `--record[=dir]` or `--replay[=dir]` out of the command-line arguments and returns the others in order.
 * A relative directory is resolved against `cwd`.
 */
export function parseRunMode(argv: readonly string[], cwd = process.cwd()): { mode: RunMode; args: string[] } {
  let mode: RunMode = { kind: 'live' };
  const args: string[] = [];
  for (const arg of argv) {
    const match = MODE_FLAG.exec(arg);
    if (!match) {
      args.push(arg);
      continue;
    }
    if (mode.kind !== 'live') {
      throw new CmcError('config', `One mode per run: --${mode.kind} and ${arg} were both given.`);
    }
    const kind = match[1] === 'record' ? 'record' : 'replay';
    const dir = match[2];
    if (dir === '') throw new CmcError('config', `${arg}: the fixture directory is empty.`);
    const fallback = kind === 'record' ? DEFAULT_RECORD_DIR : DEFAULT_FIXTURE_DIR;
    mode = { kind, dir: dir === undefined ? fallback : resolve(cwd, dir) };
  }
  return { mode, args };
}

export type ModeOverrides = Omit<CmcClientOptions, 'apiKey' | 'transport'> & {
  /** The network of the live and record modes, `fetch` by default. Replay mode never uses it. */
  network?: Transport;
};

/** The client of a run in the given mode, with its settings from the environment. */
export function createClientForMode(
  mode: RunMode,
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: ModeOverrides = {},
): CmcClient {
  const { network = fetchTransport, ...options } = overrides;
  switch (mode.kind) {
    case 'live':
      return createClientFromEnv(env, { ...options, transport: network });
    case 'record': {
      const { apiKey, baseUrl, creditBudget, cacheTtlSeconds, timeoutMs, maxRetries } = loadClientConfig(env);
      const recorder = { dir: mode.dir, secret: apiKey, ...(options.now ? { now: options.now } : {}) };
      return new CmcClient({
        ...{ apiKey, baseUrl, creditBudget, cacheTtlSeconds, timeoutMs, maxRetries },
        // A fresh cache: an answer served from an earlier run would leave no fixture behind.
        cache: new MemoryCache(),
        ...options,
        transport: recordingTransport(network, recorder),
      });
    }
    case 'replay': {
      const { baseUrl, creditBudget, cacheTtlSeconds, timeoutMs } = loadClientSettings(env);
      return new CmcClient({
        ...{ baseUrl, creditBudget, cacheTtlSeconds, timeoutMs },
        maxRetries: 0,
        cache: new MemoryCache(),
        ...options,
        // Never sent anywhere: the replay transport ignores the request headers.
        apiKey: MASK,
        transport: replayTransport(FixtureIndex.load(mode.dir)),
      });
    }
  }
}
