import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileCache } from '../src/cmc/cache.js';
import { CmcClient, createClientFromEnv, KEY_HEADER, type CmcClientOptions } from '../src/cmc/client.js';
import { ENDPOINTS } from '../src/cmc/endpoints.js';
import { CmcError } from '../src/cmc/errors.js';
import { fixtureResponse, jsonResponse, scriptedTransport, statusBlock, type Step } from './helpers/transport.js';

// Not key-shaped (neither 32 hex digits nor a UUID): the secret scan has nothing to flag in this file.
const API_KEY = 'unit-test-key-not-a-real-secret';
const BASE_URL = 'https://cmc.test';
const E02_OK = fixtureResponse('E02-quotes-latest-btc-paxg');
const SERVER_ERROR = jsonResponse(500, { status: statusBlock(500, 'Internal Server Error') });

type TestOptions = Partial<Omit<CmcClientOptions, 'apiKey' | 'transport'>>;

/** A client on scripted answers, with instant sleeps recorded in `delays` and a clock moved by `advance`. */
function setup(steps: Step[], options: TestOptions = {}) {
  const transport = scriptedTransport(...steps);
  const delays: number[] = [];
  let clock = Date.parse('2026-09-24T16:05:00.000Z');
  const client = new CmcClient({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    transport,
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    random: () => 1,
    now: () => clock,
    ...options,
  });
  const advance = (ms: number): void => {
    clock += ms;
  };
  return { client, transport, delays, advance };
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
  const dir = mkdtempSync(join(tmpdir(), 'so-cache-'));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('CmcClient: successful calls', () => {
  it('sends the key in the header only and returns the parsed answer', async () => {
    const { client, transport } = setup([E02_OK]);
    const response = await client.get('E02', { id: '1,4705', convert: 'USD' });

    const [request] = transport.requests;
    expect(request?.headers[KEY_HEADER]).toBe(API_KEY);
    expect(request?.url.toString()).toBe(`${BASE_URL}${ENDPOINTS.E02.path}?convert=USD&id=1%2C4705`);
    expect(request?.url.toString()).not.toContain(API_KEY);

    expect(response).toMatchObject({
      endpoint: 'E02',
      query: { convert: 'USD', id: '1,4705' },
      httpStatus: 200,
      attempts: 1,
      fromCache: false,
    });
    expect(response.status).toEqual({
      timestamp: '2026-09-24T16:04:03.419Z',
      errorCode: 0,
      errorMessage: null,
      elapsed: 4,
      creditCount: 1,
      notice: null,
    });
    const paxg = (response.data as { id: number; quote: { price: number }[] }[]).find((item) => item.id === 4705);
    expect(paxg?.quote[0]?.price).toBe(4253.226063661451);
    expect(client.credits()).toEqual({
      budget: 500,
      charged: 1,
      unconfirmed: 0,
      reserved: 0,
      remaining: 499,
      requests: 1,
      byEndpoint: { E02: 1 },
    });
  });

  it('accepts the numeric shape of the status block and counts a free call as free', async () => {
    const { client } = setup([fixtureResponse('E01-map-btc-paxg')]);
    const response = await client.get('E01', { symbol: 'BTC,PAXG' });
    expect(response.status).toMatchObject({ errorCode: 0, errorMessage: null, creditCount: 0 });
    expect(client.credits()).toMatchObject({ charged: 0, requests: 1, byEndpoint: { E01: 0 } });
  });
});

describe('CmcClient: cache', () => {
  it('serves a repeated call from the cache, whatever the parameter order', async () => {
    const { client, transport } = setup([E02_OK]);
    await client.get('E02', { id: '1,4705', convert: 'USD' });
    const second = await client.get('E02', { convert: 'USD', id: '1,4705' });
    expect(second).toMatchObject({ fromCache: true, attempts: 0 });
    expect(second.status.timestamp).toBe('2026-09-24T16:04:03.419Z');
    expect(transport.requests).toHaveLength(1);
    expect(client.credits()).toMatchObject({ charged: 1, requests: 1 });
  });

  it('calls again once the market TTL has passed', async () => {
    const { client, transport, advance } = setup([E02_OK], { cacheTtlSeconds: { market: 300, static: 86_400 } });
    await client.get('E02', { id: 1 });
    advance(300_000);
    expect((await client.get('E02', { id: 1 })).fromCache).toBe(true);
    advance(1);
    expect((await client.get('E02', { id: 1 })).fromCache).toBe(false);
    expect(transport.requests).toHaveLength(2);
  });

  it('keeps identifiers and metadata for the static TTL', async () => {
    const { client, transport, advance } = setup([fixtureResponse('E01-map-btc-paxg')], {
      cacheTtlSeconds: { market: 300, static: 86_400 },
    });
    await client.get('E01', { symbol: 'BTC,PAXG' });
    advance(301_000);
    expect((await client.get('E01', { symbol: 'BTC,PAXG' })).fromCache).toBe(true);
    advance(86_400_000);
    expect((await client.get('E01', { symbol: 'BTC,PAXG' })).fromCache).toBe(false);
    expect(transport.requests).toHaveLength(2);
  });

  it('never caches the key usage counter', async () => {
    const { client, transport } = setup([fixtureResponse('E20-key-info-before')]);
    await client.keyInfo();
    await client.keyInfo();
    expect(transport.requests).toHaveLength(2);
  });

  it('turns the cache off with a TTL of 0', async () => {
    const { client, transport } = setup([E02_OK], { cacheTtlSeconds: { market: 0, static: 0 } });
    await client.get('E02', { id: 1 });
    await client.get('E02', { id: 1 });
    expect(transport.requests).toHaveLength(2);
  });

  it('does not cache failures', async () => {
    const { client, transport } = setup([SERVER_ERROR, E02_OK], { maxRetries: 0 });
    await failure(client.get('E02', { id: 1 }));
    expect((await client.get('E02', { id: 1 })).fromCache).toBe(false);
    expect((await client.get('E02', { id: 1 })).fromCache).toBe(true);
    expect(transport.requests).toHaveLength(2);
  });

  it('shares answers between runs through the file cache, without ever storing the key', async () => {
    const dir = scratch();
    const first = setup([E02_OK], { cache: new FileCache(dir) });
    await first.client.get('E02', { id: '1,4705', convert: 'USD' });

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{32}\.json$/);
    expect(readFileSync(join(dir, files[0] ?? ''), 'utf8')).not.toContain(API_KEY);

    // A new run: no scripted answer, so any network call would fail.
    const second = setup([], { cache: new FileCache(dir) });
    const response = await second.client.get('E02', { convert: 'USD', id: '1,4705' });
    expect(response.fromCache).toBe(true);
    expect(second.transport.requests).toHaveLength(0);
    expect(second.client.credits().charged).toBe(0);
  });

  it('treats an unreadable cache file as a miss', async () => {
    const dir = scratch();
    await setup([E02_OK], { cache: new FileCache(dir) }).client.get('E02', { id: 1 });
    for (const file of readdirSync(dir)) writeFileSync(join(dir, file), '{ not json');

    const next = setup([E02_OK], { cache: new FileCache(dir) });
    expect((await next.client.get('E02', { id: 1 })).fromCache).toBe(false);
    expect(next.transport.requests).toHaveLength(1);
  });

  it('keeps an answer when the cache cannot be written', async () => {
    const cache = {
      get: () => undefined,
      set: () => {
        throw new Error('disk full');
      },
    };
    const { client, transport } = setup([E02_OK], { cache });
    expect((await client.get('E02', { id: 1 })).attempts).toBe(1);
    expect(transport.requests).toHaveLength(1);
  });
});

