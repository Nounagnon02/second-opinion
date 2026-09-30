/**
 * What the recorded answers carry, field by field (T6.1).
 *
 * The statements this module lets the report make are all of the form "the same field behaved differently", so
 * the tests are mostly about what must **not** count as a difference: an array of objects is not a field that is
 * sometimes an array and sometimes an object, an answer to another question is not comparable, and a refusal
 * carries no fields at all.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCorpus, type CorpusEntry, type CorpusPart } from '../src/audit/corpus.js';
import {
  compareInventory,
  endpointFields,
  fieldNames,
  fieldsByEndpoint,
  nullFields,
  optionalFields,
  typeVariances,
  walkFields,
} from '../src/audit/fields.js';
import type { FieldInventory } from '../src/audit/inventory.js';

const scratches: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'second-opinion-audit-fields-'));
  scratches.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A recorded exchange carrying `body`, with the key masked as the recorder writes it. */
function exchange(label: string, path: string, query: Record<string, string>, body: unknown, status = 200): string {
  return JSON.stringify({
    label,
    recordedAt: '2026-09-24T16:00:00.000Z',
    request: {
      method: 'GET',
      url: `https://pro-api.coinmarketcap.com${path}`,
      path,
      query,
      headers: { 'X-CMC_PRO_API_KEY': '***' },
    },
    response: { status, statusText: 'OK', latencyMs: 100, headers: {}, body },
  });
}

function capture(files: Record<string, string>): CorpusPart {
  const dir = scratch();
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text, 'utf8');
  return { name: 'one', dir, description: 'a capture', paced: false };
}

/** The entries of one capture built from the given exchanges. */
function entriesOfCapture(files: Record<string, string>): CorpusEntry[] {
  return readCorpus([capture(files)]).entries;
}

describe('walkFields', () => {
  it('collapses array positions, so a hundred pairs describe one field', () => {
    const fields = walkFields({ data: [{ price: 1 }, { price: 2 }, { price: 3 }] });
    expect([...fields.keys()]).toEqual(['data', 'data.price']);
    expect(fields.get('data.price')?.count).toBe(3);
  });

  it('collapses an identifier-keyed map the same way an array collapses', () => {
    const fields = walkFields({ data: { '1': { symbol: 'BTC' }, '4705': { symbol: 'PAXG' } } });
    expect(fields.get('data.symbol')?.count).toBe(2);
  });

  it('does not read an array of objects as a field of two types', () => {
    // Recording the element type under the container's pattern would make every list look like a shape change.
    expect(walkFields({ data: [{ price: 1 }] }).get('data')?.types).toEqual(['array']);
  });

  it('keeps a concrete path, indices included, to find the value again', () => {
    expect(walkFields({ data: [{ quote: [{ price: 1 }] }] }).get('data.quote.price')?.example).toBe(
      'data[0].quote[0].price',
    );
  });

  it('records the type of every value, null included', () => {
    expect(walkFields({ data: { platform: null } }).get('data.platform')?.types).toEqual(['null']);
  });
});

describe('fieldNames', () => {
  it('names every segment of a path', () => {
    expect(fieldNames('data.quote.price')).toEqual(['data', 'quote', 'price']);
  });
});

describe('typeVariances', () => {
  function twoAnswers(first: unknown, second: unknown): CorpusEntry[] {
    return entriesOfCapture({
      'a.json': exchange('E02-a', '/v3/cryptocurrency/quotes/latest', { id: '1' }, first),
      'b.json': exchange('E02-b', '/v3/cryptocurrency/quotes/latest', { id: '2' }, second),
    });
  }

  it('reports a field sent as a number on one answer and a string on another', () => {
    const fields = endpointFields(twoAnswers({ data: { id: 1 } }, { data: { id: '1' } }));
    expect(typeVariances(fields).map((one) => one.field)).toEqual(['data.id']);
  });

  it('does not count null as a type of its own', () => {
    const fields = endpointFields(twoAnswers({ data: { id: 1 } }, { data: { id: null } }));
    expect(typeVariances(fields)).toEqual([]);
  });
});

