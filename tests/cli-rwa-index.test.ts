/**
 * The `rwa-index` command (T3.4): it builds the token to real-world-asset index, caches it, and says what the walk
 * cost. Exercised offline, through a scripted transport and a scratch cache file.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRwaIndexArgs, runRwaIndex } from '../src/cli/rwa-index.js';
import { MemoryCache } from '../src/cmc/cache.js';
import type { Transport, TransportResponse } from '../src/cmc/client.js';
import { DEFAULT_FIXTURE_DIR } from '../src/cmc/config.js';
import type { ModeOverrides } from '../src/cmc/mode.js';
import type { RecordedExchange } from '../src/cmc/fixtures.js';
import { DEFAULT_INDEX_FILE } from '../src/rwa/wrapper-index.js';
import { projectRoot } from './helpers/endpoints-doc.js';

const KEY = 'test-key-not-a-real-one';
const ENV = { CMC_API_KEY: KEY };

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'so-rwa-cli-'));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function recordedBody(label: string): unknown {
  const file = join(projectRoot, 'fixtures', 'discovery', `${label}.json`);
  return (JSON.parse(readFileSync(file, 'utf8')) as RecordedExchange).response.body;
}

/**
 * The overrides every run below uses: the scripted network, and a cache of its own. A run sharing the project's
 * file cache would serve one test's bodies to the next, and would leave test answers where a live run reads.
 */
function run(network: Transport): ModeOverrides {
  return { network, cache: new MemoryCache() };
}

function answer(body: unknown): TransportResponse {
  return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, text: JSON.stringify(body) };
}

/** A walk over the one recorded issuer whose token page holds a single wrapper: Paxos, and PAXG under it. */
function paxosWalk(): Transport & { calls: () => number } {
  const issuers = recordedBody('E18-rwa-issuers-list') as {
    data: { issuers: { name: string }[]; total_size: number };
  };
  issuers.data.issuers = issuers.data.issuers.filter((issuer) => issuer.name === 'Paxos');
  issuers.data.total_size = 1;
  let calls = 0;
  const transport: Transport = (request) => {
    calls += 1;
    const oneIssuer = request.url.searchParams.has('issuer_id');
    return Promise.resolve(answer(oneIssuer ? recordedBody('E19-rwa-issuer-paxos') : issuers));
  };
  return Object.assign(transport, { calls: () => calls });
}

describe('parseRwaIndexArgs', () => {
  it('builds into the cache under .cache by default, live, with no symbol', () => {
    expect(parseRwaIndexArgs([])).toEqual({
      symbol: null,
      build: false,
      pageSize: null,
      file: DEFAULT_INDEX_FILE,
      mode: { kind: 'live' },
    });
  });

  it('reads the symbol, the flags and the run mode in any order', () => {
    expect(parseRwaIndexArgs(['--build', 'PAXG', '--page-size=50', '--replay'])).toEqual({
      symbol: 'PAXG',
      build: true,
      pageSize: 50,
      file: DEFAULT_INDEX_FILE,
      mode: { kind: 'replay', dir: DEFAULT_FIXTURE_DIR },
    });
  });

  it('resolves a relative cache file against the working directory', () => {
    expect(parseRwaIndexArgs(['--file=out/index.json'], '/tmp/work').file).toBe('/tmp/work/out/index.json');
  });

  it('refuses what it cannot act on, rather than falling back to a default', () => {
    expect(() => parseRwaIndexArgs(['--page-size=many'])).toThrow(/page size must be a whole number/);
    expect(() => parseRwaIndexArgs(['--page-size=2.5'])).toThrow(/page size must be a whole number/);
    expect(() => parseRwaIndexArgs(['--file='])).toThrow(/file path is empty/);
    expect(() => parseRwaIndexArgs(['--rebuild'])).toThrow(/Unknown option "--rebuild"/);
    expect(() => parseRwaIndexArgs(['PAXG', 'XAUt'])).toThrow(/One symbol at a time/);
  });
});

describe('runRwaIndex', () => {
  it('builds the index when there is none, caches it, and reports what the walk cost', async () => {
    const file = join(scratch(), 'rwa', 'wrapper-index.json');
    const transport = paxosWalk();
    const { ok, lines } = await runRwaIndex(parseRwaIndexArgs([`--file=${file}`]), ENV, run(transport));

    expect(ok).toBe(true);
    expect(transport.calls()).toBe(2);
    expect(lines).toContain('2 request(s), 2 credit(s) reported by the answers.');
    expect(lines).toContain('1 wrapper(s) in the index.');
    expect(lines.at(-1)).toBe(`Built and cached in ${file}.`);
    expect(existsSync(file)).toBe(true);
  });

  it('reads the cached index on the next run, and spends nothing', async () => {
    const file = join(scratch(), 'wrapper-index.json');
    await runRwaIndex(parseRwaIndexArgs([`--file=${file}`]), ENV, run(paxosWalk()));

    const second = paxosWalk();
    const { lines } = await runRwaIndex(parseRwaIndexArgs([`--file=${file}`]), ENV, run(second));
    expect(second.calls()).toBe(0);
    expect(lines.at(-1)).toBe(`Read from ${file}; run with --build to walk the API again.`);
  });

  it('walks again when asked to, whatever the cache holds', async () => {
    const file = join(scratch(), 'wrapper-index.json');
    await runRwaIndex(parseRwaIndexArgs([`--file=${file}`]), ENV, run(paxosWalk()));

    const again = paxosWalk();
    const { lines } = await runRwaIndex(parseRwaIndexArgs(['--build', `--file=${file}`]), ENV, run(again));
    expect(again.calls()).toBe(2);
    expect(lines.at(-1)).toBe(`Built and cached in ${file}.`);
  });

  it('says which real-world asset a wrapper wraps, and through which issuer', async () => {
    const file = join(scratch(), 'wrapper-index.json');
    const { lines } = await runRwaIndex(parseRwaIndexArgs(['PAXG', `--file=${file}`]), ENV, run(paxosWalk()));
    expect(lines.at(-1)).toBe('PAXG: CMC 4705 wraps rwa_id 1, issued by Paxos.');
  });

  it('says a symbol is outside the index rather than leaving the caller to guess', async () => {
    const file = join(scratch(), 'wrapper-index.json');
    const { ok, lines } = await runRwaIndex(parseRwaIndexArgs(['BTC', `--file=${file}`]), ENV, run(paxosWalk()));
    expect(ok).toBe(true);
    expect(lines.at(-1)).toContain('BTC: not in the index');
    expect(lines.at(-1)).toContain('rather than a tokenised wrapper');
  });

  it('reports a failed walk as a message, and caches nothing', async () => {
    const file = join(scratch(), 'wrapper-index.json');
    const refusing: Transport = () =>
      Promise.resolve({ status: 401, statusText: 'Unauthorized', headers: {}, text: '{}' });
    const { ok, lines } = await runRwaIndex(parseRwaIndexArgs([`--file=${file}`]), ENV, run(refusing));
    expect(ok).toBe(false);
    expect(lines[0]?.startsWith('❌')).toBe(true);
    expect(lines.join(' ')).not.toContain(KEY);
    expect(existsSync(file)).toBe(false);
  });
});