describe('CmcClient: errors and retries', () => {
  it.each([
    ['string', 'E15-rwa-market-pairs-gold'],
    ['numeric', 'E21-exchange-market-pairs-binance-paxg'],
  ])('reports a plan refusal (403 / 1006, %s error_code) without retrying', async (_shape, label) => {
    const { client, transport } = setup([fixtureResponse(label)]);
    const error = await failure(client.get('E14', { rwa_id: 1 }));
    expect(error).toMatchObject({ kind: 'api', endpoint: 'E14', httpStatus: 403, retryable: false, attempts: 1 });
    expect(error.status?.errorCode).toBe(1006);
    expect(error.message).toBe(
      `E14 ${ENDPOINTS.E14.path}: HTTP 403, error_code 1006: Your API Key subscription plan doesn't support this endpoint.`,
    );
    expect(transport.requests).toHaveLength(1);
    expect(client.credits()).toMatchObject({ charged: 0, unconfirmed: 0, reserved: 0 });
  });

  it('reports a parameter error (400) without retrying', async () => {
    const { client, transport } = setup([fixtureResponse('E08-dex-spot-pairs-paxg')]);
    const error = await failure(client.get('E08', { network_slug: 'ethereum' }));
    expect(error).toMatchObject({ kind: 'api', httpStatus: 400, retryable: false, attempts: 1 });
    expect(error.message).toContain('error_code 400: Please provide either a dex id or dex slug.');
    expect(transport.requests).toHaveLength(1);
  });

  it('retries HTTP 5xx with exponential backoff, then gives up', async () => {
    const { client, transport, delays } = setup([SERVER_ERROR], { maxRetries: 2 });
    const error = await failure(client.get('E02', { id: 1 }));
    expect(error).toMatchObject({ kind: 'api', httpStatus: 500, retryable: true, attempts: 3 });
    expect(transport.requests).toHaveLength(3);
    expect(delays).toEqual([500, 1000]);
  });

  it('draws each backoff between half and all of its capped delay', async () => {
    const { client, delays } = setup([SERVER_ERROR], {
      maxRetries: 3,
      random: () => 0,
      retryDelayMs: { base: 500, max: 800 },
    });
    await failure(client.get('E02', { id: 1 }));
    expect(delays).toEqual([250, 400, 400]);
  });

  it('returns the answer of a successful retry', async () => {
    const { client } = setup([SERVER_ERROR, E02_OK]);
    const response = await client.get('E02', { id: 1 });
    expect(response.attempts).toBe(2);
    expect(client.credits()).toMatchObject({ charged: 1, requests: 2, unconfirmed: 0 });
  });

  it.each([
    [1008, true],
    [1011, true],
    [1009, false],
    [1010, false],
  ])('treats HTTP 429 with error_code %i as retryable: %s', async (code, retryable) => {
    const { client, transport } = setup([jsonResponse(429, { status: statusBlock(code, 'rate limit') })]);
    const error = await failure(client.get('E02', { id: 1 }));
    expect(error).toMatchObject({ kind: 'api', httpStatus: 429, retryable });
    expect(transport.requests).toHaveLength(retryable ? 3 : 1);
  });

  it('retries a network failure, counts its unknown cost, and never leaks the key', async () => {
    const { client, transport } = setup([new Error(`connect ECONNREFUSED, sent ${API_KEY}`)]);
    const error = await failure(client.get('E02', { id: 1 }));
    expect(error).toMatchObject({ kind: 'network', retryable: true, attempts: 3 });
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).toContain('***');
    expect(transport.requests).toHaveLength(3);
    expect(client.credits()).toMatchObject({ charged: 0, unconfirmed: 3, reserved: 0, remaining: 497 });
  });

  it('times out a call that does not answer, and aborts it', async () => {
    const { client, transport } = setup(['hang'], { timeoutMs: 20, maxRetries: 1 });
    const error = await failure(client.get('E10', { platform: 'ethereum' }));
    expect(error).toMatchObject({ kind: 'timeout', retryable: true, attempts: 2 });
    expect(error.message).toBe(`E10 ${ENDPOINTS.E10.path}: no answer within 20 ms.`);
    expect(transport.requests.every((request) => request.signal.aborted)).toBe(true);
  });

  it('retries a gateway error page that is not JSON', async () => {
    const gateway: Step = { status: 502, statusText: 'Bad Gateway', headers: {}, text: '<html>502</html>' };
    const { client } = setup([gateway]);
    const error = await failure(client.get('E02', { id: 1 }));
    expect(error).toMatchObject({ kind: 'api', httpStatus: 502, retryable: true, attempts: 3 });
    expect(error.message).toContain('no CMC status block');
    expect(client.credits().unconfirmed).toBe(3);
  });

  it('rejects an HTTP 200 without a status block', async () => {
    const { client, transport } = setup([jsonResponse(200, { data: [] })]);
    const error = await failure(client.get('E02', { id: 1 }));
    expect(error).toMatchObject({ kind: 'invalid_response', httpStatus: 200, retryable: false, attempts: 1 });
    expect(transport.requests).toHaveLength(1);
  });

  it('treats a non-zero error_code as an error even with HTTP 200', async () => {
    const { client } = setup([jsonResponse(200, { status: statusBlock(1002, 'API key missing'), data: null })]);
    const error = await failure(client.get('E02', { id: 1 }));
    expect(error).toMatchObject({ kind: 'api', httpStatus: 200, retryable: false });
    expect(error.status?.errorCode).toBe(1002);
  });

  it('refuses an empty key', () => {
    expect(() => new CmcClient({ apiKey: '  ' })).toThrow(CmcError);
  });
});

