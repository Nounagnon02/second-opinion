/**
 * The README of T8.1, checked against the repository it describes.
 *
 * A README is the one document a judge reads before anything else runs, and it is also the document that rots
 * fastest: it states what the code reads, where the code lives and what an endpoint is for, and none of that is
 * compiled. So nothing here is read for plausibility. The endpoint table is compared to the endpoints the client
 * may actually call, the checks each row claims to feed are compared to what `explain` answers for those checks,
 * the architecture section is compared to the directories that exist, and the order in the opening is compared to
 * the order the demonstration agent is actually given.
 *
 * What this cannot check is the prose around those anchors. That is the point of pinning the anchors: a sentence
 * can still go stale, but a section cannot name an endpoint, a directory or a check that is not there.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadChecksConfig } from '../src/checks/config.js';
import { CHECK_IDS } from '../src/checks/model.js';
import { ENDPOINTS } from '../src/cmc/endpoints.js';
import { SCENARIOS } from '../src/demo/scenarios.js';
import { explainCheck } from '../src/mcp/explain.js';
import { projectRoot, readInventory } from './helpers/endpoints-doc.js';

const README = readFileSync(join(projectRoot, 'README.md'), 'utf8');

/** One top-level section of the README, heading excluded from the search but kept in the text. */
function section(title: string): string {
  const part = README.split(/^## /m).find((text) => text.startsWith(`${title}\n`));
  if (part === undefined) throw new Error(`README.md has no "## ${title}" section.`);
  return part;
}

interface EndpointRow {
  id: string;
  method: string;
  path: string;
  /** The checks the row says it feeds; empty when the cell is the em dash. */
  checks: string[];
  role: string;
}

/** The endpoint table: `| E01 | `GET /path` | C7 | what it is read for |`. */
function endpointRows(): EndpointRow[] {
  return section('The CMC endpoints it reads')
    .split('\n')
    .flatMap((line) => {
      const cells = line.split('|').map((cell) => cell.trim());
      const endpoint = /^`(GET|POST) (\/v\d\/[^`]+)`$/.exec(cells[2] ?? '');
      if (cells.length !== 6 || !/^E\d{2}$/.test(cells[1] ?? '') || endpoint === null) return [];
      return [
        {
          id: cells[1] ?? '',
          method: endpoint[1] ?? '',
          path: endpoint[2] ?? '',
          checks: [...(cells[3] ?? '').matchAll(/C\d/g)].map((match) => match[0]),
          role: cells[4] ?? '',
        },
      ];
    });
}

/** Which checks read each endpoint, taken from the only place that already answers the question: `explain`. */
function checksByEndpoint(): Map<string, string[]> {
  const config = loadChecksConfig();
  const byEndpoint = new Map<string, string[]>();
  for (const id of CHECK_IDS) {
    for (const endpoint of explainCheck(id, config).endpoints) {
      byEndpoint.set(endpoint, [...(byEndpoint.get(endpoint) ?? []), id]);
    }
  }
  return byEndpoint;
}

const rows = endpointRows();

describe('the endpoint table names what the client reads', () => {
  it('lists every endpoint the client may call, once, and no endpoint it may not', () => {
    // `ENDPOINTS` is the verified rows of docs/ENDPOINTS.md and the only paths the client will send. An endpoint
    // added there without a line here is one the README would let a reader believe is not used.
    expect(rows.map((row) => row.id)).toEqual(Object.keys(ENDPOINTS));
  });

  it('gives each one the path the client actually sends', () => {
    for (const row of rows) {
      expect(row.method, row.id).toBe('GET');
      expect(row.path, row.id).toBe(ENDPOINTS[row.id as keyof typeof ENDPOINTS].path);
    }
  });

  it('names for each one exactly the checks that read it', () => {
    const expected = checksByEndpoint();
    for (const row of rows) expect(row.checks, row.id).toEqual(expected.get(row.id) ?? []);
    // Enough of the table is load-bearing to be measuring something: seven of the seventeen feed a check.
    expect(rows.filter((row) => row.checks.length > 0)).toHaveLength(expected.size);
  });

  it('says what every one of them is read for, including those no check reads', () => {
    for (const row of rows) expect(row.role.length, row.id).toBeGreaterThan(20);
  });

  it('names the refused endpoints as refused, and keeps them out of the client', () => {
    const refused = readInventory()
      .filter((row) => row.status === 'refused')
      .map((row) => row.id);
    expect(refused.length).toBeGreaterThan(0);
    const named = section('The CMC endpoints it reads');
    for (const id of refused) {
      expect(named, `${id} is refused and the README has to say so`).toContain(id);
      expect(Object.keys(ENDPOINTS), id).not.toContain(id);
    }
  });
});

describe('the architecture section describes this tree', () => {
  const architecture = section('Architecture');
  const named = [...new Set([...architecture.matchAll(/`src\/([a-z]+)\/`/g)].map((match) => match[1] ?? ''))];
  const directories = readdirSync(join(projectRoot, 'src')).filter((name) =>
    statSync(join(projectRoot, 'src', name)).isDirectory(),
  );

  it('names every directory of src/, so a new one cannot land undocumented', () => {
    expect(named.sort()).toEqual([...directories].sort());
  });

  it('names where the thresholds and the recorded answers live, since neither is in the code', () => {
    expect(architecture).toContain('config/checks.json');
    expect(architecture).toContain('fixtures/');
  });
});

describe('the opening states the problem before the solution', () => {
  const problem = section('The problem');

  it('comes before every other section but the title', () => {
    expect(README.indexOf('## The problem')).toBeLessThan(README.indexOf('## Requirements'));
  });

  it('quotes the order the demonstration agent is actually given', () => {
    // The scenario is the whole argument of the section: if the demonstration changes asset or size, the prose
    // around it stops describing anything that runs.
    const refusal = SCENARIOS.find((scenario) => scenario.recorded === 'refused');
    expect(refusal, 'no refusal scenario left in src/demo/scenarios.ts').toBeDefined();
    expect(problem).toContain(refusal?.order.instruction);
  });

  it('sends the reader to the command that replays it', () => {
    expect(problem).toContain('npm run demo');
  });
});

describe('every document the README points at exists', () => {
  it('resolves each relative link to a file in the repository', () => {
    const links = [...README.matchAll(/\]\(([^)]+)\)/g)]
      .map((match) => match[1] ?? '')
      .filter((target) => !target.startsWith('http') && !target.startsWith('#'));
    expect(links.length).toBeGreaterThan(3);
    for (const target of new Set(links)) expect(existsSync(join(projectRoot, target)), target).toBe(true);
  });
});
