/**
 * Record mode (T2.2): a live run whose every answer is also written to a fixture, key masked, so the run can be
 * replayed offline and each finding can cite the raw response that proves it.
 * No network here either: the "live" side is a scripted transport replaying the T1.2 fixtures.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileCache } from '../src/cmc/cache.js';
import { createClientFromEnv } from '../src/cmc/client.js';
import { DEFAULTS } from '../src/cmc/config.js';
import { ENDPOINTS } from '../src/cmc/endpoints.js';
import { CmcError } from '../src/cmc/errors.js';
import { KEY_HEADER, MASK, MIN_SECRET_LENGTH, type RecordedExchange } from '../src/cmc/fixtures.js';
import { createClientForMode } from '../src/cmc/mode.js';
import { fixtureLabel, recordingTransport } from '../src/cmc/recorder.js';
import { projectRoot } from './helpers/endpoints-doc.js';
import { fixtureResponse, scriptedTransport, statusBlock } from './helpers/transport.js';

/** Not a real key: long enough to be masked, and nothing a secret scanner would match. */
const KEY = 'test-key-not-a-real-one';
const ENV = { CMC_API_KEY: KEY };
const RECORDED_AT = '2026-09-25T10:00:00.000Z';

function recorded(label: string): RecordedExchange {
  return JSON.parse(readFileSync(join(projectRoot, 'fixtures', 'discovery', `${label}.json`), 'utf8')) as RecordedExchange;
}

function written(dir: string, name: string): RecordedExchange {
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as RecordedExchange;
}

async function failure(promise: Promise<unknown>): Promise<CmcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CmcError) return error;
    throw error;
  }
  throw new Error('Expected a CmcError.');
}

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'so-record-'));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The URL the client builds for an endpoint, so a test can predict the fixture name. */
function requestUrl(endpoint: keyof typeof ENDPOINTS, query: Record<string, string>): URL {
  const url = new URL(ENDPOINTS[endpoint].path, DEFAULTS.baseUrl);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return url;
}

