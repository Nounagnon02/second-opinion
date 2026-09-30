/**
 * The API feedback note of T8.3, checked against the corpus it speaks for.
 *
 * This document is the one deliverable of `docs/` that is pure prose: nothing generates it, and the two things
 * it trades on — that its numbers come from recorded answers, and that its wording stays constructive — are
 * exactly the two things a reader cannot verify without opening every file it names. So the test opens them.
 *
 * Three gates, in the order the document itself announces them:
 *
 * 1. **Every `**Measured:**` line is quoted word for word from `docs/API_AUDIT.md`.** The audit is generated;
 *    regenerate it on a wider corpus and a number moves, and the line stops matching here. A measurement in
 *    this file can therefore never drift away from the report it claims to quote.
 * 2. **Every number in the prose is recomputed** — from `docs/api_audit.json` for what the audit measured, and
 *    from the recorded answers themselves for everything else (the catalogue walk, the wrapper prices, the
 *    platform identifiers, the pair counts). Nothing is compared against a copy of itself.
 * 3. **The wording goes through the tone gate of `src/audit/review.ts`**, the one the audit applies to its own
 *    entries, which is how `CLAUDE.md` rule 6 is kept by the code rather than by intention.
 *
 * What is deliberately not checked is the argument: whether a suggestion is a good one is a judgement, and the
 * document says as much. What is checked is that it rests on something recorded.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AuditRun } from '../src/audit/run.js';
import { toneIssues } from '../src/audit/review.js';
import { projectRoot, readInventory } from './helpers/endpoints-doc.js';

const FEEDBACK = readFileSync(join(projectRoot, 'docs', 'API_FEEDBACK.md'), 'utf8');
const AUDIT = readFileSync(join(projectRoot, 'docs', 'API_AUDIT.md'), 'utf8');
const ENDPOINTS_DOC = readFileSync(join(projectRoot, 'docs', 'ENDPOINTS.md'), 'utf8');
const DECISIONS = readFileSync(join(projectRoot, 'docs', 'DECISIONS.md'), 'utf8');
const RUN = JSON.parse(readFileSync(join(projectRoot, 'docs', 'api_audit.json'), 'utf8')) as AuditRun;

/** A recorded exchange, as the recorder writes it. */
interface Recorded {
  request: { path: string; query?: Record<string, string> };
  response: { status: number; body: { status?: Record<string, unknown>; data?: unknown } };
}

function recorded(file: string): Recorded {
  return JSON.parse(readFileSync(join(projectRoot, file), 'utf8')) as Recorded;
}

/** Lines of one kind, with the marker taken off: `**Measured:** x` → `x`. */
function lines(marker: string, text = FEEDBACK): string[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith(`**${marker}:**`))
    .map((line) => line.slice(`**${marker}:**`.length).trim());
}

/** The sections of one series: `### W3 · title` → `W3` mapped to everything under it. */
function sections(letter: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const part of FEEDBACK.split(/^### /m).slice(1)) {
    const id = /^([A-Z]\d+) · /.exec(part)?.[1];
    if (id === undefined || !id.startsWith(letter)) continue;
    found.set(id, part);
  }
  return found;
}

/**
 * Repository paths the document cites: between backticks, holding a slash, and not opening on one — an API
 * path is written `/v1/key/info` and is not a file of this repository.
 */
function citedPaths(text: string): string[] {
  return [...text.matchAll(/`([\w.-]+(?:\/[\w.-]+)+)`/g)].map((match) => match[1] ?? '');
}

/** The document on one line: what it quotes of an answer is checked here, since a quotation can be wrapped. */
const FLAT = FEEDBACK.replace(/\s+/g, ' ');

/** One figure of the prose, read from the sentence that states it. */
function figure(pattern: RegExp): number {
  const match = pattern.exec(FEEDBACK);
  expect(match, `the document no longer says: ${pattern.source}`).not.toBeNull();
  return Number((match?.[1] ?? '').replace(/[, ]/g, ''));
}

/** The engine pass of the committed run: what the verdict figures of W6 are read back from. */
const SAMPLE = RUN.sample;
if (SAMPLE === null) throw new Error('docs/api_audit.json holds no engine pass, so W6 cannot be checked.');

