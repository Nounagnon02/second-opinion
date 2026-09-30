/**
 * `docs/EVIDENCE.md` of T8.2, read back against the files it quotes.
 *
 * The rules ask for proof of a real API call: the code that made it and the answer that came back. A document can
 * only be that proof if its quotes are the files rather than a memory of them, so nothing here is read for
 * plausibility:
 * - every **Code** block is compared, character for character, to the line range of the file its caption names;
 * - every **Answer** block is compared to the recorded exchange at the JSON path its caption names. A block may
 *   leave fields out — the paragraph around it is about a few of them — but every field it does show has to hold
 *   the value the file holds. A *shortened array* is the one omission that cannot pass in silence: the caption has
 *   to declare it, `(tokens: 3 of 7)`, and the count is checked against the file;
 * - the **Finding** block is not compared to a copy of itself. The recorded answer is normalised, the real C4 runs
 *   over it with the real thresholds of `config/checks.json` and the order size of the demonstration scenario, and
 *   the message that check returns is what the document has to say;
 * - the arithmetic the document states — credits between two key snapshots, answers per capture, corpus totals —
 *   is recomputed from the fixtures and compared to the numbers written in the prose.
 *
 * What this cannot check is the prose between the anchors. That is why the anchors are pinned: a sentence may go
 * stale, but the document cannot quote a line of code that moved, a field that changed value, or a count that no
 * longer holds.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { liquidityOfPools, runLiquidityCheck } from '../src/checks/c4-liquidity.js';
import { loadChecksConfig } from '../src/checks/config.js';
import type { EndpointId } from '../src/cmc/endpoints.js';
import { ENDPOINTS } from '../src/cmc/endpoints.js';
import type { RecordedExchange } from '../src/cmc/fixtures.js';
import { ORDER_SIZE_USD } from '../src/demo/scenarios.js';
import { normalizeDexPools } from '../src/normalize/dex.js';
import { sourceFromBody } from '../src/normalize/model.js';
import { projectRoot, readInventory } from './helpers/endpoints-doc.js';

const DOC_PATH = join(projectRoot, 'docs', 'EVIDENCE.md');
const DOC = readFileSync(DOC_PATH, 'utf8');
const LINES = DOC.split('\n');

/** A caption of the document and the fenced block under it. */
interface Quote {
  /** The caption without its `**` markers, for a failure message that names the block a reader can find. */
  caption: string;
  /** The line the caption sits on, 1-indexed, so a failure points at `docs/EVIDENCE.md:NNN`. */
  line: number;
  language: string;
  body: string;
}

/**
 * Every `**Kind — ...**` caption followed by a fenced block. The caption has to be the line just above the fence,
 * with at most a blank line between, which is the shape the document uses throughout.
 */
function quotes(kind: 'Code' | 'Answer' | 'Finding'): Quote[] {
  const found: Quote[] = [];
  for (let index = 0; index < LINES.length; index += 1) {
    const caption = /^\*\*(Code|Answer|Finding) — (.+)\*\*$/.exec(LINES[index] ?? '');
    if (caption === null || caption[1] !== kind) continue;
    let fence = index + 1;
    while (fence < LINES.length && (LINES[fence] ?? '').trim() === '') fence += 1;
    const opening = /^```(\w*)$/.exec(LINES[fence] ?? '');
    if (opening === null) throw new Error(`docs/EVIDENCE.md:${index + 1}: no fenced block under "${caption[2]}".`);
    const close = LINES.indexOf('```', fence + 1);
    if (close === -1) throw new Error(`docs/EVIDENCE.md:${fence + 1}: the fenced block is never closed.`);
    found.push({
      caption: caption[2] ?? '',
      line: index + 1,
      language: opening[1] ?? '',
      body: LINES.slice(fence + 1, close).join('\n'),
    });
  }
  return found;
}

function readExchange(file: string): RecordedExchange {
  return JSON.parse(readFileSync(join(projectRoot, file), 'utf8')) as RecordedExchange;
}

