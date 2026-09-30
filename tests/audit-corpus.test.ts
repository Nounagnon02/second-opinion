/**
 * Reading the recorded corpus (T6.1): what an audit run counts, and what it refuses to count as the same thing.
 *
 * Three distinctions carry the whole report and are tested here: a request is not a *question* (the parameter
 * values matter for one and not for the other), an answer the API refused is not an answer it accepted, and a
 * recording made during a paced run does not measure the same interval as one made on its own.
 *
 * Every exchange below is written here, in the shape `src/cmc/recorder.ts` writes: the point is what the reader
 * does with a shape, and a synthetic corpus can hold the shapes a real one happens not to.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  corpusCredits,
  endpointCorpora,
  latencyOf,
  readCorpus,
  readEntry,
  readStatus,
  requestOf,
  requestShape,
  succeeded,
  type Corpus,
  type CorpusEntry,
  type CorpusPart,
} from '../src/audit/corpus.js';
import { CmcError } from '../src/cmc/errors.js';

const scratches: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'second-opinion-audit-corpus-'));
  scratches.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface ExchangeParts {
  label: string;
  path: string;
  query?: Record<string, string>;
  status?: number;
  latencyMs?: number;
  body?: unknown;
  recordedAt?: string;
}

/** A recorded exchange, in the shape `src/cmc/recorder.ts` writes. The key is masked, as it always is. */
function exchange(parts: ExchangeParts): string {
  const query = parts.query ?? {};
  const search = new URLSearchParams(query).toString();
  return JSON.stringify({
    label: parts.label,
    recordedAt: parts.recordedAt ?? '2026-09-24T16:00:00.000Z',
    request: {
      method: 'GET',
      url: `https://pro-api.coinmarketcap.com${parts.path}${search === '' ? '' : `?${search}`}`,
      path: parts.path,
      query,
      headers: { 'X-CMC_PRO_API_KEY': '***' },
    },
    response: {
      status: parts.status ?? 200,
      statusText: 'OK',
      latencyMs: parts.latencyMs ?? 100,
      headers: {},
      body: parts.body ?? { status: { error_code: '0', credit_count: 1, timestamp: '2026-09-24T16:00:00.000Z' } },
    },
  });
}

/** Writes exchanges into a fresh directory and returns it as one capture. */
function capture(name: string, files: Record<string, string>, paced = false): CorpusPart {
  const dir = scratch();
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text, 'utf8');
  return { name, dir, description: `the ${name} capture`, paced };
}

/** One entry, read back from a file written for the occasion. */
function entryOf(parts: ExchangeParts): CorpusEntry {
  const file = join(scratch(), 'one.json');
  writeFileSync(file, exchange(parts), 'utf8');
  const read = readEntry(file, 'one');
  if ('reason' in read) throw new Error(`the exchange was not read: ${read.reason}`);
  return read;
}

describe('requestShape and requestOf', () => {
  it('reads two calls with the same parameter names as the same question', () => {
    expect(requestShape('/v2/simple/price', { id: '1' })).toBe(requestShape('/v2/simple/price', { id: '4705' }));
  });

  it('reads two calls with different values as different requests', () => {
    expect(requestOf('/v2/simple/price', { id: '1' })).not.toBe(requestOf('/v2/simple/price', { id: '4705' }));
  });

  it('ignores the order the parameters were written in', () => {
    expect(requestOf('/v1/dex/token/price', { platform: 'ethereum', address: '0xab' })).toBe(
      requestOf('/v1/dex/token/price', { address: '0xab', platform: 'ethereum' }),
    );
  });
});

describe('readStatus', () => {
  it('keeps the type the error code arrived as, not only its value', () => {
    expect(readStatus({ status: { error_code: 0 } })?.errorCodeType).toBe('number');
    expect(readStatus({ status: { error_code: '0' } })?.errorCodeType).toBe('string');
  });

  it('reads the two shapes to the same value', () => {
    expect(readStatus({ status: { error_code: 0 } })?.errorCode).toBe('0');
    expect(readStatus({ status: { error_code: '0' } })?.errorCode).toBe('0');
  });

  it('reports the notice field of the number-shaped block', () => {
    expect(readStatus({ status: { error_code: 0, notice: null } })?.hasNotice).toBe(true);
    expect(readStatus({ status: { error_code: '0' } })?.hasNotice).toBe(false);
  });

  it('is null for a body carrying no status block', () => {
    expect(readStatus('an HTML error page')).toBeNull();
  });
});

describe('succeeded', () => {
  it('accepts HTTP 200 with the error code 0', () => {
    expect(succeeded(entryOf({ label: 'E02', path: '/v3/cryptocurrency/quotes/latest' }))).toBe(true);
  });

  it('refuses an answer carrying an error code, whatever its HTTP status', () => {
    const refused = (http: number, code: string): CorpusEntry =>
      entryOf({
        label: 'E02',
        path: '/v3/cryptocurrency/quotes/latest',
        status: http,
        body: { status: { error_code: code } },
      });
    expect(succeeded(refused(200, '1006'))).toBe(false);
    expect(succeeded(refused(500, '500'))).toBe(false);
  });
});

