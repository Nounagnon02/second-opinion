/**
 * What `docs/ENDPOINTS.md` says, read back so the audit can compare it with what the answers carry.
 *
 * That file is the inventory this project built in T1.1 and verified endpoint by endpoint in T1.2, and decision D8
 * names it the expected schema of every endpoint. It is therefore the only baseline the audit has that is itself
 * evidence: each of its rows was written from a recorded answer, and the answer is in `fixtures/discovery/`.
 *
 * Two tables are read:
 * - the **status tables**, one row per endpoint: which plan the documentation page lists it under, and whether the
 *   hackathon key was able to call it. This is what lets the audit report a refusal against what the page says;
 * - the **"Observed fields" table**, one row per endpoint: the field names that were received. Only the backticked
 *   names are read, and only their last path segment, because the cells mix names with the prose that qualifies
 *   them. A parser of prose would invent an inventory rather than read one, so two prose forms are handled
 *   explicitly and everything else is left alone:
 *   - `without \`x\` and \`y\``, up to the next `;`, marks names the row says are **absent**, not present;
 *   - `as E0n` marks a row that states its fields by reference to another endpoint. Those rows are not compared at
 *     all: "the same fields as E14 without `tokens`" leaves open whether the names nested inside `tokens` go with
 *     it, and deciding that here would be inventing the baseline rather than reading it (D14).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../cmc/config.js';

/** Where the inventory lives. */
export const INVENTORY_FILE = join(PROJECT_ROOT, 'docs', 'ENDPOINTS.md');

/**
 * An endpoint ID as `docs/ENDPOINTS.md` writes it, for example `E04`.
 *
 * Wider than `EndpointId` on purpose. That type is the endpoints the client may call — the `verified` rows — and
 * the inventory also carries the rows the key was refused (D2). Typing an inventory ID as `EndpointId` would
 * claim every documented row is callable, when the audit reads the refused rows precisely in order to report
 * them against what their documentation page lists.
 */
export type DocumentedEndpointId = `E${string}`;

/** The heading of the field table inside it. */
const FIELDS_HEADER = 'Response fields of interest (observed)';

/** One row of the status tables: what the documentation page says, and what the key was able to do. */
export interface EndpointRow {
  id: DocumentedEndpointId;
  method: string;
  path: string;
  /** The plan cell of the row, as written, for example `listed`. */
  plan: string;
  /** The checks the row says the endpoint feeds. */
  checks: string;
  /** `verified` or `refused`, as T1.2 and T1.3 recorded it. */
  status: string;
}

/** Every endpoint row of `docs/ENDPOINTS.md`, in the order the file lists them. */
export function readEndpointRows(file = INVENTORY_FILE): EndpointRow[] {
  const rows: EndpointRow[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    const endpoint = /^`(GET|POST) (\/v\d\/[^`]+)`$/.exec(cells[2] ?? '');
    if (!/^E\d{2}$/.test(cells[1] ?? '') || !endpoint || cells.length < 6) continue;
    rows.push({
      id: (cells[1] ?? '') as DocumentedEndpointId,
      method: endpoint[1] ?? '',
      path: endpoint[2] ?? '',
      plan: cells[3] ?? '',
      checks: cells[cells.length - 3] ?? '',
      status: cells[cells.length - 2] ?? '',
    });
  }
  return rows;
}

/** What the "Observed fields" table lists for one endpoint. */
export interface FieldInventory {
  endpoint: DocumentedEndpointId;
  /** Field names the row states directly, sorted; empty for a row that states them by reference. */
  names: string[];
  /** Names the row says the answer does **not** carry (`without ...`). */
  absent: string[];
  /** The endpoint this row refers to instead of listing its own fields; `null` when it lists them. */
  reference: DocumentedEndpointId | null;
}

/** The backticked tokens of a cell that are plain field names. */
function namesIn(text: string): string[] {
  const names: string[] = [];
  for (const [, token] of text.matchAll(/`([^`]+)`/g)) {
    const bare = (token ?? '')
      .split('.')
      .pop()
      ?.replace(/\[\]$/, '')
      .replace(/\?$/, '')
      .trim();
    // A token carrying anything else is a request parameter (`name=value`), a placeholder (`<id>`) or a wildcard.
    if (bare !== undefined && /^[A-Za-z_][A-Za-z0-9_]*$/.test(bare)) names.push(bare);
  }
  return names;
}

/** Splits a cell into what the row states and what it excludes with `without`. */
function splitWithout(cell: string): { stated: string; excluded: string } {
  const stated: string[] = [];
  const excluded: string[] = [];
  // A `without` clause runs to the next `;`, which is how these rows separate their clauses.
  for (const clause of cell.split(';')) {
    const at = clause.search(/\bwithout\b/i);
    if (at < 0) stated.push(clause);
    else {
      stated.push(clause.slice(0, at));
      excluded.push(clause.slice(at));
    }
  }
  return { stated: stated.join(';'), excluded: excluded.join(';') };
}

/** What the "Observed fields" table lists, endpoint by endpoint, in the order the table gives them. */
export function readFieldInventory(file = INVENTORY_FILE): FieldInventory[] {
  const inventory: FieldInventory[] = [];
  let inTable = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.includes(FIELDS_HEADER)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    const id = cells[1] ?? '';
    if (!/^E\d{2}$/.test(id)) {
      // The table runs to the first non-empty line that is not one of its rows.
      if (!line.startsWith('|') && line.trim() !== '') inTable = false;
      continue;
    }
    const cell = cells[cells.length - 2] ?? '';
    const { stated, excluded } = splitWithout(cell);
    const reference = /\bas (E\d{2})\b/.exec(cell)?.[1] ?? null;
    inventory.push({
      endpoint: id as DocumentedEndpointId,
      names: reference === null ? [...new Set(namesIn(stated))].sort() : [],
      absent: [...new Set(namesIn(excluded))].sort(),
      reference: reference as DocumentedEndpointId | null,
    });
  }
  return inventory;
}