/** Resolves `response.body.data[0].quote[0]` against a parsed exchange. */
function at(root: unknown, pointer: string): unknown {
  let value: unknown = root;
  for (const step of pointer.split('.')) {
    const parts = /^([A-Za-z_][\w-]*)((?:\[\d+\])*)$/.exec(step);
    if (parts === null) throw new Error(`"${pointer}" is not a path this test can follow (at "${step}").`);
    if (value === null || typeof value !== 'object') {
      throw new Error(`"${pointer}" runs past the end of the answer: "${step}" has nothing to read from.`);
    }
    value = (value as Record<string, unknown>)[parts[1] ?? ''];
    for (const index of [...(parts[2] ?? '').matchAll(/\[(\d+)\]/g)]) {
      if (!Array.isArray(value)) throw new Error(`"${pointer}": ${step} is not an array in the file.`);
      value = value[Number(index[1])];
    }
  }
  return value;
}

/** An array the block shows fewer entries of than the file holds. */
interface Truncation {
  /** The path from the block's root, `tokens`, or `root` for the block's own top-level array. */
  name: string;
  shown: number;
  held: number;
}

function shape(value: unknown): string {
  if (Array.isArray(value)) return 'an array';
  if (value === null) return 'null';
  if (typeof value === 'object') return 'an object';
  return JSON.stringify(value);
}

/**
 * Every way the quoted block disagrees with the file, as sentences. A missing field is allowed; a field holding a
 * different value, a field the file does not carry, and an array the block makes *longer* than the file are not.
 * A shorter array is collected into `truncations` for the caller to check against the caption.
 */
function disagreements(quoted: unknown, held: unknown, path: string, truncations: Truncation[]): string[] {
  const here = path === '' ? 'root' : path;
  if (Array.isArray(quoted)) {
    if (!Array.isArray(held)) return [`${here}: the block shows an array, the file holds ${shape(held)}`];
    const issues: string[] = [];
    if (quoted.length > held.length) {
      issues.push(`${here}: the block shows ${quoted.length} entries, the file holds ${held.length}`);
    } else if (quoted.length < held.length) {
      truncations.push({ name: here, shown: quoted.length, held: held.length });
    }
    for (let index = 0; index < Math.min(quoted.length, held.length); index += 1) {
      issues.push(...disagreements(quoted[index], held[index], `${path}[${index}]`, truncations));
    }
    return issues;
  }
  if (quoted !== null && typeof quoted === 'object') {
    if (held === null || typeof held !== 'object' || Array.isArray(held)) {
      return [`${here}: the block shows an object, the file holds ${shape(held)}`];
    }
    const issues: string[] = [];
    for (const [key, value] of Object.entries(quoted)) {
      const step = path === '' ? key : `${path}.${key}`;
      if (!(key in held)) {
        issues.push(`${step}: the block shows this field, the file does not carry it`);
        continue;
      }
      issues.push(...disagreements(value, (held as Record<string, unknown>)[key], step, truncations));
    }
    return issues;
  }
  if (!Object.is(quoted, held)) {
    return [`${here}: the block shows ${JSON.stringify(quoted)}, the file holds ${shape(held)}`];
  }
  return [];
}

/** ``fixtures/x.json` → `response.body.data` (tokens: 3 of 7)` — the three parts of an Answer caption. */
interface AnswerCaption {
  file: string;
  pointer: string;
  declared: Truncation[];
}

function parseAnswerCaption(caption: string): AnswerCaption {
  const parts = /^`([^`]+)`(?: → `([^`]+)`)?(?: \(([^)]+)\))?$/.exec(caption);
  if (parts === null) throw new Error(`"${caption}" is not an Answer caption this test can read.`);
  const declared = (parts[3] ?? '')
    .split(',')
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')
    .map((piece) => {
      const counted = /^(\S+): (\d+) of (\d+)$/.exec(piece);
      if (counted === null) throw new Error(`"${piece}" in "${caption}" is not a "name: N of M" declaration.`);
      return { name: counted[1] ?? '', shown: Number(counted[2]), held: Number(counted[3]) };
    });
  return { file: parts[1] ?? '', pointer: parts[2] ?? '', declared };
}

function sorted(truncations: readonly Truncation[]): string[] {
  return truncations.map(({ name, shown, held }) => `${name}: ${shown} of ${held}`).sort();
}

const CODE_QUOTES = quotes('Code');
const ANSWER_QUOTES = quotes('Answer');

