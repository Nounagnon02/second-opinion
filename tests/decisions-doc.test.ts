import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRoot, readFixture, readInventory, succeeded } from './helpers/endpoints-doc.js';

const DECISIONS = ['kept', 'adapted', 'unavailable'] as const;
const CHECK_IDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
// A fixture label such as E14-rwa-quotes-gold, always cited between backticks.
const FIXTURE_LABEL = /`(E\d{2}-[a-z0-9-]+)`/g;

const doc = readFileSync(join(projectRoot, 'docs', 'DECISIONS.md'), 'utf8');

function cellsOf(line: string): string[] {
  return line.split('|').map((cell) => cell.trim());
}

function endpointIds(cell: string): string[] {
  return [...cell.matchAll(/\bE\d{2}\b/g)].map((match) => match[0]);
}

function fixtureLabels(text: string): string[] {
  return [...text.matchAll(FIXTURE_LABEL)].map((match) => match[1] ?? '');
}

interface SummaryRow {
  check: string;
  decision: string;
  sources: string;
  evidence: string[];
}

/** Parses the summary table: `| C1 | adapted | E02, E05, E10 | `label`, ... |`. */
function readSummary(): SummaryRow[] {
  return doc.split('\n').flatMap((line) => {
    const cells = cellsOf(line);
    if (!/^C\d$/.test(cells[1] ?? '') || cells.length !== 6) return [];
    return [
      {
        check: cells[1] ?? '',
        decision: cells[2] ?? '',
        sources: cells[3] ?? '',
        evidence: fixtureLabels(cells[4] ?? ''),
      },
    ];
  });
}

describe('docs/DECISIONS.md', () => {
  const inventory = new Map(readInventory().map((row) => [row.id, row]));
  const summary = readSummary();

  it('decides every check C1 to C7 once, with a known decision', () => {
    expect(summary.map((row) => row.check)).toEqual(CHECK_IDS);
    for (const row of summary) expect(DECISIONS, `${row.check} decision`).toContain(row.decision);
  });

  it('feeds every check that can run from verified endpoints only', () => {
    for (const row of summary) {
      if (row.decision === 'unavailable') {
        expect(row.sources, `${row.check} sources`).toBe('none');
        continue;
      }
      const sources = endpointIds(row.sources);
      expect(sources.length, `${row.check} sources`).toBeGreaterThan(0);
      for (const id of sources) expect(inventory.get(id)?.status, `${row.check} source ${id}`).toBe('verified');
    }
  });

  it('cites fixtures that exist and were recorded from the endpoint named by their label', () => {
    const labels = new Set(fixtureLabels(doc));
    expect(labels.size).toBeGreaterThan(0);
    for (const label of labels) {
      expect(existsSync(join(projectRoot, 'fixtures', 'discovery', `${label}.json`)), label).toBe(true);
      const endpoint = inventory.get(label.slice(0, 3));
      expect(readFixture(label).request.path, label).toBe(endpoint?.path);
    }
  });

  it('backs an unavailable check with refusals only, and any other check with a successful call', () => {
    for (const row of summary) {
      expect(row.evidence.length, `${row.check} evidence`).toBeGreaterThan(0);
      const anySuccess = row.evidence.map(readFixture).some(succeeded);
      expect(anySuccess, `${row.check} evidence has a successful call`).toBe(row.decision !== 'unavailable');
    }
  });

  it('gives every inventoried endpoint a role, and lists exactly the refused ones as refused', () => {
    for (const id of inventory.keys()) expect(doc, id).toMatch(new RegExp(`\\b${id}\\b`));

    const refusedRow = doc
      .split('\n')
      .map(cellsOf)
      .find((cells) => (cells[2] ?? '').startsWith('Refused'));
    const refused = [...inventory.values()].filter((row) => row.status === 'refused').map((row) => row.id);
    expect(endpointIds(refusedRow?.[1] ?? '').sort()).toEqual(refused.sort());
  });
});
