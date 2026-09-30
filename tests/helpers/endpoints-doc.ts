import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const projectRoot = resolve(import.meta.dirname, '..', '..');

export interface InventoryRow {
  id: string;
  method: string;
  path: string;
  checks: string;
  status: string;
}

/** Parses the inventory tables of docs/ENDPOINTS.md: `| E01 | `GET /path` | ... | checks | status |`. */
export function readInventory(): InventoryRow[] {
  const doc = readFileSync(join(projectRoot, 'docs', 'ENDPOINTS.md'), 'utf8');
  const rows: InventoryRow[] = [];
  for (const line of doc.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    // Leading and trailing pipes give empty first and last cells.
    const endpoint = /^`(GET|POST) (\/v\d\/[^`]+)`$/.exec(cells[2] ?? '');
    if (!/^E\d{2}$/.test(cells[1] ?? '') || !endpoint || cells.length < 6) continue;
    rows.push({
      id: cells[1] ?? '',
      method: endpoint[1] ?? '',
      path: endpoint[2] ?? '',
      checks: cells[cells.length - 3] ?? '',
      status: cells[cells.length - 2] ?? '',
    });
  }
  return rows;
}

export interface Fixture {
  request: { path: string };
  response: {
    status: number;
    latencyMs: number;
    body: { status?: { error_code?: number | string; credit_count?: number } };
  };
}

export function readFixture(label: string): Fixture {
  return JSON.parse(readFileSync(join(projectRoot, 'fixtures', 'discovery', `${label}.json`), 'utf8')) as Fixture;
}

export function succeeded(fixture: Fixture): boolean {
  return fixture.response.status === 200 && Number(fixture.response.body.status?.error_code) === 0;
}