describe('CmcClient: credit budget', () => {
  it('refuses a paid call that would exceed the budget, without sending it', async () => {
    const { client, transport } = setup([E02_OK], { creditBudget: 1 });
    await client.get('E02', { id: 1 });
    const error = await failure(client.get('E02', { id: 4705 }));
    expect(error).toMatchObject({ kind: 'budget', endpoint: 'E02', attempts: 0, retryable: false });
    expect(error.message).toContain('CMC_CREDIT_BUDGET');
    expect(transport.requests).toHaveLength(1);
  });

  it('still allows free calls once the budget is spent', async () => {
    const { client, transport } = setup([fixtureResponse('E01-map-btc-paxg')], { creditBudget: 0 });
    await expect(client.get('E01', { symbol: 'BTC,PAXG' })).resolves.toMatchObject({ httpStatus: 200 });
    expect((await failure(client.get('E02', { id: 1 }))).kind).toBe('budget');
    expect(transport.requests).toHaveLength(1);
  });

  it('holds the ceiling for calls made in parallel', async () => {
    const { client, transport } = setup([E02_OK], { creditBudget: 2 });
    const results = await Promise.allSettled([1, 2, 3].map((id) => client.get('E02', { id })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const [refused] = results.filter((result) => result.status === 'rejected');
    expect((refused?.reason as CmcError).kind).toBe('budget');
    expect(transport.requests).toHaveLength(2);
    expect(client.credits()).toMatchObject({ charged: 2, reserved: 0, remaining: 0 });
  });

  it('stops retrying when the budget runs out', async () => {
    const gateway: Step = { status: 502, statusText: 'Bad Gateway', headers: {}, text: '' };
    const { client, transport } = setup([gateway], { creditBudget: 2, maxRetries: 5 });
    const error = await failure(client.get('E02', { id: 1 }));
    expect(error).toMatchObject({ kind: 'budget', attempts: 2 });
    expect(transport.requests).toHaveLength(2);
  });
});

describe('CmcClient.keyInfo', () => {
  it('reads the plan and the usage of the key from E20', async () => {
    const { client } = setup([fixtureResponse('E20-key-info-before'), fixtureResponse('E20-key-info-after')]);
    expect(await client.keyInfo()).toEqual({
      creditLimitMonthly: 15000,
      creditLimitMonthlyResetAt: '2026-10-01T00:00:00.000Z',
      rateLimitMinute: 50,
      requestsLeftMinute: 49,
      creditsUsedDay: 0,
      creditsUsedMonth: 0,
      creditsLeftMonth: 15000,
    });
    expect(await client.keyInfo()).toMatchObject({ creditsUsedMonth: 15, creditsLeftMonth: 14985 });
    expect(client.credits().charged).toBe(0);
  });

  it('rejects an E20 answer without the expected fields', async () => {
    const { client } = setup([jsonResponse(200, { status: statusBlock(0), data: { plan: {} } })]);
    const error = await failure(client.keyInfo());
    expect(error.kind).toBe('invalid_response');
    expect(error.message).toContain('credit_limit_monthly_reset_timestamp');
  });
});

describe('createClientFromEnv', () => {
  it('takes its settings from the environment and caches on disk', async () => {
    const dir = scratch();
    const transport = scriptedTransport(E02_OK);
    const client = createClientFromEnv(
      { CMC_API_KEY: API_KEY, CMC_BASE_URL: BASE_URL, CMC_CREDIT_BUDGET: '3', CMC_CACHE_DIR: dir },
      { transport },
    );
    await client.get('E02', { id: 1 });
    expect(transport.requests[0]?.url.origin).toBe(BASE_URL);
    expect(client.credits()).toMatchObject({ budget: 3, charged: 1 });
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('refuses to start without a key', () => {
    expect(() => createClientFromEnv({})).toThrow(/CMC_API_KEY is not set/);
  });
});