describe('the code docs/EVIDENCE.md quotes', () => {
  it('quotes at least one range from the client, the recorder and the checks', () => {
    const files = new Set(CODE_QUOTES.map((quote) => /^`([^:]+):/.exec(quote.caption)?.[1]));
    expect(files).toContain('src/cmc/client.ts');
    expect(files).toContain('src/cmc/fixtures.ts');
    expect(files.size).toBeGreaterThanOrEqual(5);
  });

  it.each(CODE_QUOTES.map((quote) => [quote.caption, quote] as const))(
    'reproduces %s exactly',
    (_caption, quote) => {
      const parts = /^`([^`:]+):(\d+)-(\d+)`$/.exec(quote.caption);
      expect(parts, `docs/EVIDENCE.md:${quote.line}: caption is not \`path:from-to\``).not.toBeNull();
      const [, file, from, to] = parts ?? [];
      const path = join(projectRoot, file ?? '');
      expect(existsSync(path), `docs/EVIDENCE.md:${quote.line}: ${file ?? ''} does not exist`).toBe(true);
      const source = readFileSync(path, 'utf8').split('\n');
      expect(
        Number(to),
        `docs/EVIDENCE.md:${quote.line}: ${file ?? ''} is shorter than the range quoted`,
      ).toBeLessThanOrEqual(source.length);
      expect(quote.body).toBe(source.slice(Number(from) - 1, Number(to)).join('\n'));
    },
  );

  it('fences every code block as TypeScript', () => {
    for (const quote of CODE_QUOTES) expect(quote.language, `docs/EVIDENCE.md:${quote.line}`).toBe('ts');
  });
});

describe('the recorded answers docs/EVIDENCE.md quotes', () => {
  it('quotes answers from more than one capture', () => {
    const directories = new Set(ANSWER_QUOTES.map((quote) => dirname(parseAnswerCaption(quote.caption).file)));
    expect(directories).toContain('fixtures/discovery');
    expect(directories).toContain('fixtures/demo');
  });

  it.each(ANSWER_QUOTES.map((quote) => [quote.caption, quote] as const))(
    'holds the values the file holds for %s',
    (_caption, quote) => {
      const { file, pointer, declared } = parseAnswerCaption(quote.caption);
      expect(existsSync(join(projectRoot, file)), `docs/EVIDENCE.md:${quote.line}: ${file} does not exist`).toBe(
        true,
      );
      expect(quote.language, `docs/EVIDENCE.md:${quote.line}`).toBe('json');
      const exchange = readExchange(file);
      const held = pointer === '' ? exchange : at(exchange, pointer);
      const quoted: unknown = JSON.parse(quote.body);
      const truncations: Truncation[] = [];
      const issues = disagreements(quoted, held, '', truncations);
      expect(issues, `docs/EVIDENCE.md:${quote.line} disagrees with ${file}`).toEqual([]);
      expect(
        sorted(truncations),
        `docs/EVIDENCE.md:${quote.line}: the caption has to declare every shortened array, "(name: N of M)"`,
      ).toEqual(sorted(declared));
    },
  );

  it('masks the key in every answer it quotes', () => {
    for (const quote of ANSWER_QUOTES) {
      const { file } = parseAnswerCaption(quote.caption);
      const { headers } = readExchange(file).request;
      for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() === 'x-cmc_pro_api_key') expect(value, file).toBe('***');
      }
    }
  });
});

describe('the sentence a check writes', () => {
  it('is the sentence C4 returns for the order of the demonstration', () => {
    const [quote, ...rest] = quotes('Finding');
    expect(quote, 'docs/EVIDENCE.md has no **Finding** block').toBeDefined();
    expect(rest, 'this case reads one Finding block; add a case before adding a second').toEqual([]);
    if (quote === undefined) return;

    const parts = /^`C4` on `([^`]+)`$/.exec(quote.caption);
    expect(parts, `docs/EVIDENCE.md:${quote.line}: caption is not \`C4\` on \`fixture\``).not.toBeNull();
    const file = parts?.[1] ?? '';
    const exchange = readExchange(file);
    const source = sourceFromBody('E11', exchange.response.body, {
      file,
      recordedAt: exchange.recordedAt,
      latencyMs: exchange.response.latencyMs,
    });
    const { C4 } = loadChecksConfig();
    const result = runLiquidityCheck(liquidityOfPools(normalizeDexPools(source).items), C4, ORDER_SIZE_USD);
    const finding = result.findings.find((entry) => entry.code === 'order_above_liquidity_share');
    expect(finding, `C4 raises no order finding on ${file} for ${ORDER_SIZE_USD} USD`).toBeDefined();
    expect(quote.body).toBe(finding?.message);
  });
});