describe('record mode', () => {
  it('writes one fixture per answer, with the key masked and the request beside it', async () => {
    const dir = scratch();
    const query = { id: '1,4705', convert: 'USD' };
    const network = scriptedTransport(fixtureResponse('E02-quotes-latest-btc-paxg'));
    const client = createClientForMode({ kind: 'record', dir }, ENV, { network, now: () => Date.parse(RECORDED_AT) });

    const response = await client.get('E02', query);

    const name = `${fixtureLabel(requestUrl('E02', query), RECORDED_AT)}.json`;
    expect(readdirSync(dir)).toEqual([name]);
    const text = readFileSync(join(dir, name), 'utf8');
    expect(text).not.toContain(KEY);
    expect(text.endsWith('\n')).toBe(true);

    const exchange = written(dir, name);
    expect(exchange.label).toBe(name.replace(/\.json$/, ''));
    expect(exchange.recordedAt).toBe(RECORDED_AT);
    expect(exchange.request).toMatchObject({
      method: 'GET',
      path: ENDPOINTS.E02.path,
      query: { id: '1,4705', convert: 'USD' },
      headers: { [KEY_HEADER]: MASK },
    });
    expect(exchange.response.status).toBe(200);
    expect(exchange.response.body).toEqual(recorded('E02-quotes-latest-btc-paxg').response.body);
    expect(response.fixture).toEqual({ file: join(dir, name), recordedAt: RECORDED_AT, latencyMs: exchange.response.latencyMs });
    expect(client.credits()).toMatchObject({ charged: 1, unconfirmed: 0 });
  });

  it('records a refusal too: a rejected call is evidence as well', async () => {
    const dir = scratch();
    const query = { base_asset_ucid: '4705', network_slug: 'ethereum', limit: '10' };
    const network = scriptedTransport(fixtureResponse('E08-dex-spot-pairs-paxg'));
    const client = createClientForMode({ kind: 'record', dir }, ENV, { network, now: () => Date.parse(RECORDED_AT) });

    const error = await failure(client.get('E08', query));

    const name = `${fixtureLabel(requestUrl('E08', query), RECORDED_AT)}.json`;
    expect(error).toMatchObject({ kind: 'api', httpStatus: 400, attempts: 1 });
    expect(error.fixture?.file).toBe(join(dir, name));
    expect(written(dir, name).response.status).toBe(400);
  });

  it('writes nothing when no answer came back', async () => {
    const dir = scratch();
    const network = scriptedTransport(new Error('socket hang up'));
    const client = createClientForMode({ kind: 'record', dir }, ENV, { network, maxRetries: 0 });

    expect((await failure(client.get('E01', { symbol: 'BTC,PAXG' }))).kind).toBe('network');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('never overwrites a fixture: the same request recorded twice keeps both answers', async () => {
    const dir = scratch();
    const query = { rwa_id: '1' };
    const now = () => Date.parse(RECORDED_AT);
    const run = () =>
      createClientForMode({ kind: 'record', dir }, ENV, {
        network: scriptedTransport(fixtureResponse('E14-rwa-quotes-gold')),
        now,
      }).get('E14', query);

    await run();
    await run();

    const label = fixtureLabel(requestUrl('E14', query), RECORDED_AT);
    expect(readdirSync(dir).sort()).toEqual([`${label}-2.json`, `${label}.json`].sort());
  });

  it('ignores the cache of earlier runs, which would leave no fixture behind', async () => {
    const dir = scratch();
    const cacheDir = scratch();
    const query = { symbol: 'BTC,PAXG' };
    const url = requestUrl('E01', query).toString();
    const env = { ...ENV, CMC_CACHE_DIR: cacheDir };
    // What a previous live run would have left behind for this exact request.
    new FileCache(cacheDir).set(url, {
      storedAt: Date.now(),
      response: {
        url,
        httpStatus: 200,
        statusText: 'OK',
        headers: {},
        body: { status: statusBlock(0), data: [] },
        latencyMs: 1,
        receivedAt: RECORDED_AT,
      },
    });

    const live = await createClientFromEnv(env, { transport: scriptedTransport(new Error('not called')) }).get('E01', query);
    expect(live.fromCache).toBe(true);

    const network = scriptedTransport(fixtureResponse('E01-map-btc-paxg'));
    const recordRun = await createClientForMode({ kind: 'record', dir }, env, { network }).get('E01', query);
    expect(recordRun.fromCache).toBe(false);
    expect(network.requests).toHaveLength(1);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('replays what it recorded, value for value', async () => {
    const dir = scratch();
    const query = { id: '1,4705', convert: 'USD' };
    const network = scriptedTransport(fixtureResponse('E02-quotes-latest-btc-paxg'));

    const recordRun = await createClientForMode({ kind: 'record', dir }, ENV, { network }).get('E02', query);
    // No key, and the parameters written the other way round: the fixture still answers.
    const replayRun = await createClientForMode({ kind: 'replay', dir }, {}).get('E02', { convert: 'USD', id: '1,4705' });

    expect(replayRun).toEqual(recordRun);
  });

  it('refuses a key too short to be masked safely', () => {
    const dir = scratch();
    const network = scriptedTransport(fixtureResponse('E01-map-btc-paxg'));
    expect(() => recordingTransport(network, { dir, secret: 'short' })).toThrow(
      new RegExp(`shorter than ${MIN_SECRET_LENGTH} characters`),
    );
    expect(() => createClientForMode({ kind: 'record', dir }, { CMC_API_KEY: 'short' }, { network })).toThrow(CmcError);
  });

  it('counts the credits of a paid call whose fixture could not be written, and says where', async () => {
    const blocked = join(scratch(), 'a-file');
    writeFileSync(blocked, 'not a directory');
    const network = scriptedTransport(fixtureResponse('E02-quotes-latest-btc-paxg'));
    const client = createClientForMode({ kind: 'record', dir: join(blocked, 'sub') }, ENV, { network, maxRetries: 0 });

    const error = await failure(client.get('E02', { id: '1,4705', convert: 'USD' }));

    expect(error.kind).toBe('record');
    expect(error.message).toContain('E02');
    expect(error.message).toContain(join(blocked, 'sub'));
    expect(error.message).not.toContain(KEY);
    expect(client.credits()).toMatchObject({ charged: 1, unconfirmed: 0 });
  });
});

describe('fixtureLabel', () => {
  it('names a fixture after its endpoint, its request and the time it was recorded', () => {
    const label = fixtureLabel(requestUrl('E02', { id: '1', convert: 'USD' }), RECORDED_AT);
    expect(label).toMatch(/^E02-[0-9a-f]{8}-20260925T100000000Z$/);
  });

  it('gives the same name to the same request whatever the parameter order, and another to another request', () => {
    const one = fixtureLabel(requestUrl('E02', { id: '1', convert: 'USD' }), RECORDED_AT);
    const same = fixtureLabel(requestUrl('E02', { convert: 'USD', id: '1' }), RECORDED_AT);
    const other = fixtureLabel(requestUrl('E02', { id: '2', convert: 'USD' }), RECORDED_AT);
    expect(same).toBe(one);
    expect(other).not.toBe(one);
  });

  it('marks a path that is not a verified endpoint', () => {
    const url = new URL(['', 'v9', 'sample', 'latest'].join('/'), DEFAULTS.baseUrl);
    expect(fixtureLabel(url, RECORDED_AT)).toMatch(/^X-[0-9a-f]{8}-/);
  });
});