describe('nullFields', () => {
  it('reports a field observed null, with the answer it was seen in', () => {
    const entries = entriesOfCapture({
      'a.json': exchange('E08', '/v4/dex/spot-pairs/latest', {}, { data: [{ base_asset_id: null }] }),
    });
    const found = nullFields(endpointFields(entries));
    expect(found.map((one) => one.field)).toContain('data.base_asset_id');
    expect(found[0]?.site.path).toBe('data[0].base_asset_id');
  });
});

describe('optionalFields', () => {
  it('reports a field present on one answer to a question and absent from another', () => {
    const found = optionalFields(
      entriesOfCapture({
        'a.json': exchange('E02-a', '/v3/cryptocurrency/quotes/latest', { id: '1' }, { data: [{ platform: { id: 1 } }] }),
        'b.json': exchange('E02-b', '/v3/cryptocurrency/quotes/latest', { id: '2' }, { data: [{}] }),
      }),
    );
    expect(found.map((one) => one.field)).toEqual(['data.platform', 'data.platform.id']);
    expect(found[0]).toMatchObject({ present: 1, answers: 2 });
    expect(found[0]?.without).not.toBe(found[0]?.with.file);
  });

  it('never compares answers to two different questions', () => {
    // E06 adds `last_updated` when asked for it. Comparing the two would read as the API dropping a field.
    const found = optionalFields(
      entriesOfCapture({
        'a.json': exchange(
          'E06-a',
          '/v2/simple/price',
          { id: '1', include_last_updated: 'true' },
          { data: [{ last_updated: 'x' }] },
        ),
        'b.json': exchange('E06-b', '/v2/simple/price', { id: '1' }, { data: [{}] }),
      }),
    );
    expect(found).toEqual([]);
  });

  it('says nothing about a question asked only once', () => {
    const found = optionalFields(
      entriesOfCapture({
        'a.json': exchange('E07', '/v2/tools/price-conversion', { id: '1' }, { data: { price: 1 } }),
      }),
    );
    expect(found).toEqual([]);
  });
});

describe('fieldsByEndpoint', () => {
  it('walks the accepted answers only, so a refusal is not read as every field being absent', () => {
    const corpus = readCorpus([
      capture({
        'a.json': exchange(
          'E10-a',
          '/v1/dex/token/price',
          { address: '0xab' },
          { status: { error_code: '0' }, data: { p: 1 } },
        ),
        'b.json': exchange(
          'E10-b',
          '/v1/dex/token/price',
          { address: '0xcd' },
          { status: { error_code: '500', error_message: 'busy' } },
          500,
        ),
      }),
    ]);
    const [set] = fieldsByEndpoint(corpus);
    expect(set?.entries).toHaveLength(1);
    expect(optionalFields(set?.entries ?? [])).toEqual([]);
    expect(set?.names.has('p')).toBe(true);
  });
});

describe('compareInventory', () => {
  function corpus(): ReturnType<typeof readCorpus> {
    return readCorpus([
      capture({
        'a.json': exchange(
          'E13',
          '/v5/real-world-assets/map',
          { symbol: 'GOLD' },
          { data: { rwa_assets: [{ rwa_id: 1 }] } },
        ),
      }),
    ]);
  }

  const row = (parts: Partial<FieldInventory>): FieldInventory => ({
    endpoint: 'E13',
    names: [],
    absent: [],
    reference: null,
    ...parts,
  });

  it('reports a recorded name that no answer carries', () => {
    const [one] = compareInventory(fieldsByEndpoint(corpus()), [row({ names: ['rwa_id', 'asset_type'] })]);
    expect(one?.compared).toBe(true);
    expect(one?.missing).toEqual(['asset_type']);
  });

  it('reports a name recorded as absent that did arrive', () => {
    const [one] = compareInventory(fieldsByEndpoint(corpus()), [row({ absent: ['rwa_id'] })]);
    expect(one?.unexpected).toEqual(['rwa_id']);
  });

  it('carries a row stated by reference through uncompared rather than guessing at it', () => {
    const [one] = compareInventory(fieldsByEndpoint(corpus()), [row({ reference: 'E14' })]);
    expect(one).toMatchObject({ compared: false, reference: 'E14', missing: [], listed: 0 });
  });

  it('says nothing about an endpoint the corpus holds no answer for', () => {
    expect(compareInventory(fieldsByEndpoint(corpus()), [row({ endpoint: 'E17', names: ['cik'] })])).toEqual([]);
  });
});