describe('the credit arithmetic of section 2', () => {
  const before = readExchange('fixtures/discovery/E20-key-info-before.json');
  const after = readExchange('fixtures/discovery/E20-key-info-after.json');

  interface KeyInfo {
    usage: { current_month: { credits_used: number } };
  }

  function creditsUsed(exchange: RecordedExchange): number {
    return (at(exchange, 'response.body.data') as KeyInfo).usage.current_month.credits_used;
  }

  /** The discovery answers recorded strictly between the two key snapshots, with what each says it cost. */
  function between(): { count: number; credits: number } {
    const start = Date.parse(before.recordedAt);
    const end = Date.parse(after.recordedAt);
    let count = 0;
    let credits = 0;
    for (const name of readdirSync(join(projectRoot, 'fixtures', 'discovery'))) {
      if (!name.endsWith('.json')) continue;
      const exchange = readExchange(join('fixtures', 'discovery', name));
      const recorded = Date.parse(exchange.recordedAt);
      if (recorded <= start || recorded >= end) continue;
      count += 1;
      credits += Number((exchange.response.body as { status?: { credit_count?: number } }).status?.credit_count ?? 0);
    }
    return { count, credits };
  }

  const stated =
    /this project recorded \*\*(\d+) answers\*\*,\nand the `credit_count` those answers report adds up to exactly \*\*(\d+)\*\*/.exec(
      DOC,
    );

  it('states both numbers in the shape this test reads', () => {
    expect(stated, 'the sentence of section 2 changed shape; update this test with it').not.toBeNull();
  });

  it('counts the answers the fixtures hold between the two snapshots', () => {
    expect(between().count).toBe(Number(stated?.[1]));
  });

  it('adds the credits those answers report', () => {
    expect(between().credits).toBe(Number(stated?.[2]));
  });

  it('moves the account counter by the same amount', () => {
    expect(creditsUsed(after) - creditsUsed(before)).toBe(Number(stated?.[2]));
    expect(creditsUsed(before)).toBe(0);
  });

  it('quotes the two snapshots in the order they were recorded', () => {
    expect(Date.parse(before.recordedAt)).toBeLessThan(Date.parse(after.recordedAt));
  });
});

describe('the refusals of section 3', () => {
  /** `| E04 | `/path` | 403 | 1006 | `fixtures/...` |` */
  const rows = LINES.flatMap((line, index) => {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length !== 7 || !/^E\d{2}$/.test(cells[1] ?? '')) return [];
    return [
      {
        line: index + 1,
        id: cells[1] ?? '',
        path: (cells[2] ?? '').replaceAll('`', ''),
        http: Number(cells[3]),
        errorCode: Number(cells[4]),
        file: (cells[5] ?? '').replaceAll('`', ''),
      },
    ];
  });

  it('lists the four endpoints the plan refused', () => {
    expect(rows.map((row) => row.id)).toEqual(['E04', 'E12', 'E15', 'E21']);
  });

  it.each(rows.map((row) => [row.id, row] as const))('reads %s back from its recorded refusal', (_id, row) => {
    expect(existsSync(join(projectRoot, row.file)), `docs/EVIDENCE.md:${row.line}: ${row.file}`).toBe(true);
    const exchange = readExchange(row.file);
    const { status } = exchange.response.body as { status?: { error_code?: number | string } };
    expect(exchange.request.path, `docs/EVIDENCE.md:${row.line}`).toBe(row.path);
    expect(exchange.response.status, `docs/EVIDENCE.md:${row.line}`).toBe(row.http);
    expect(Number(status?.error_code), `docs/EVIDENCE.md:${row.line}`).toBe(row.errorCode);
    expect(exchange.response.status, `${row.file} answered with data`).not.toBe(200);
  });

  it('keeps those four out of the endpoints the client may call', () => {
    for (const row of rows) expect(Object.keys(ENDPOINTS)).not.toContain(row.id);
  });

  it('leaves the client holding the verified rows of docs/ENDPOINTS.md and nothing else', () => {
    const verified = readInventory()
      .filter((row) => row.status === 'verified')
      .map((row) => row.id)
      .sort();
    expect(Object.keys(ENDPOINTS).sort()).toEqual(verified);
  });
});

