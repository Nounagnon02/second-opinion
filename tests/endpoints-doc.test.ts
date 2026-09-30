import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRoot, readFixture, readInventory, succeeded } from './helpers/endpoints-doc.js';

const STATUSES = ['to verify', 'verified', 'refused'] as const;
const CHECK_IDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
// A CMC API path such as /v3/cryptocurrency/quotes/latest.
const API_PATH = /\/v\d\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*/g;

interface ResultRow {
  id: string;
  status: string;
  httpAndCode: string;
  credits: string;
  latency: string;
  fixtures: string[];
}

/** Parses the "T1.2 results" table: `| E01 | verified | 200 / `0` | 1 | 864 ms | `label`, ... | notes |`. */
function readResults(): ResultRow[] {
  const doc = readFileSync(join(projectRoot, 'docs', 'ENDPOINTS.md'), 'utf8');
  const rows: ResultRow[] = [];
  for (const line of doc.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (!/^E\d{2}$/.test(cells[1] ?? '') || !STATUSES.some((status) => status === cells[2])) continue;
    rows.push({
      id: cells[1] ?? '',
      status: cells[2] ?? '',
      httpAndCode: cells[3] ?? '',
      credits: cells[4] ?? '',
      latency: cells[5] ?? '',
      fixtures: [...(cells[6] ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ''),
    });
  }
  return rows;
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('docs/ENDPOINTS.md', () => {
  const rows = readInventory();

  it('lists candidate endpoints with unique IDs and paths', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => `${row.method} ${row.path}`)).size).toBe(rows.length);
  });

  it('gives every endpoint a known status', () => {
    for (const row of rows) {
      expect(STATUSES, `${row.id} status`).toContain(row.status);
    }
  });

  it('maps every check C1 to C7 to at least one endpoint', () => {
    for (const check of CHECK_IDS) {
      const sources = rows.filter((row) => new RegExp(`\\b${check}\\b`).test(row.checks));
      expect(sources.length, `${check} sources`).toBeGreaterThan(0);
    }
  });

  it('backs every verified or refused endpoint with a T1.2 result row', () => {
    const results = new Map(readResults().map((row) => [row.id, row]));
    for (const row of rows.filter((candidate) => candidate.status !== 'to verify')) {
      expect(results.get(row.id)?.status, `${row.id} result`).toBe(row.status);
    }
    expect(results.size).toBe(rows.filter((row) => row.status !== 'to verify').length);
  });

  it('matches every T1.2 result with its recorded fixtures', () => {
    const paths = new Map(rows.map((row) => [row.id, row.path]));
    for (const result of readResults()) {
      expect(result.fixtures.length, `${result.id} fixtures`).toBeGreaterThan(0);
      const fixtures = result.fixtures.map(readFixture);
      for (const fixture of fixtures) expect(fixture.request.path, result.id).toBe(paths.get(result.id));

      const [first] = fixtures;
      if (!first) continue;
      const status = first.response.body.status;
      expect(result.httpAndCode, result.id).toBe(`${first.response.status} / \`${JSON.stringify(status?.error_code)}\``);
      expect(result.credits, result.id).toBe(String(status?.credit_count));
      expect(result.latency, result.id).toBe(`${first.response.latencyMs} ms`);
      if (result.status === 'verified') expect(succeeded(first), `${result.id} succeeded`).toBe(true);
      else expect(fixtures.some(succeeded), `${result.id} has a successful call`).toBe(false);
    }
  });

  it('is the only way into the code: src/ uses verified endpoints only', () => {
    const verified = new Set(rows.filter((row) => row.status === 'verified').map((row) => row.path));
    for (const file of listSourceFiles(join(projectRoot, 'src'))) {
      for (const [path] of readFileSync(file, 'utf8').matchAll(API_PATH)) {
        expect(verified, `${path} used in ${file}`).toContain(path);
      }
    }
  });
});
