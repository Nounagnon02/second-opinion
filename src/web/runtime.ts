/**
 * The engine, as one web request reaches it (specification F8).
 *
 * A page never builds a client itself: it asks here for a runtime, and gets the same `ToolContext` the MCP tools
 * of T5.1 answer from — the same client, the same thresholds, the same wrapper index. The interface therefore
 * shows what the agent would see, not a second opinion on the second opinion.
 *
 * Two things are handled here that a command line does not have to think about:
 * - **the wrapper index (D6).** Building it costs a walk of the RWA issuers, 8.3 s of a 10-second budget, so it
 *   is never built inside a request. A cached one is read from disk; failing that it is rebuilt once per process
 *   from the recorded walk in `fixtures/rwa-index`, held in memory and reused. A deployment whose filesystem is
 *   read-only — Vercel's is, outside `/tmp` — therefore still answers C5;
 * - **the configuration.** `config/checks.json` is read once per process rather than once per request;
 * - **where the response cache may be written.** The commands cache under `.cache/cmc` in the repository, which
 *   a serverless deployment cannot write to; a live interface caches under the system temporary directory
 *   instead, so a repeated question still costs no credit. `CMC_CACHE_DIR` overrides it as it does everywhere
 *   else, and a replay uses no disk cache at all — it is reading recorded files already.
 *
 * The wrapper index is the only thing built here, and it is built in memory: nothing under the repository is
 * written, and nothing here prints the key.
 */
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCache } from '../cmc/cache.js';
import { createClientForMode, type ModeOverrides } from '../cmc/mode.js';
import { loadChecksConfig, type ChecksConfig } from '../checks/config.js';
import type { ToolContext } from '../mcp/tools.js';
import { buildWrapperIndex, loadWrapperIndex, type WrapperIndex } from '../rwa/wrapper-index.js';
import { readWebSettings, RWA_INDEX_FIXTURES, type Env, type WebSettings } from './settings.js';

/** What a page holds for the length of one request. */
export interface WebRuntime {
  /** What the MCP tools answer from, so the page and the agent read the same engine. */
  context: ToolContext;
  /** The thresholds this runtime scored with, which the view reads to explain each limit. */
  config: ChecksConfig;
  settings: WebSettings;
  /** Where the wrapper index came from, or why there is none, in one sentence (D6). */
  indexNote: string;
}

export interface RuntimeOptions {
  /** Passed to the client, which is how a test supplies a transport without touching the network. */
  overrides?: ModeOverrides;
  /** The thresholds; `config/checks.json` by default, read once per process. */
  config?: ChecksConfig;
  /** The index to use, bypassing both the cache file and the recorded walk. `null` means "run without one". */
  wrapperIndex?: WrapperIndex | null;
}

/**
 * Where the interface caches answers when nothing says otherwise: writable on a serverless host, unlike the
 * `.cache/cmc` of the commands, and shared by every request of the process.
 */
export const DEFAULT_WEB_CACHE_DIR = join(tmpdir(), 'second-opinion', 'cmc');

/** The cache directory of a deployment: what it asked for, or the writable default. */
export function webCacheDir(env: Env): string {
  return env.CMC_CACHE_DIR?.trim() || DEFAULT_WEB_CACHE_DIR;
}

/** `config/checks.json`, read once per process rather than once per request. */
let configCache: ChecksConfig | null = null;

/** The index of each cache file, built at most once per process (see the header). */
const indexCache = new Map<string, Promise<{ index: WrapperIndex | null; note: string }>>();

/** Forgets both caches. Tests call it so that one case never inherits another's index or thresholds. */
export function resetRuntimeCaches(): void {
  configCache = null;
  indexCache.clear();
}

/** The thresholds, read once. */
export function webChecksConfig(config?: ChecksConfig): ChecksConfig {
  if (config !== undefined) return config;
  configCache ??= loadChecksConfig();
  return configCache;
}

/**
 * The cached index, or one rebuilt offline from the recorded walk, or none.
 *
 * A missing index is not an error: C5 comes back `not_applicable` with the reason, which is what D6 asks for
 * rather than a guess at which real-world asset a token wraps.
 */
async function readWrapperIndex(settings: WebSettings): Promise<{ index: WrapperIndex | null; note: string }> {
  const cached = loadWrapperIndex(settings.indexFile);
  if (cached !== null) {
    return {
      index: cached,
      note: `Wrapper index: cached at ${settings.indexFile}, built ${cached.builtAt}, ${String(cached.entries.length)} wrapper(s).`,
    };
  }
  if (!existsSync(RWA_INDEX_FIXTURES)) {
    return {
      index: null,
      note:
        `Wrapper index: none. No cache at ${settings.indexFile} and no recorded walk at ${RWA_INDEX_FIXTURES}, ` +
        'so C5 reports that it has no link to read rather than guessing at one (D6).',
    };
  }
  // The recorded walk replays offline: no key, no request, no credit.
  const client = createClientForMode({ kind: 'replay', dir: RWA_INDEX_FIXTURES }, { CMC_API_KEY: '' });
  const index = await buildWrapperIndex(client);
  return {
    index,
    note:
      `Wrapper index: rebuilt in memory from the recorded walk in ${RWA_INDEX_FIXTURES} — answers of ` +
      `${index.builtAt}, ${String(index.entries.length)} wrapper(s), 0 credit spent.`,
  };
}

/** The index this process serves, built at most once whatever the number of requests. */
export async function webWrapperIndex(settings: WebSettings): Promise<{ index: WrapperIndex | null; note: string }> {
  const key = `${settings.indexFile}|${RWA_INDEX_FIXTURES}`;
  let pending = indexCache.get(key);
  if (pending === undefined) {
    pending = readWrapperIndex(settings);
    indexCache.set(key, pending);
  }
  try {
    return await pending;
  } catch (error) {
    // A failed build must not poison the process: the next request tries again.
    indexCache.delete(key);
    throw error;
  }
}

/**
 * The runtime of one request.
 *
 * Throws a `CmcError` when the environment is not serviceable — no key in live mode, a key under a
 * `NEXT_PUBLIC_` name — which is what the page turns into its own error state rather than a stack trace.
 */
export async function createWebRuntime(env: Env = process.env, options: RuntimeOptions = {}): Promise<WebRuntime> {
  const settings = readWebSettings(env);
  const config = webChecksConfig(options.config);
  // A disk cache only where there is something to save: a replay reads recorded files already, and caching
  // them again would put a second, staler copy of the same answers on disk.
  const cache = settings.mode.kind === 'live' ? { cache: new FileCache(webCacheDir(env)) } : {};
  const client = createClientForMode(settings.mode, env, { ...cache, ...options.overrides });

  const supplied = Object.hasOwn(options, 'wrapperIndex');
  const { index, note } = supplied
    ? { index: options.wrapperIndex ?? null, note: 'Wrapper index: supplied by the caller.' }
    : await webWrapperIndex(settings);

  return {
    context: { client, config, assess: { wrapperIndex: index } },
    config,
    settings,
    indexNote: note,
  };
}