const audited = new Map(RUN.endpoints.map((one) => [one.endpoint, one]));
const optional = new Map(RUN.optional.map((one) => [one.endpoint, one.fields.length]));
const alwaysNull = new Map(RUN.alwaysNull.map((one) => [one.endpoint, one.fields.length]));

describe('docs/API_FEEDBACK.md, against the report it quotes', () => {
  it('quotes every measurement word for word from docs/API_AUDIT.md', () => {
    const quoted = lines('Measured');
    expect(quoted.length).toBeGreaterThan(5);
    const fromAudit = new Set(lines('Measured', AUDIT));
    for (const line of quoted) expect(fromAudit, `**Measured:** ${line}`).toContain(line);
  });

  it('cites audit entries that the report actually printed', () => {
    const printed = new Set([...AUDIT.matchAll(/^### (A\d+) · /gm)].map((match) => match[1]));
    expect(printed.size).toBe(RUN.findings.length);
    const cited = new Set([...FEEDBACK.matchAll(/\bA\d+\b/g)].map((match) => match[0]));
    expect(cited.size).toBeGreaterThan(10);
    for (const id of cited) expect(printed, `cites ${id}`).toContain(id);
  });

  it('cites decisions that docs/DECISIONS.md records', () => {
    const taken = new Set([...DECISIONS.matchAll(/^## (D\d+) — /gm)].map((match) => match[1]));
    const cited = new Set([...FEEDBACK.matchAll(/\bD\d+\b/g)].map((match) => match[0]));
    expect(cited.size).toBeGreaterThan(3);
    for (const id of cited) expect(taken, `cites ${id}`).toContain(id);
  });

  it('gives every section the answers it was read from, and cites files that exist', () => {
    const bodies = [...sections('G').values(), ...sections('W').values()];
    expect(bodies.length).toBeGreaterThan(10);
    for (const body of bodies) expect(lines('From', body).length, body.split('\n')[0]).toBe(1);

    const paths = new Set(citedPaths(FEEDBACK));
    expect(paths.size).toBeGreaterThan(10);
    // A directory of recorded answers is cited as such, so existence is what is asked of both.
    for (const path of paths) expect(existsSync(join(projectRoot, path)), path).toBe(true);
  });

  it('answers every observation with a suggestion, and every suggestion with an observation', () => {
    const observations = sections('W');
    const suggestions = sections('S');
    expect(suggestions.size).toBeGreaterThan(5);

    const answered = new Set<string>();
    for (const [id, body] of suggestions) {
      const answers = lines('Answers', body);
      expect(answers.length, `${id} says what it answers`).toBe(1);
      const named = [...(answers[0] ?? '').matchAll(/\bW\d+\b/g)].map((match) => match[0]);
      expect(named.length, `${id} names an observation`).toBeGreaterThan(0);
      for (const w of named) {
        expect([...observations.keys()], `${id} answers ${w}`).toContain(w);
        answered.add(w);
      }
    }
    // An observation no suggestion answers is allowed, and has to say so in its own words rather than by
    // omission: silence would read the same whether the case was weighed or forgotten.
    for (const [id, body] of observations) {
      if (answered.has(id)) continue;
      expect(lines('No suggestion', body).length, `${id} is answered or says why not`).toBe(1);
    }
  });
});

describe('the figures of the prose, recomputed', () => {
  it('counts the corpus as the audit run counted it', () => {
    expect(figure(/\*\*([\d,]+) credits\*\*/)).toBe(RUN.totals.creditsReported);
    expect(figure(/([\d,]+) recorded answers over \d+ endpoints, in \d+ captures/)).toBe(RUN.totals.answers);
    expect(figure(/[\d,]+ recorded answers over (\d+) endpoints, in \d+ captures/)).toBe(RUN.totals.endpoints);
    expect(figure(/[\d,]+ recorded answers over \d+ endpoints, in (\d+) captures/)).toBe(RUN.corpus.parts.length);
    expect(figure(/The key reached (\d+) of the \d+ endpoints inventoried/)).toBe(RUN.totals.endpoints);
    expect(figure(/The key reached \d+ of the (\d+) endpoints inventoried/)).toBe(RUN.rows.length);
  });

  it('counts the endpoints the plan refused as the inventory records them', () => {
    const refused = readInventory().filter((row) => row.status === 'refused');
    // E12 answered 400, not a plan refusal: the document separates the two and so does this count.
    const plan = refused.filter((row) => recorded(`fixtures/discovery/${planRefusal(row.id)}`).response.status === 403);
    expect(figure(/^(\d+) of the \d+ endpoints inventoried answered HTTP 403/m)).toBe(plan.length);
    expect(figure(/^\d+ of the (\d+) endpoints inventoried answered HTTP 403/m)).toBe(readInventory().length);
    for (const row of plan) expect(FLAT, `names ${row.id}`).toContain(`${row.id} (\`${row.path}\`)`);
  });

  it('counts the two shapes of the status envelope from the answers', () => {
    const byShape = { string: 0, number: 0 };
    for (const endpoint of RUN.endpoints) {
      const shape = typeof recorded(endpoint.errorCodes[0]?.example ?? '').response.body.status?.error_code;
      if (shape === 'string') byShape.string += 1;
      if (shape === 'number') byShape.number += 1;
    }
    expect(byShape.string + byShape.number).toBe(RUN.totals.endpoints);
    expect(figure(/arrives as a string on (\d+) endpoints/)).toBe(byShape.string);
    expect(figure(/with no `notice` field beside it, and as a number on\n(\d+),/)).toBe(byShape.number);
  });

  it('counts the fields that come and go, and the ones that were always null', () => {
    expect(figure(/is not counted — (\d+) fields of E02/)).toBe(optional.get('E02'));
    expect(figure(/(\d+) of E05, \d+ of E10, \d+ of E11 and \d+ of E19/)).toBe(optional.get('E05'));
    expect(figure(/\d+ of E05, (\d+) of E10, \d+ of E11 and \d+ of E19/)).toBe(optional.get('E10'));
    expect(figure(/\d+ of E05, \d+ of E10, (\d+) of E11 and \d+ of E19/)).toBe(optional.get('E11'));
    expect(figure(/\d+ of E05, \d+ of E10, \d+ of E11 and (\d+) of E19/)).toBe(optional.get('E19'));
    // The suggestion adds them up; a document that revises one count and not the total is caught here.
    const total = (['E02', 'E05', 'E10', 'E11', 'E19'] as const).reduce((sum, id) => sum + (optional.get(id) ?? 0), 0);
    expect(figure(/(\d+) field names across five endpoints/)).toBe(total);

    expect(figure(/E08 and E09 each sent (\d+) fields that were `null`/)).toBe(alwaysNull.get('E08'));
    expect(alwaysNull.get('E09')).toBe(alwaysNull.get('E08'));
    expect(figure(/and E17 sent (\d+), among them/)).toBe(alwaysNull.get('E17'));
  });

  it('counts the busy answers and what they left the verdicts with', () => {
    for (const id of ['E10', 'E11'] as const) {
      const endpoint = audited.get(id);
      const busy = endpoint?.http.find((one) => one.value === 500);
      expect(busy?.answers, `${id} busy answers`).toBe((endpoint?.answers ?? 0) - (endpoint?.accepted ?? 0));
      // The quoted message is the API's own wording: it is read back from the answer the audit pointed at.
      const body = recorded(busy?.example ?? '').response.body.status;
      expect(FLAT).toContain(`"${String(body?.error_message)}"`);
    }
    const assets = SAMPLE.failures.map((one) => one.assets);
    expect(new Set(assets).size, 'both endpoints touched the same number of assets').toBe(1);
    expect(figure(/touching (\d+) assets of the \d+/)).toBe(assets[0]);
    expect(figure(/touching \d+ assets of the (\d+)/)).toBe(SAMPLE.assets);

    const unreadable = SAMPLE.checks.find((one) => one.id === 'C7')?.bySeverity.warning;
    expect(figure(/raised `unreadable_field` on (\d+) of 50 assets, and \d+ of\n\d+ reached/)).toBe(unreadable);
    expect(figure(/and (\d+) of\n\d+ reached `ACT` with fewer than \d+ of the seven checks/)).toBe(SAMPLE.thin.length);
    expect(figure(/reached `ACT` with fewer than (\d+) of the seven checks/)).toBe(SAMPLE.thinAt);
  });

  it('counts the slow endpoints against the budget the call plan works to', () => {
    const half = RUN.budgetMs / 2;
    const slow = RUN.endpoints.filter((one) => (one.unpacedLatency?.maxMs ?? 0) >= half);
    expect(figure(/(\d+) endpoints have an answer taking at least half of that budget/)).toBe(slow.length);
    expect(figure(/One `check` is allowed (\d+) s end to end/) * 1000).toBe(RUN.budgetMs);
    expect(figure(/(\d+) ms for E02, \d+ ms for E19/)).toBe(audited.get('E02')?.unpacedLatency?.medianMs);
    expect(figure(/\d+ ms for E02, (\d+) ms for E19/)).toBe(audited.get('E19')?.unpacedLatency?.medianMs);
  });
});

describe('the figures read from the recorded answers themselves', () => {
  it('reads the catalogue walk from the answers of fixtures/rwa-index', () => {
    const dir = 'fixtures/rwa-index';
    let issuers = 0;
    let tokens = 0;
    let linked = 0;
    let credits = 0;
    for (const name of readdirSync(join(projectRoot, dir)).sort()) {
      const answer = recorded(join(dir, name));
      credits += Number(answer.response.body.status?.credit_count ?? 0);
      const data = answer.response.body.data as
        | { total_size?: number; tokens?: { crypto_id?: unknown; rwa_id?: unknown }[] }
        | undefined;
      if (name.startsWith('E18') && typeof data?.total_size === 'number') issuers = data.total_size;
      for (const token of data?.tokens ?? []) {
        tokens += 1;
        if (token.crypto_id != null && token.rwa_id != null) linked += 1;
      }
    }
    expect(figure(/read (\d+) issuers\nand [\d,]+ tokens for \d+ credits/)).toBe(issuers);
    expect(figure(/read \d+ issuers\nand ([\d,]+) tokens for \d+ credits/)).toBe(tokens);
    expect(figure(/read \d+ issuers\nand [\d,]+ tokens for (\d+) credits/)).toBe(credits);
    expect(figure(/returned ([\d,]+) tokens, of which [\d,]+ \([\d.]+ %\)/)).toBe(tokens);
    expect(figure(/returned [\d,]+ tokens, of which ([\d,]+) \([\d.]+ %\)/)).toBe(linked);
    expect(figure(/The remaining (\d+) carry at most one/)).toBe(tokens - linked);
    expect(/of which [\d,]+ \(60\.1 %\)/.test(FEEDBACK) && ((linked / tokens) * 100).toFixed(1) === '60.1').toBe(true);
  });

  it('reads the free endpoints from what their answers reported', () => {
    for (const id of ['E01', 'E13', 'E20'] as const) {
      const endpoint = audited.get(id);
      expect(endpoint?.credits.map((one) => one.value), `${id} reported cost`).toEqual([0]);
      expect(FEEDBACK, `names ${id}`).toMatch(new RegExp(`${id} \\(\`/v\\d`));
    }
  });

  it('reads the three identifier spaces from the four answers it names', () => {
    /** `platform.id` of PAXG, where the endpoint answers a list of assets. */
    const inList = (file: string): unknown => {
      const data = recorded(file).response.body.data as { symbol: string; platform?: { id?: unknown } }[];
      return data.find((one) => one.symbol === 'PAXG')?.platform?.id;
    };
    expect(inList('fixtures/discovery/E01-map-btc-paxg.json')).toBe(1);
    expect(inList('fixtures/discovery/E02-quotes-latest-btc-paxg.json')).toBe(1027);

    const keyed = recorded('fixtures/discovery/E05-info-btc-paxg.json').response.body.data as Record<
      string,
      { platform?: { id?: unknown } }
    >;
    expect(keyed['4705']?.platform?.id).toBe('1027');

    const dexToken = recorded('fixtures/discovery/E10-dex-token-price-paxg.json').response.body.data as {
      pid?: unknown;
    };
    expect(dexToken.pid).toBe(1);

    expect(FEEDBACK).toContain('arrives as `1` in E01, as the number `1027` in E02, and as the string');
  });

  it('reads the pair counts of E08 from the answers it names', () => {
    const pairs = recorded('fixtures/discovery/E08-dex-spot-pairs-paxg-uniswap.json').response.body.data as {
      base_asset_symbol: string;
    }[];
    expect(figure(/was called with `limit=10` and answered (\d+) pairs/)).toBe(pairs.length);
    expect(figure(/which held (\d+) PAXG pairs among/)).toBe(pairs.filter((one) => one.base_asset_symbol === 'PAXG').length);
    const refused = recorded('fixtures/discovery/E08-dex-spot-pairs-paxg.json');
    expect(refused.response.status).toBe(400);
    expect(FLAT).toContain(`"${String(refused.response.body.status?.error_message)}"`);
  });

  it('reads the wrapper prices and the average of the GOLD answer', () => {
    const data = recorded('fixtures/discovery/E14-rwa-quotes-gold.json').response.body.data as {
      rwa_assets: { average_tokenized_price: number; tokens: { symbol: string; price: number }[] }[];
    };
    const asset = data.rwa_assets[0];
    const tokens = asset?.tokens ?? [];
    expect(figure(/`average_tokenized_price` is (\d+\.\d+)/)).toBe(Number((asset?.average_tokenized_price ?? 0).toFixed(2)));
    const high = tokens.filter((one) => one.price > 1000);
    const low = tokens.filter((one) => one.price <= 1000);
    expect(FLAT).toContain(high.map((one) => one.symbol).join(', '));
    expect(FLAT).toContain(low.map((one) => one.symbol).join(', '));
    expect(figure(/priced either at about ([\d,]+) USD/)).toBe(Math.round((high[0]?.price ?? 0) / 10) * 10);
    expect(figure(/or at about (\d+) USD/)).toBe(Math.round(low[0]?.price ?? 0));
    // The claim the suggestion rests on: the two groups are a whole order of magnitude and more apart.
    const ratio = (high[0]?.price ?? 0) / (low[0]?.price ?? 1);
    expect(figure(/priced (\d+) times below another/)).toBe(Math.round(ratio));
  });

  it('quotes the two refusals it contrasts from the answers themselves', () => {
    const e12 = recorded('fixtures/discovery/E12-dex-token-liquidity-paxg-minimal.json');
    expect(e12.response.status).toBe(400);
    expect(Object.keys(e12.request.query ?? {}).sort()).toEqual(['address', 'platform']);
    expect(FLAT).toContain(`\`"${String(e12.response.body.status?.error_message)}"\``);

    const e19 = recorded('fixtures/discovery/E19-rwa-issuer-backed-limit1000.json');
    const status = e19.response.body.status ?? {};
    for (const key of ['error_code', 'category', 'error_detail'] as const) {
      expect(FLAT, `quotes E19 ${key}`).toContain(`\`"${String(status[key])}"\``);
    }
  });

  it('reports the credit counter of the walk as docs/ENDPOINTS.md recorded it', () => {
    const moved = /before and after the walk went from (\d+) to (\d+)/.exec(ENDPOINTS_DOC);
    expect(moved).not.toBeNull();
    expect(FEEDBACK).toContain(`moving from ${String(moved?.[1])} to ${String(moved?.[2])}`);
  });
});

describe('the rule of tone, applied to this file as to the report', () => {
  it('uses no word this project undertakes not to use about the API', () => {
    const issues = toneIssues({
      kind: 'observed',
      endpoints: [],
      title: '',
      statement: FEEDBACK,
      measurement: null,
      evidence: [],
    });
    expect(issues.map((issue) => issue.reason)).toEqual([]);
  });
});

/** The recorded refusal of an endpoint the inventory marks refused, by the label T1.2 gave it. */
function planRefusal(id: string): string {
  const labels: Record<string, string> = {
    E04: 'E04-market-pairs-btc-minimal.json',
    E12: 'E12-dex-token-liquidity-paxg-minimal.json',
    E15: 'E15-rwa-market-pairs-gold.json',
    E21: 'E21-exchange-market-pairs-binance-paxg.json',
  };
  const label = labels[id];
  if (label === undefined) throw new Error(`docs/ENDPOINTS.md marks ${id} refused, and no recorded refusal is named here.`);
  return label;
}
