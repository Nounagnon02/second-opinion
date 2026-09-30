import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MASK, maskSecret, parseBody, serializeExchange, type RecordedExchange } from '../src/cmc/fixtures.js';

const projectRoot = resolve(import.meta.dirname, '..');
const fixturesRoot = join(projectRoot, 'fixtures');

// A fake key assembled at runtime so this file never contains a literal that the secret scan would flag.
const FAKE_KEY = ['0badc0de', 'dead', 'beef', 'f00d', '0123456789ab'].join('');
const KEY_HEADER = ['X', 'CMC_PRO_API_KEY'].join('-');
// Same rule as scripts/check-secrets.sh: a key-shaped value assigned to a CMC key name.
const KEY_PATTERN = /CMC(_PRO)?_API_KEY["']?\s*[:=]\s*["']?([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-)/i;

function exchangeWith(body: unknown, url: string): RecordedExchange {
  return {
    label: 'sample',
    recordedAt: '2026-01-01T00:00:00.000Z',
    request: { method: 'GET', url, path: '/sample', query: {}, headers: { [KEY_HEADER]: MASK } },
    response: { status: 200, statusText: 'OK', latencyMs: 1, headers: {}, body },
  };
}

function listJsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listJsonFiles(path);
    return entry.name.endsWith('.json') ? [path] : [];
  });
}

describe('maskSecret', () => {
  it('replaces every occurrence of the secret', () => {
    expect(maskSecret(`a ${FAKE_KEY} b ${FAKE_KEY}`, FAKE_KEY)).toBe(`a ${MASK} b ${MASK}`);
  });

  it('refuses a secret too short to be masked safely', () => {
    expect(() => maskSecret('some text', 'short')).toThrow(/shorter than 16/);
  });
});

describe('serializeExchange', () => {
  it('masks the secret wherever the API echoed it, and ends with a newline', () => {
    const text = serializeExchange(
      exchangeWith({ echo: `key=${FAKE_KEY}` }, `https://example.test/?key=${FAKE_KEY}`),
      FAKE_KEY,
    );
    expect(text).not.toContain(FAKE_KEY);
    expect(text.endsWith('}\n')).toBe(true);
    const parsed = JSON.parse(text) as RecordedExchange;
    expect(parsed.response.body).toEqual({ echo: `key=${MASK}` });
    expect(parsed.request.url).toBe(`https://example.test/?key=${MASK}`);
  });
});

describe('parseBody', () => {
  it('parses JSON bodies', () => {
    expect(parseBody('{"status":{"error_code":0}}')).toEqual({ status: { error_code: 0 } });
  });

  it('keeps non-JSON bodies as text', () => {
    expect(parseBody('<html>Bad gateway</html>')).toBe('<html>Bad gateway</html>');
    expect(parseBody('')).toBe('');
  });
});

describe('recorded fixtures', () => {
  const files = listJsonFiles(fixturesRoot);

  it('exist', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('never carry an API key', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(KEY_PATTERN.test(text), file).toBe(false);
      const exchange = JSON.parse(text) as RecordedExchange;
      expect(exchange.request.headers[KEY_HEADER], file).toBe(MASK);
    }
  });
});
