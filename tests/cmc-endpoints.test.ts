import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENDPOINTS, type EndpointId } from '../src/cmc/endpoints.js';
import { projectRoot, readFixture, readInventory, succeeded } from './helpers/endpoints-doc.js';

const ids = Object.keys(ENDPOINTS) as EndpointId[];
const fixtures = readdirSync(join(projectRoot, 'fixtures', 'discovery'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => readFixture(file.replace(/\.json$/, '')));

describe('ENDPOINTS', () => {
  it('holds exactly the verified endpoints of docs/ENDPOINTS.md, with their paths', () => {
    const verified = readInventory().filter((row) => row.status === 'verified');
    expect(ids.slice().sort()).toEqual(verified.map((row) => row.id).sort());
    for (const row of verified) {
      expect(ENDPOINTS[row.id as EndpointId].path, row.id).toBe(row.path);
    }
  });

  it('expects the credit cost that every successful fixture reported', () => {
    for (const id of ids) {
      const calls = fixtures.filter((fixture) => fixture.request.path === ENDPOINTS[id].path && succeeded(fixture));
      expect(calls.length, `${id} fixtures`).toBeGreaterThan(0);
      for (const call of calls) expect(call.response.body.status?.credit_count, id).toBe(ENDPOINTS[id].credits);
    }
  });

  it('caches identifiers and metadata long (D1: E01, E05, E13) and never caches the key counter (E20)', () => {
    const byClass = (cache: string) => ids.filter((id) => ENDPOINTS[id].cache === cache);
    expect(byClass('static')).toEqual(['E01', 'E05', 'E13']);
    expect(byClass('none')).toEqual(['E20']);
  });
});
