import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CACHE_DIR, DEFAULTS, loadClientConfig } from '../src/cmc/config.js';
import { CmcError } from '../src/cmc/errors.js';
import { projectRoot } from './helpers/endpoints-doc.js';

// Not key-shaped (neither 32 hex digits nor a UUID): the secret scan has nothing to flag in this file.
const API_KEY = 'unit-test-key-not-a-real-secret';

/** The `NAME=value` lines of .env.example, as `node --env-file` would load them. */
function envExample(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(projectRoot, '.env.example'), 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match?.[1]) env[match[1]] = match[2] ?? '';
  }
  return env;
}

const DEFAULT_CONFIG = {
  apiKey: API_KEY,
  baseUrl: DEFAULTS.baseUrl,
  creditBudget: DEFAULTS.creditBudget,
  cacheTtlSeconds: DEFAULTS.cacheTtlSeconds,
  timeoutMs: DEFAULTS.timeoutMs,
  maxRetries: DEFAULTS.maxRetries,
  cacheDir: DEFAULT_CACHE_DIR,
};

describe('loadClientConfig', () => {
  it('uses the defaults when only the key is set', () => {
    expect(loadClientConfig({ CMC_API_KEY: API_KEY })).toEqual(DEFAULT_CONFIG);
  });

  it('gets the defaults from a copy of .env.example with the key filled in', () => {
    expect(loadClientConfig({ ...envExample(), CMC_API_KEY: API_KEY })).toEqual(DEFAULT_CONFIG);
  });

  it('refuses a copy of .env.example whose key was left empty', () => {
    expect(() => loadClientConfig(envExample())).toThrow(/CMC_API_KEY is not set/);
  });

  it('reads every setting, trimmed', () => {
    const config = loadClientConfig({
      CMC_API_KEY: ` ${API_KEY} `,
      CMC_BASE_URL: 'https://sandbox.test',
      CMC_CREDIT_BUDGET: '0',
      CACHE_TTL_SECONDS: ' 60 ',
      CACHE_STATIC_TTL_SECONDS: '0',
      CMC_TIMEOUT_MS: '2500',
      CMC_MAX_RETRIES: '0',
      CMC_CACHE_DIR: '/tmp/so-cache',
    });
    expect(config).toEqual({
      apiKey: API_KEY,
      baseUrl: 'https://sandbox.test',
      creditBudget: 0,
      cacheTtlSeconds: { market: 60, static: 0 },
      timeoutMs: 2500,
      maxRetries: 0,
      cacheDir: '/tmp/so-cache',
    });
  });

  it.each([
    ['CMC_CREDIT_BUDGET', '-1'],
    ['CMC_CREDIT_BUDGET', '1.5'],
    ['CACHE_TTL_SECONDS', 'five'],
    ['CMC_TIMEOUT_MS', '0'],
    ['CMC_MAX_RETRIES', '1e3'],
  ])('rejects %s=%s, naming the variable but never the key', (name, value) => {
    let error: unknown;
    try {
      loadClientConfig({ CMC_API_KEY: API_KEY, [name]: value });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CmcError);
    expect((error as CmcError).kind).toBe('config');
    expect((error as CmcError).message).toContain(name);
    expect((error as CmcError).message).not.toContain(API_KEY);
  });

  it('rejects a base URL that is not a URL', () => {
    expect(() => loadClientConfig({ CMC_API_KEY: API_KEY, CMC_BASE_URL: 'not a url' })).toThrow(/CMC_BASE_URL/);
  });
});