describe('the corpus table of section 7', () => {
  /** `| discovery | `fixtures/discovery` | 32 | what it is |` */
  const rows = LINES.flatMap((line, index) => {
    const cells = line.split('|').map((cell) => cell.trim());
    const directory = /^`(fixtures\/[\w./-]+)`$/.exec(cells[2] ?? '');
    if (cells.length !== 6 || directory === null || !/^\d+$/.test(cells[3] ?? '')) return [];
    return [{ line: index + 1, capture: cells[1] ?? '', dir: directory[1] ?? '', answers: Number(cells[3]) }];
  });

  it('names five captures', () => {
    expect(rows.map((row) => row.capture)).toEqual(['discovery', 'rwa-index', 'check', 'demo', 'calibration']);
  });

  it.each(rows.map((row) => [row.capture, row] as const))('counts the answers in %s', (_capture, row) => {
    const path = join(projectRoot, row.dir);
    expect(existsSync(path) && statSync(path).isDirectory(), `docs/EVIDENCE.md:${row.line}: ${row.dir}`).toBe(true);
    const files = readdirSync(path).filter((name) => name.endsWith('.json'));
    expect(files.length, `docs/EVIDENCE.md:${row.line}: ${row.dir}`).toBe(row.answers);
  });

  it('adds up to the total the prose states', () => {
    const stated = /Five captures, (\d+) recorded answers, are what this project reads\./.exec(DOC);
    expect(stated, 'the opening sentence of section 7 changed shape; update this test with it').not.toBeNull();
    expect(rows.reduce((total, row) => total + row.answers, 0)).toBe(Number(stated?.[1]));
  });

  it('adds up to the credits the prose states', () => {
    const stated = /The five captures reported (\d+) credits between them/.exec(DOC);
    expect(stated, 'the credit sentence of section 7 changed shape; update this test with it').not.toBeNull();
    let credits = 0;
    for (const row of rows) {
      for (const name of readdirSync(join(projectRoot, row.dir))) {
        if (!name.endsWith('.json')) continue;
        const body = readExchange(join(row.dir, name)).response.body as { status?: { credit_count?: number } };
        credits += Number(body.status?.credit_count ?? 0);
      }
    }
    expect(credits).toBe(Number(stated?.[1]));
  });

  it('leaves the two interrupted calibration walks out of every count', () => {
    // The document says they are there; this checks it, so the sentence is not describing a tidy repository.
    const root = join(projectRoot, 'fixtures', 'calibration');
    const loose = readdirSync(root).filter((name) => name.endsWith('.json'));
    expect(loose.length > 0 || existsSync(join(root, 'live-2026-09-26'))).toBe(true);
    expect(rows.map((row) => row.dir)).not.toContain('fixtures/calibration');
    expect(rows.map((row) => row.dir)).not.toContain('fixtures/calibration/live-2026-09-26');
  });
});

/** Whether an answer carries a `price` anywhere, which is what makes a call a market call. */
function carriesPrice(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(carriesPrice);
  for (const [key, held] of Object.entries(value)) {
    if (key === 'price' && typeof held === 'number') return true;
    if (carriesPrice(held)) return true;
  }
  return false;
}