describe('readCorpus', () => {
  it('names the capture every answer came from', () => {
    const corpus = readCorpus([
      capture('one', { 'a.json': exchange({ label: 'E02', path: '/v3/cryptocurrency/quotes/latest' }) }),
      capture('two', { 'b.json': exchange({ label: 'E06', path: '/v2/simple/price' }) }, true),
    ]);
    expect(corpus.entries.map((entry) => entry.part)).toEqual(['one', 'two']);
    expect(corpus.parts.map((part) => [part.name, part.answers, part.paced])).toEqual([
      ['one', 1, false],
      ['two', 1, true],
    ]);
  });

  it('leaves a file that is not a recorded exchange out, with the reason', () => {
    const corpus = readCorpus([
      capture('one', {
        'good.json': exchange({ label: 'E02', path: '/v3/cryptocurrency/quotes/latest' }),
        'bad.json': '{ not json',
        'other.json': JSON.stringify({ hello: 'world' }),
      }),
    ]);
    expect(corpus.entries).toHaveLength(1);
    expect(corpus.skipped).toHaveLength(2);
    expect(corpus.skipped.map((skip) => skip.reason)).toContain('no request or response object');
  });

  it('marks a path outside the verified inventory rather than dropping it', () => {
    const corpus = readCorpus([
      capture('one', { 'a.json': exchange({ label: 'E04', path: '/v2/cryptocurrency/market-pairs/latest' }) }),
    ]);
    expect(corpus.entries[0]?.endpoint).toBeNull();
    expect(corpus.entries[0]?.path).toBe('/v2/cryptocurrency/market-pairs/latest');
  });

  it('refuses a directory that is not there', () => {
    expect(() =>
      readCorpus([{ name: 'gone', dir: join(scratch(), 'nowhere'), description: 'none', paced: false }]),
    ).toThrow(CmcError);
  });
});

describe('endpointCorpora', () => {
  const refusal = { status: { error_code: '500', error_message: 'The system is busy', credit_count: 0 } };
  const accepted = { status: { error_code: '0', credit_count: 1 } };
  const paxg = { platform: 'ethereum', address: '0xab' };

  /** One accepted answer recorded on its own, and three refusals over two requests during a paced walk. */
  function corpus(): Corpus {
    return readCorpus([
      capture('discovery', {
        'a.json': exchange({
          label: 'E10-a',
          path: '/v1/dex/token/price',
          query: paxg,
          body: accepted,
          latencyMs: 400,
        }),
      }),
      capture(
        'calibration',
        {
          'b.json': exchange({ label: 'E10-b1', path: '/v1/dex/token/price', query: paxg, status: 500, body: refusal, latencyMs: 9000 }),
          'c.json': exchange({ label: 'E10-b2', path: '/v1/dex/token/price', query: paxg, status: 500, body: refusal, latencyMs: 9000 }),
          'd.json': exchange({
            label: 'E10-c1',
            path: '/v1/dex/token/price',
            query: { platform: 'ethereum', address: '0xcd' },
            status: 500,
            body: refusal,
            latencyMs: 9000,
          }),
        },
        true,
      ),
    ]);
  }

  it('counts distinct requests behind the answers, not the files', () => {
    const [endpoint] = endpointCorpora(corpus());
    expect(endpoint?.errors[0]?.answers).toBe(3);
    expect(endpoint?.errors[0]?.requests).toBe(2);
  });

  it('reads the credit cost from the accepted answers only', () => {
    const [endpoint] = endpointCorpora(corpus());
    expect(endpoint?.answers).toBe(4);
    expect(endpoint?.accepted).toBe(1);
    expect(endpoint?.credits.map((observed) => observed.value)).toEqual([1]);
  });

  it('measures the unpaced captures apart from the paced ones', () => {
    const [endpoint] = endpointCorpora(corpus());
    expect(endpoint?.unpacedLatency?.maxMs).toBe(400);
    expect(endpoint?.latency.maxMs).toBe(9000);
  });

  it('reports no unpaced latency when every answer came from a paced run', () => {
    const [endpoint] = endpointCorpora(
      readCorpus([capture('calibration', { 'a.json': exchange({ label: 'E10', path: '/v1/dex/token/price' }) }, true)]),
    );
    expect(endpoint?.unpacedLatency).toBeNull();
  });
});

describe('latencyOf', () => {
  it('is all zeros for no answer at all', () => {
    expect(latencyOf([])).toMatchObject({ answers: 0, minMs: 0, medianMs: 0, maxMs: 0 });
  });
});

describe('corpusCredits', () => {
  it('sums what the answers reported and counts those that reported nothing', () => {
    const totals = corpusCredits(
      readCorpus([
        capture('one', {
          'a.json': exchange({ label: 'E02', path: '/v3/cryptocurrency/quotes/latest' }),
          'b.json': exchange({ label: 'E02', path: '/v3/cryptocurrency/quotes/latest', body: 'an HTML page' }),
        }),
      ]),
    );
    expect(totals).toEqual({ reported: 1, answers: 2, withoutCount: 1 });
  });
});
