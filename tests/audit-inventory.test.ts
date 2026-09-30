/**
 * Reading `docs/ENDPOINTS.md` back (T6.1): the baseline the audit compares the recorded answers with (D8).
 *
 * The risk this file guards against is one specific mistake, and it was made before it was caught: three rows of
 * the field table say "the same fields as E02, **without** `is_active` and `is_fiat`". A reader that only
 * collects backticked names reads those two as fields the row *lists*, and then reports the API for not sending
 * them — a finding that is exactly backwards. So the two prose forms those rows use are pinned here on a table
 * written for the purpose, and then checked against the real file.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readEndpointRows, readFieldInventory, type FieldInventory } from '../src/audit/inventory.js';

const scratches: string[] = [];

/** A markdown file holding `text`, to read an inventory out of. */
function markdown(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'second-opinion-audit-inventory-'));
  scratches.push(dir);
  const file = join(dir, 'ENDPOINTS.md');
  writeFileSync(file, text, 'utf8');
  return file;
}

afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TABLE = [
  '| ID | Request parameters used | Response fields of interest (observed) |',
  '|---|---|---|',
  '| E02 | `id`, `convert=USD` | `data[]`: `id`, `symbol`, `is_active`; `quote[]`: `price` |',
  '| E03 | `start`, `limit` | Same as E02, without `is_active` and `is_fiat` |',
  '| E16 | `limit` | same aggregate fields as E14, without `tokens`; `data.total_size`, `data.has_more` |',
  '',
  'Some prose after the table, which ends it.',
  '',
  '| E99 | `x` | `not_a_row_of_that_table` |',
].join('\n');

describe('readFieldInventory', () => {
  const inventory = readFieldInventory(markdown(TABLE));
  const of = (id: string): FieldInventory | undefined => inventory.find((row) => row.endpoint === id);

  it('reads the names a row states directly', () => {
    // `data[]` and `quote[]` are read like any other token: the last path segment, with `[]` stripped.
    expect(of('E02')?.names).toEqual(['data', 'id', 'is_active', 'price', 'quote', 'symbol']);
    expect(of('E02')?.reference).toBeNull();
  });

  it('reads a name behind `without` as absent, never as listed', () => {
    expect(of('E03')?.absent).toEqual(['is_active', 'is_fiat']);
    expect(of('E03')?.names).toEqual([]);
  });

  it('does not resolve a row stated by reference to another endpoint', () => {
    expect(of('E03')?.reference).toBe('E02');
    expect(of('E16')?.reference).toBe('E14');
  });

  it('ends a `without` clause at the next semicolon', () => {
    expect(of('E16')?.absent).toEqual(['tokens']);
  });

  it('stops at the end of the table', () => {
    expect(of('E99')).toBeUndefined();
  });

  it('leaves request parameters and placeholders out of the names', () => {
    const [one] = readFieldInventory(
      markdown(
        [
          '| ID | Request parameters used | Response fields of interest (observed) |',
          '|---|---|---|',
          '| E05 | `id` | `data.<id>`: `symbol`, `quote_asset_*`, `include_last_updated=true` |',
        ].join('\n'),
      ),
    );
    expect(one?.names).toEqual(['symbol']);
  });
});

describe('the committed docs/ENDPOINTS.md', () => {
  const rows = readEndpointRows();
  const inventory = readFieldInventory();

  it('holds a well-formed status row for every endpoint of the inventory', () => {
    expect(rows.length).toBeGreaterThanOrEqual(21);
    for (const row of rows) {
      expect(row.id).toMatch(/^E\d{2}$/);
      expect(row.path).toMatch(/^\/v\d\//);
      expect(['verified', 'refused']).toContain(row.status);
    }
  });

  it('records which endpoints were refused, which is what the audit reports a refusal against', () => {
    expect(rows.filter((row) => row.status === 'refused').map((row) => row.id)).toEqual(['E04', 'E12', 'E15', 'E21']);
  });

  it('states the fields of E03, E09 and E16 by reference, and every other verified endpoint directly', () => {
    expect(inventory.filter((row) => row.reference !== null).map((row) => row.endpoint)).toEqual([
      'E03',
      'E09',
      'E16',
    ]);
    for (const row of inventory.filter((one) => one.reference === null)) {
      expect(row.names.length).toBeGreaterThan(0);
    }
  });

  it('reads the fields it records as absent for the three rows that name any', () => {
    const absent = Object.fromEntries(
      inventory.filter((row) => row.absent.length > 0).map((row) => [row.endpoint, row.absent]),
    );
    expect(absent).toEqual({
      E03: ['is_active', 'is_fiat'],
      E09: ['scroll_id'],
      E16: ['tokens', 'tradfi_markets'],
    });
  });
});