describe('the claims the document makes about single answers', () => {
  const discoveryE02 = 'fixtures/discovery/E02-quotes-latest-btc-paxg.json';

  it('quotes the first recorded answer that carries a price', () => {
    expect(DOC).toContain('This is the first market call this project ever made');
    const priced = readdirSync(join(projectRoot, 'fixtures', 'discovery'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => readExchange(join('fixtures', 'discovery', name)))
      .filter((exchange) => carriesPrice((exchange.response.body as { data?: unknown }).data))
      .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
    expect(priced[0]?.recordedAt).toBe(readExchange(discoveryE02).recordedAt);
  });

  it('reads `status.error_code` in the two shapes section 6 names', () => {
    const asString = at(readExchange(discoveryE02), 'response.body.status') as Record<string, unknown>;
    const asNumber = at(
      readExchange('fixtures/demo/E01-8d6f0741-20260926T190050290Z.json'),
      'response.body.status',
    ) as Record<string, unknown>;
    expect(asString.error_code).toBe('0');
    expect(asNumber.error_code).toBe(0);
    expect('notice' in asNumber, 'section 6 says the E01 answer carries a notice field').toBe(true);
    expect('notice' in asString, 'section 6 says the E02 answer does not carry one').toBe(false);
  });

  it('reads a field present on one pool and absent on the next', () => {
    const pools = at(
      readExchange('fixtures/demo/E11-cf67552b-20260926T190051345Z.json'),
      'response.body.data',
    ) as Record<string, unknown>[];
    expect('v24' in (pools[0] ?? {})).toBe(true);
    expect('v24' in (pools[1] ?? {})).toBe(false);
  });

  it('reads the PAXG premium of section 5 off the recorded answer', () => {
    interface RwaAsset {
      average_tokenized_price: number;
      tokens: { symbol: string; price: number }[];
    }
    const gold = at(
      readExchange('fixtures/demo/E14-626f8f59-20260926T190550895Z.json'),
      'response.body.data.rwa_assets[0]',
    ) as RwaAsset;
    const paxg = gold.tokens.find((token) => token.symbol === 'PAXG');
    expect(paxg, 'the recorded gold answer lists no PAXG wrapper').toBeDefined();
    const premium = (((paxg?.price ?? 0) - gold.average_tokenized_price) / gold.average_tokenized_price) * 100;
    expect(DOC).toContain('a premium of about 0.005 %');
    expect(premium.toFixed(3)).toBe('0.005');
  });
});

describe('the document as a whole', () => {
  it('points every relative link at a file that exists', () => {
    const links = [...DOC.matchAll(/\]\((?!https?:)([^)#]+)(?:#[^)]*)?\)/g)].map((match) => match[1] ?? '');
    expect(links.length).toBeGreaterThan(3);
    for (const link of links) {
      const target = resolve(dirname(DOC_PATH), link);
      expect(existsSync(target), `docs/EVIDENCE.md links to ${link}, which does not exist`).toBe(true);
      expect(relative(projectRoot, target).startsWith('..')).toBe(false);
    }
  });

  it('names commands that exist', () => {
    const { scripts } = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const match of DOC.matchAll(/npm run ([\w:]+)/g)) {
      expect(Object.keys(scripts), `docs/EVIDENCE.md names "npm run ${match[1] ?? ''}"`).toContain(match[1]);
    }
    // The document tells a reader to run this file; a rename has to reach the sentence that names it.
    expect(DOC).toContain('npx vitest run tests/evidence-doc.test.ts');
    expect(existsSync(join(projectRoot, 'tests', 'evidence-doc.test.ts'))).toBe(true);
  });

  it('names endpoints the client can actually call', () => {
    const named = new Set([...DOC.matchAll(/\bE(\d{2})\b/g)].map((match) => `E${match[1] ?? ''}`));
    const known = new Set<string>([...Object.keys(ENDPOINTS), ...readInventory().map((row) => row.id)]);
    for (const id of named) expect(known, `docs/EVIDENCE.md names ${id}`).toContain(id);
    for (const id of ['E01', 'E02', 'E11', 'E14'] satisfies EndpointId[]) expect(named).toContain(id);
  });

  it('carries no API key', () => {
    // The document quotes the mask, never a key.
    expect(DOC).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/);
    const env = join(projectRoot, '.env');
    if (!existsSync(env)) return;
    for (const line of readFileSync(env, 'utf8').split('\n')) {
      const value = /^CMC_API_KEY=(.+)$/.exec(line.trim())?.[1]?.trim();
      if (value !== undefined && value !== '') expect(DOC).not.toContain(value);
    }
  });
});
