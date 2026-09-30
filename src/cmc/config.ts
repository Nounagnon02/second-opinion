/**
 * Client settings, read from the environment (.env, see .env.example). The API key is required and never printed,
 * except in replay mode, which never sends a request.
 * An empty variable means "use the default", so a fresh copy of .env.example only needs the key.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CmcError } from './errors.js';

/** The file that marks the project root: every run needs the thresholds, so nothing works without it. */
const ROOT_MARKER = 'config/checks.json';

/**
 * Where `config/`, `fixtures/`, `docs/` and `.cache/` are, found in three steps.
 *
 * Step two is the one that answers on every command and every test: this file sits at `<root>/src/cmc` or
 * `<root>/dist/cmc`, so its own directory gives the root. Step three exists because a bundler may inline this
 * module into a server build, where `import.meta.dirname` is gone and the data files sit beside the working
 * directory instead — the web interface of F8 deploys exactly that way. Step one lets a deployment that matches
 * neither say where the files are.
 */
function locateProjectRoot(): string {
  const named = process.env.SECOND_OPINION_ROOT?.trim();
  if (named !== undefined && named !== '') return resolve(named);

  const here = import.meta.dirname as string | undefined;
  if (here !== undefined) return resolve(here, '..', '..');

  // `process.cwd()` is already absolute, and is left unresolved on purpose: a bundler that sees `resolve()` or
  // `join()` around it reads the walk as dynamic filesystem access and traces the whole repository into the
  // deployment.
  const from = process.cwd();
  let directory = from;
  for (;;) {
    if (existsSync(`${directory}/${ROOT_MARKER}`)) return directory;
    const parent = dirname(directory);
    if (parent === directory) return from;
    directory = parent;
  }
}

/** The project root, from src/cmc or dist/cmc alike. */
export const PROJECT_ROOT = locateProjectRoot();
export const DEFAULT_CACHE_DIR = join(PROJECT_ROOT, '.cache', 'cmc');
/** Where `--replay` looks for fixtures (every subdirectory included), and where `--record` writes them. */
export const DEFAULT_FIXTURE_DIR = join(PROJECT_ROOT, 'fixtures');
export const DEFAULT_RECORD_DIR = join(DEFAULT_FIXTURE_DIR, 'recorded');

export const DEFAULTS = {
  baseUrl: 'https://pro-api.coinmarketcap.com',
  creditBudget: 500,
  cacheTtlSeconds: { market: 300, static: 86_400 },
  // E03 took 5.9 s and E10 5.1 s in T1.2 (docs/ENDPOINTS.md, observation 14).
  timeoutMs: 8_000,
  maxRetries: 2,
} as const;

export interface ClientConfig {
  apiKey: string;
  baseUrl: string;
  /** Maximum credits one run may consume. */
  creditBudget: number;
  /** Cache lifetime in seconds per cache class; 0 turns the cache off for that class. */
  cacheTtlSeconds: { market: number; static: number };
  /** Timeout of one attempt, in milliseconds. */
  timeoutMs: number;
  /** Attempts after the first one, for retryable failures only. */
  maxRetries: number;
  cacheDir: string;
}

type Env = Readonly<Record<string, string | undefined>>;

function readInteger(env: Env, name: string, fallback: number, min: number): number {
  const raw = env[name]?.trim() ?? '';
  if (raw === '') return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min) {
    throw new CmcError('config', `${name} must be an integer >= ${min}, got "${raw}".`);
  }
  return Number(raw);
}

export function loadClientConfig(env: Env = process.env): ClientConfig {
  const apiKey = env.CMC_API_KEY?.trim() ?? '';
  if (apiKey === '') {
    throw new CmcError('config', 'CMC_API_KEY is not set: copy .env.example to .env and put the key there.');
  }
  return { apiKey, ...loadClientSettings(env) };
}

/** Every setting but the key: what a replay run needs. */
export function loadClientSettings(env: Env = process.env): Omit<ClientConfig, 'apiKey'> {
  const baseUrl = env.CMC_BASE_URL?.trim() || DEFAULTS.baseUrl;
  if (!URL.canParse(baseUrl)) throw new CmcError('config', `CMC_BASE_URL is not a valid URL: "${baseUrl}".`);
  return {
    baseUrl,
    creditBudget: readInteger(env, 'CMC_CREDIT_BUDGET', DEFAULTS.creditBudget, 0),
    cacheTtlSeconds: {
      market: readInteger(env, 'CACHE_TTL_SECONDS', DEFAULTS.cacheTtlSeconds.market, 0),
      static: readInteger(env, 'CACHE_STATIC_TTL_SECONDS', DEFAULTS.cacheTtlSeconds.static, 0),
    },
    timeoutMs: readInteger(env, 'CMC_TIMEOUT_MS', DEFAULTS.timeoutMs, 1),
    maxRetries: readInteger(env, 'CMC_MAX_RETRIES', DEFAULTS.maxRetries, 0),
    cacheDir: env.CMC_CACHE_DIR?.trim() || DEFAULT_CACHE_DIR,
  };
}
