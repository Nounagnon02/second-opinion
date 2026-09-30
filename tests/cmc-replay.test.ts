import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ENDPOINTS } from '../src/cmc/endpoints.js';
import { CmcError } from '../src/cmc/errors.js';
import type { RecordedExchange } from '../src/cmc/fixtures.js';
import { parseKeyInfo } from '../src/cmc/key-info.js';
import { createClientForMode } from '../src/cmc/mode.js';
import { FixtureIndex } from '../src/cmc/replay.js';
import { projectRoot } from './helpers/endpoints-doc.js';

const DISCOVERY = join(projectRoot, 'fixtures', 'discovery');

function recorded(label: string): RecordedExchange {
  return JSON.parse(readFileSync(join(DISCOVERY, `${label}.json`), 'utf8')) as RecordedExchange;
}

function replayClient(dir = DISCOVERY, env: Record<string, string> = {}) {
  return createClientForMode({ kind: 'replay', dir }, env);
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
  const dir = mkdtempSync(join(tmpdir(), 'so-replay-'));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Writes a copy of a discovery fixture, changed by `edit`, as `<dir>/<name>`. */
function writeVariant(dir: string, name: string, label: string, edit: (exchange: RecordedExchange) => void): void {
  const exchange = recorded(label);
  edit(exchange);
  writeFileSync(join(dir, name), JSON.stringify(exchange));
}

describe('replay mode', () => {
  it('answers from the recorded fixture, without network or API key, whatever the parameter order', async () => {
    const client = replayClient();
    const response = await client.get('E02', { id: '1,4705', convert: 'USD' });
    const fixture = recorded('E02-quotes-latest-btc-paxg');

    expect(response.body).toEqual(fixture.response.body);
    expect(response).toMatchObject({
      endpoint: 'E02',
      httpStatus: 200,
      attempts: 1,
      fromCache: false,
      latencyMs: 1184,
      receivedAt: fixture.recordedAt,
      fixture: {
        file: 'fixtures/discovery/E02-quotes-latest-btc-paxg.json',
        recordedAt: fixture.recordedAt,
        latencyMs: 1184,
      },
    });
    expect(response.status.timestamp).toBe('2026-09-24T16:04:03.419Z');
    expect(client.credits()).toMatchObject({ charged: 1, unconfirmed: 0, requests: 1 });
  });

  it('gives the same answer on every run', async () => {
    const first = await replayClient().get('E14', { rwa_id: 1 });
    const second = await replayClient().get('E14', { rwa_id: 1 });
    expect(second).toEqual(first);
  });

  it('serves a repeated request of the run from its cache', async () => {
    const client = replayClient();
    await client.get('E06', { id: '1,4705', include_last_updated: true });
    const again = await client.get('E06', { include_last_updated: true, id: '1,4705' });
    expect(again.fromCache).toBe(true);
    expect(again.fixture?.file).toBe('fixtures/discovery/E06-simple-price-btc-paxg.json');
    expect(client.credits()).toMatchObject({ charged: 1, requests: 1 });
  });

  it('replays a recorded refusal as the same error, with its fixture as evidence', async () => {
    const client = replayClient();
    const error = await failure(client.get('E08', { base_asset_ucid: 4705, network_slug: 'ethereum', limit: 10 }));
    expect(error).toMatchObject({ kind: 'api', httpStatus: 400, retryable: false, attempts: 1 });
    expect(error.fixture?.file).toBe('fixtures/discovery/E08-dex-spot-pairs-paxg.json');
    expect(client.credits()).toMatchObject({ charged: 0, unconfirmed: 0 });
  });

  it('fails a request that was never recorded, without counting it', async () => {
    const client = replayClient();
    const error = await failure(client.get('E02', { id: 2 }));
    expect(error).toMatchObject({ kind: 'replay_miss', endpoint: 'E02', retryable: false, attempts: 0 });
    expect(error.message).toContain(`${ENDPOINTS.E02.path}?id=2`);
    expect(error.message).toContain('fixtures/discovery');
    expect(error.message).toContain('--record');
    expect(client.credits()).toMatchObject({ charged: 0, unconfirmed: 0, reserved: 0, requests: 0, remaining: 500 });
  });

  it('uses the latest recording when a request was recorded several times', async () => {
    // E20 was recorded before and after T1.2, and again before T3.4; a replay answers with the last of them.
    const info = await replayClient().keyInfo();
    expect(info).toEqual(parseKeyInfo((recorded('E20-key-info-t34').response.body as { data: unknown }).data));
    const response = await replayClient().get('E20');
    expect(response.fixture?.file).toBe('fixtures/discovery/E20-key-info-t34.json');
  });

  it('breaks a tie on the recording time with the last file name, subdirectories included', async () => {
    const dir = scratch();
    mkdirSync(join(dir, 'b'));
    const setPrice = (price: number) => (exchange: RecordedExchange) => {
      const body = exchange.response.body as { data: { quote: { price: number }[] }[] };
      const [asset] = body.data;
      const [quote] = asset?.quote ?? [];
      if (quote) quote.price = price;
    };
    writeVariant(dir, 'a.json', 'E02-quotes-latest-btc-paxg', setPrice(1));
    writeVariant(join(dir, 'b'), 'a.json', 'E02-quotes-latest-btc-paxg', setPrice(2));

    const response = await replayClient(dir).get('E02', { id: '1,4705', convert: 'USD' });
    expect((response.data as { quote: { price: number }[] }[])[0]?.quote[0]?.price).toBe(2);
    expect(response.fixture?.file).toBe(join(dir, 'b', 'a.json'));
  });

  it('does not retry a recorded server error: it would only repeat itself', async () => {
    const dir = scratch();
    writeVariant(dir, 'e02-500.json', 'E02-quotes-latest-btc-paxg', (exchange) => {
      exchange.response.status = 500;
      exchange.response.body = '<html>Internal Server Error</html>';
    });
    const error = await failure(replayClient(dir).get('E02', { id: '1,4705', convert: 'USD' }));
    expect(error).toMatchObject({ kind: 'api', httpStatus: 500, retryable: true, attempts: 1 });
  });

  it('applies the credit budget of the environment, as a live run would', async () => {
    const client = replayClient(DISCOVERY, { CMC_CREDIT_BUDGET: '0' });
    expect((await failure(client.get('E02', { id: '1,4705', convert: 'USD' }))).kind).toBe('budget');
    expect((await client.get('E01', { symbol: 'BTC,PAXG' })).httpStatus).toBe(200);
  });
});

describe('FixtureIndex', () => {
  it('indexes every recorded exchange of the discovery directory', () => {
    const names = readdirSync(DISCOVERY).filter((file) => file.endsWith('.json'));
    const index = FixtureIndex.load(DISCOVERY);
    expect(index.files).toBe(names.length);
    // E20 takes no parameter, so its recordings are all the same request: one entry, however many files.
    const keyInfo = names.filter((file) => file.startsWith('E20-')).length;
    expect(keyInfo).toBeGreaterThan(1);
    expect(index.size).toBe(names.length - (keyInfo - 1));
  });

  it('refuses a missing directory', () => {
    expect(() => FixtureIndex.load(join(scratch(), 'missing'))).toThrow(/fixture directory not found/);
  });

  it('refuses a JSON file that is not a recorded exchange, and names it', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'other.json'), '{"foo":1}');
    expect(() => FixtureIndex.load(dir)).toThrow(/other\.json is not a recorded exchange: no request or response/);

    writeFileSync(join(dir, 'other.json'), '{not json');
    expect(() => FixtureIndex.load(dir)).toThrow(/other\.json is not a recorded exchange/);

    writeVariant(dir, 'other.json', 'E02-quotes-latest-btc-paxg', (exchange) => {
      exchange.recordedAt = 'yesterday';
    });
    expect(() => FixtureIndex.load(dir)).toThrow(/no valid recordedAt/);
  });

  it('ignores files that are not JSON', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'README.md'), '# notes');
    writeVariant(dir, 'e14.json', 'E14-rwa-quotes-gold', () => undefined);
    expect(FixtureIndex.load(dir).files).toBe(1);
    expect((await replayClient(dir).get('E14', { rwa_id: 1 })).httpStatus).toBe(200);
  });
});
